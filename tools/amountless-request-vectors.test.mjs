// Executable specification vectors for §9.7.9, not a production issuer.
// Book setup, BOLT 12 signatures/encoding, atomic durable storage, and payment/claim
// paths are preconditions outside this sequential admission model.
// Deadlines use one abstract clock; height/wall-clock conversion is not modeled.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const U64_MAX = (1n << 64n) - 1n;
const REFUSAL = 'no slot for this amount';
const positiveAmount = (a) => typeof a === 'bigint' && a > 0n && a <= U64_MAX;

function creationMode(amount) {
  if (amount === undefined || amount === 0n) return 'payer_chosen';
  if (!positiveAmount(amount)) throw new Error('invalid amount');
  return 'fixed';
}

function book(amounts = [1000000n, 2000000n, 2000000n]) {
  assert.ok(amounts.every(positiveAmount));
  return {
    // These fixtures are assumed to have passed all §7.6/§8 setup checks.
    slots: amounts.map((amount, k) => ({ amount, hash: `H_${k}`, issued: false,
      knownPaid: false })),
    reservations: new Map(),
    issueUntil: 100,
    closed: false,
  };
}

function request(overrides = {}) {
  return {
    offer: 'offer-a', payer: 'payer-a', metadataHash: 'metadata-a',
    // An opaque stand-in for the validated full non-signature TLV digest.
    digest: 'full-request-a', amount: 2000000n,
    now: 10, offerExpires: 90, invoiceNotAfter: 80,
    ...overrides,
  };
}

function reserve(state, req) {
  if (!positiveAmount(req.amount) || state.closed ||
      req.now >= state.issueUntil || req.now >= req.offerExpires) return REFUSAL;

  const key = JSON.stringify([req.offer, req.payer, req.metadataHash]);
  const previous = state.reservations.get(key);
  if (previous) {
    const notAfter = Math.min(previous.notAfter, req.invoiceNotAfter,
      req.offerExpires, state.issueUntil);
    if (previous.digest !== req.digest || previous.amount !== req.amount ||
        state.slots[previous.k].knownPaid || req.now >= notAfter) return REFUSAL;
    return { ...previous, response: 'fresh_invoice_required', notAfter };
  }

  const k = state.slots.findIndex((slot) => !slot.issued && slot.amount === req.amount);
  const notAfter = Math.min(req.invoiceNotAfter, req.offerExpires, state.issueUntil);
  if (k < 0 || notAfter <= req.now) return REFUSAL;
  const selected = { k, hash: state.slots[k].hash, amount: req.amount,
    digest: req.digest, notAfter };
  // Models one atomic durable transaction shared by all offers on this book.
  state.slots[k].issued = true;
  state.reservations.set(key, selected);
  return { ...selected, response: 'new_invoice' };
}

test('zero and omission are create-request aliases only', () => {
  assert.equal(creationMode(undefined), 'payer_chosen');
  assert.equal(creationMode(0n), 'payer_chosen');
  assert.equal(creationMode(2000000n), 'fixed');
  for (const amount of [-1n, U64_MAX + 1n, 0.5, NaN, '', '0', null]) {
    assert.throws(() => creationMode(amount), /invalid amount/);
  }
  assert.equal(reserve(book(), request({ amount: 0n })), REFUSAL);
});

const amountVectors = [
  ['missing', undefined, false], ['zero', 0n, false], ['negative', -1n, false],
  ['fractional', 0.5, false], ['overflow', U64_MAX + 1n, false],
  ['below smallest slot', 999999n, false], ['first denomination', 1000000n, true],
  ['one msat above', 1000001n, false], ['between denominations', 1500000n, false],
  ['one msat below', 1999999n, false], ['second denomination', 2000000n, true],
  ['above largest slot', 2000001n, false], ['u64 but not a slot', U64_MAX, false],
];

for (const [name, amount, accepted] of amountVectors) {
  test(`amount admission: ${name}`, () => {
    const state = book();
    const before = structuredClone(state);
    const result = reserve(state, request({ amount }));
    assert.equal(result !== REFUSAL, accepted);
    assert.equal(state.slots.filter((s) => s.issued).length, accepted ? 1 : 0);
    assert.equal(state.reservations.size, accepted ? 1 : 0);
    if (accepted) assert.equal(result.amount, state.slots[result.k].amount);
    else assert.deepEqual(state, before);
  });
}

test('fees do not change the requested denomination or receiver credit', () => {
  const state = book();
  const accepted = reserve(state, request());
  const fee = 1000n + (accepted.amount * 100n) / 1000000n;
  assert.equal(fee, 1200n);
  assert.equal(accepted.amount + fee, 2001200n);
  assert.equal(accepted.amount, 2000000n);
  assert.equal(reserve(book(), request({ amount: 2001200n })), REFUSAL);
});

test('slot selection uses equality; no combining, rounding or oversized voucher', () => {
  for (const amount of [500000n, 3000000n, 4000000n, 5000000n]) {
    assert.equal(reserve(book(), request({ amount })), REFUSAL);
  }
});

test('distinct requests consume distinct same-denomination slots then refuse', () => {
  const state = book();
  const first = reserve(state, request());
  const second = reserve(state, request({ metadataHash: 'metadata-b', digest: 'b' }));
  const third = reserve(state, request({ metadataHash: 'metadata-c', digest: 'c' }));
  assert.notEqual(first.hash, second.hash);
  assert.equal(third, REFUSAL);
  assert.equal(state.slots.filter((s) => s.issued).length, 2);
});

test('a second offer shares the same finite book inventory', () => {
  const state = book([2000000n]);
  reserve(state, request());
  assert.equal(reserve(state, request({ offer: 'offer-b', digest: 'b' })), REFUSAL);
  assert.equal(state.reservations.size, 1);
});

test('identical requests at the modeled atomic boundary allocate only once', () => {
  const state = book();
  const first = reserve(state, request());
  const second = reserve(state, request());
  assert.equal(first.hash, second.hash);
  assert.equal(state.slots.filter((s) => s.issued).length, 1);
  assert.equal(state.reservations.size, 1);
});

test('full-request changes under the same reservation key refuse without allocation', () => {
  const state = book();
  reserve(state, request());
  for (const changed of [
    { amount: 1000000n, digest: 'changed-amount' },
    { digest: 'changed-chain' }, { digest: 'changed-quantity' },
    { digest: 'changed-note' }, { digest: 'changed-unknown-tlv' },
  ]) assert.equal(reserve(state, request(changed)), REFUSAL);
  assert.equal(state.reservations.size, 1);
  assert.equal(state.slots.filter((s) => s.issued).length, 1);
});

test('an exact retry after a modeled restart preserves reservation and expiry', () => {
  const state = book([2000000n]);
  const first = reserve(state, request());
  const restarted = structuredClone(state);
  const retried = reserve(restarted, request({ now: 20, invoiceNotAfter: 99 }));
  assert.equal(retried.hash, first.hash);
  assert.equal(retried.amount, first.amount);
  assert.equal(retried.notAfter, first.notAfter);
  assert.equal(retried.response, 'fresh_invoice_required');
  assert.equal(restarted.reservations.size, 1);
});

test('expired, closed and deadline-bound retries cannot revive an issued slot', () => {
  const initial = book();
  reserve(initial, request());
  for (const changes of [
    { req: { now: 80 } }, { req: { now: 90 } }, { req: { now: 100 } },
    { req: { now: 20, offerExpires: 20 } },
    { req: { now: 20, invoiceNotAfter: 20 } }, { closed: true },
  ]) {
    const state = structuredClone(initial);
    if (changes.closed) state.closed = true;
    assert.equal(reserve(state, request(changes.req)), REFUSAL);
    assert.equal(state.reservations.size, 1);
    assert.equal(state.slots.filter((s) => s.issued).length, 1);
  }
});

test('a known paid slot cannot produce another payable response', () => {
  const state = book();
  const first = reserve(state, request());
  state.slots[first.k].knownPaid = true;
  assert.equal(reserve(state, request()), REFUSAL);
  assert.equal(state.reservations.size, 1);
});

test('the fixed refusal does not distinguish inventory, expiry or close', () => {
  const exhausted = book([]);
  const closed = book(); closed.closed = true;
  assert.deepEqual([
    reserve(book(), request({ amount: 1500000n })),
    reserve(exhausted, request()), reserve(closed, request()),
    reserve(book(), request({ now: 100 })),
  ], Array(4).fill(REFUSAL));
});
