/**
 * Abstract executable safety model for concurrent Variant D receive.
 * Run: node --test tools/concurrent-receive-model.test.mjs
 *
 * The two commitment views advance independently, with explicit persistence,
 * revocation transmission and acknowledgement boundaries. Amounts are integer
 * millisatoshis. A snapshot's balance oracle is independent of the mutation that
 * constructs a proposed successor. All currently broadcastable snapshots are
 * checked, including asymmetric intermediate states.
 *
 * This models protocol obligations, not a Lightning implementation. Signatures,
 * on-chain transactions, shachain, wire encoding, chain time, monitor availability,
 * fee estimation and cryptographic secrecy are not proved here. The activation
 * digest is a stable identity surrogate, not the normative H_act encoding. The
 * driver proposes one update round at a time; it does not enumerate arbitrary
 * overlapping update batches. An authenticated close decision is an honest
 * settlement-peer assumption, not proof that a peer has never learned a preimage.
 * Persistent storage is atomic in this model. Fee affordability uses a supplied
 * static obligation, not a dynamic commitment-weight or feerate calculation.
 *
 * crash(owner) resets a peer's modeled volatile memory and reconstructs received
 * revocation acknowledgements from durable records. The external test driver
 * retains its proposed logical operation in this.pending, and the logical network
 * retains transmitted messages and exact-retransmission availability. The tests do
 * not reconstruct or discard the whole coordinator plan after process loss. The
 * 630 crash positions therefore test modeled peer-memory resets and persistence
 * ordering, not complete production process restart or arbitrary message loss.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

const clone = value => structuredClone(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const peers = ['R', 'S'];
const other = peer => peer === 'R' ? 'S' : 'R';
const sum = values => values.reduce((total, value) => total + value, 0);
const ordinaryKey = (offerer, id) => `${offerer}:${id}`;

function fixture(options = {}) {
  const book = [
    { slot: 1, offerer: 'S', id: 40, amount: 5_000_000, hash: hash('secret-1'), expiry: 10_000 },
    { slot: 2, offerer: 'S', id: 41, amount: 3_000_000, hash: hash('secret-2'), expiry: 10_000 },
  ];
  return new Model(book, {
    initial: { R: 28_130_000, S: 100_000_000 },
    reserve: { R: 1_000_000, S: 1_000_000 },
    // The caller supplies a conservative fee obligation. There is no fee estimator.
    funder: 'S', feeBuffer: 1_000_000,
    limits: { R: { count: 3, value: 20_000_000 }, S: { count: 2, value: 8_000_000 } },
    dust: { R: 354_000, S: 546_000 },
    ...options,
  });
}

class Model {
  constructor(book, config) {
    this.book = clone(book);
    assert.equal(new Set(book.map(v => v.slot)).size, book.length, 'duplicate voucher slot');
    assert.equal(new Set(book.map(v => v.hash)).size, book.length, 'duplicate voucher hash');
    assert.equal(new Set(book.map(v => v.id)).size, book.length, 'duplicate voucher HTLC id');
    this.config = clone(config);
    this.activation = hash(JSON.stringify({ book, initial: config.initial }));
    this.upstream = new Map();
    this.settlement = Object.fromEntries(book.map(v => [v.slot, { state: 'UNUSED', consumed: false }]));
    this.durableSettlement = clone(this.settlement);
    this.proofs = {};
    this.durableProofs = {};
    this.mode = 'ACTIVE';
    this.durableMode = 'ACTIVE';
    this.closeDecision = {};
    this.network = { revocations: new Set(), preimages: [] };
    this.nextVersion = 1;
    this.pending = null;
    const first = {
      version: 0, activation: this.activation,
      balances: { R: config.initial.R, S: config.initial.S - sum(book.map(v => v.amount)) },
      vouchers: clone(book), dispositions: {}, resolvedAt: {}, ordinary: {},
      nextId: { R: 0, S: Math.max(...book.map(v => v.id)) + 1 },
    };
    this.disk = Object.fromEntries(peers.map(peer => [peer, {
      current: clone(first), next: null, revoked: [], peerAcknowledged: [], outbound: {},
    }]));
    this.memory = clone(this.disk);
    this.assertSnapshot(first);
  }

  // Recompute monetary allocations from obligations, not stored balance deltas.
  expectedBalances(snapshot) {
    const balance = { ...this.config.initial };
    for (const voucher of this.book) {
      const disposition = snapshot.dispositions[voucher.slot];
      if (disposition !== 'FAILED') balance.S -= voucher.amount;
      if (disposition === 'FULFILLED') balance.R += voucher.amount;
    }
    for (const htlc of Object.values(snapshot.ordinary)) {
      if (htlc.state !== 'FAILED') balance[htlc.offerer] -= htlc.amount;
      if (htlc.state === 'FULFILLED') balance[other(htlc.offerer)] += htlc.amount;
    }
    return balance;
  }

  assertSnapshot(snapshot) {
    assert.equal(snapshot.activation, this.activation, 'activation identity changed');
    assert.deepEqual(snapshot.balances, this.expectedBalances(snapshot), 'incorrect value allocation');
    const remaining = this.book.filter(v => !snapshot.dispositions[v.slot]);
    assert.deepEqual(snapshot.vouchers, remaining, 'voucher identity or backing changed');
    for (const [slot, disposition] of Object.entries(snapshot.dispositions)) {
      assert(this.book.some(v => v.slot === Number(slot)), 'unknown resolved slot');
      assert(['FULFILLED', 'FAILED'].includes(disposition), 'invalid voucher disposition');
      assert(Number.isSafeInteger(snapshot.resolvedAt[slot]) && snapshot.resolvedAt[slot] > 0
        && snapshot.resolvedAt[slot] <= snapshot.version, 'invalid resolution version');
    }
    assert.deepEqual(Object.keys(snapshot.resolvedAt), Object.keys(snapshot.dispositions), 'resolution history mismatch');
    for (const [key, htlc] of Object.entries(snapshot.ordinary)) {
      assert(peers.includes(htlc.offerer), 'invalid ordinary offerer');
      assert(Number.isSafeInteger(htlc.id) && htlc.id >= 0, 'invalid ordinary id');
      assert.equal(key, ordinaryKey(htlc.offerer, htlc.id), 'ordinary identity mismatch');
      assert(Number.isSafeInteger(htlc.amount) && htlc.amount > 0, 'invalid ordinary amount');
      assert(Number.isSafeInteger(htlc.expiry) && htlc.expiry > 0, 'invalid ordinary expiry');
      assert(/^[a-f0-9]{64}$/.test(htlc.hash), 'invalid ordinary hash');
      assert(['PENDING', 'FULFILLED', 'FAILED'].includes(htlc.state), 'invalid ordinary state');
    }
    for (const voucher of remaining) {
      for (const peer of peers) assert(voucher.amount >= this.config.dust[peer], 'trimmed voucher');
    }
    for (const peer of peers) {
      const obligation = this.config.reserve[peer] + (this.config.funder === peer ? this.config.feeBuffer : 0);
      assert(snapshot.balances[peer] >= obligation, `${peer} reserve or fee obligation exhausted`);
      const offered = [...remaining, ...Object.values(snapshot.ordinary).filter(h => h.state === 'PENDING')]
        .filter(h => other(h.offerer) === peer);
      assert(offered.length <= this.config.limits[peer].count, `${peer} incoming slots exhausted`);
      assert(sum(offered.map(h => h.amount)) <= this.config.limits[peer].value, `${peer} incoming value exhausted`);
    }
    const locked = sum(remaining.map(v => v.amount))
      + sum(Object.values(snapshot.ordinary).filter(h => h.state === 'PENDING').map(h => h.amount));
    assert.equal(snapshot.balances.R + snapshot.balances.S + locked,
      this.config.initial.R + this.config.initial.S, 'funds not conserved');
  }

  assertSuccessor(previous, successor) {
    this.assertSnapshot(successor);
    assert.equal(successor.version, previous.version + 1, 'unexpected commitment version');
    for (const voucher of this.book) {
      const before = previous.dispositions[voucher.slot];
      const after = successor.dispositions[voucher.slot];
      if (before) {
        assert.equal(after, before, 'resolved voucher resurrected or rewritten');
        assert.equal(successor.resolvedAt[voucher.slot], previous.resolvedAt[voucher.slot], 'resolution version changed');
      } else if (after) {
        assert.equal(successor.resolvedAt[voucher.slot], successor.version, 'wrong resolution version');
      }
      if (!before && after === 'FULFILLED') {
        assert.equal(hash(this.durableProofs[voucher.slot] ?? ''), voucher.hash, 'no durable valid preimage');
      }
      if (!before && after === 'FAILED') {
        assert.equal(this.durableMode, 'DRAINING', 'refund before admission closed');
        assert.equal(this.closeDecision[voucher.slot], 'UNUSED', 'refund without close authority');
        assert(!this.durableProofs[voucher.slot], 'cannot refund a known paid voucher');
      }
    }
    for (const [key, before] of Object.entries(previous.ordinary)) {
      const after = successor.ordinary[key];
      assert(after, 'ordinary HTLC history lost');
      assert.deepEqual({ ...after, state: before.state }, before, 'ordinary HTLC terms changed');
      if (before.state !== 'PENDING') assert.equal(after.state, before.state, 'resolved ordinary HTLC rewritten');
      assert(['PENDING', 'FULFILLED', 'FAILED'].includes(after.state), 'invalid ordinary disposition');
    }
    for (const peer of peers) {
      const added = Object.values(successor.ordinary)
        .filter(h => h.offerer === peer && !previous.ordinary[ordinaryKey(peer, h.id)])
        .sort((a, b) => a.id - b.id);
      added.forEach((h, i) => {
        assert.equal(h.id, previous.nextId[peer] + i, 'HTLC id reused or skipped');
        assert.equal(h.state, 'PENDING', 'new ordinary HTLC already resolved');
      });
      assert.equal(successor.nextId[peer], previous.nextId[peer] + added.length, 'offer counter rollback');
    }
  }

  propose(operations) {
    assert(!this.pending, 'another update is pending');
    assert.deepEqual(this.disk.R.current, this.disk.S.current, 'views are not synchronized');
    assert(['ACTIVE', 'DRAINING'].includes(this.mode), 'ordinary traffic disabled');
    const previous = this.disk.R.current;
    const successor = clone(previous);
    successor.version = this.nextVersion;
    for (const operation of operations) {
      if (operation.type === 'add') {
        const offerer = operation.offerer;
        assert(peers.includes(offerer), 'unknown offerer');
        assert(Number.isSafeInteger(operation.amount) && operation.amount > 0, 'invalid ordinary amount');
        const id = successor.nextId[offerer]++;
        successor.ordinary[ordinaryKey(offerer, id)] = {
          offerer, id, amount: operation.amount, hash: hash(`ordinary-${offerer}-${id}`),
          expiry: 500, state: 'PENDING',
        };
        successor.balances[offerer] -= operation.amount;
      } else if (operation.type === 'resolveOrdinary') {
        const htlc = successor.ordinary[ordinaryKey(operation.offerer, operation.id)];
        assert(htlc?.state === 'PENDING', 'ordinary HTLC not pending');
        assert(['FULFILLED', 'FAILED'].includes(operation.result), 'invalid resolution');
        htlc.state = operation.result;
        successor.balances[operation.result === 'FULFILLED' ? other(htlc.offerer) : htlc.offerer] += htlc.amount;
      } else if (operation.type === 'redeem' || operation.type === 'refund') {
        const voucher = successor.vouchers.find(v => v.slot === operation.slot);
        assert(voucher, 'voucher no longer present');
        successor.vouchers = successor.vouchers.filter(v => v.slot !== operation.slot);
        const fulfilled = operation.type === 'redeem';
        successor.dispositions[operation.slot] = fulfilled ? 'FULFILLED' : 'FAILED';
        successor.resolvedAt[operation.slot] = successor.version;
        successor.balances[fulfilled ? 'R' : 'S'] += voucher.amount;
      } else {
        assert.fail('unknown operation');
      }
    }
    this.assertSuccessor(previous, successor);
    this.pending = { previous: clone(previous), successor, acknowledgements: new Set() };
    return clone(successor);
  }

  receiveSignature(owner) {
    assert(this.pending, 'no update');
    assert(!this.memory[owner].next, 'signature already received');
    this.assertSuccessor(this.memory[owner].current, this.pending.successor);
    // The signer retains its sent transcript durably before delivery. A crash of
    // the receiver before its own persistence permits an exact retransmission.
    const signer = other(owner);
    const version = this.pending.successor.version;
    const sent = this.disk[signer].outbound[version];
    if (sent) assert.deepEqual(sent, this.pending.successor, 'different replayed successor');
    this.disk[signer].outbound[version] = clone(this.pending.successor);
    this.memory[signer].outbound = clone(this.disk[signer].outbound);
    this.memory[owner].next = clone(this.disk[signer].outbound[version]);
  }

  persistSuccessor(owner) {
    assert(this.memory[owner].next, 'no received successor');
    this.disk[owner] = clone(this.memory[owner]);
  }

  revokePrevious(owner) {
    const durable = this.disk[owner];
    assert(durable.next, 'cannot revoke before successor is durable');
    this.assertSuccessor(durable.current, durable.next);
    const previousVersion = durable.current.version;
    durable.revoked.push(previousVersion);
    durable.current = durable.next;
    durable.next = null;
    this.memory[owner] = clone(durable);
    // This transmission follows persistence of the successor and revocation.
    this.network.revocations.add(`${owner}:${previousVersion}`);
  }

  acknowledgeRevocation(owner) {
    const version = this.pending.previous.version;
    assert(this.network.revocations.has(`${owner}:${version}`), 'revocation has not been transmitted');
    const peer = other(owner);
    if (!this.disk[peer].peerAcknowledged.includes(version)) this.disk[peer].peerAcknowledged.push(version);
    this.memory[peer].peerAcknowledged = clone(this.disk[peer].peerAcknowledged);
    this.pending.acknowledgements.add(owner);
  }

  resolutionFinal(slot) {
    return peers.every(peer => {
      const view = this.disk[peer];
      return view.current.dispositions[slot]
        && this.disk[other(peer)].peerAcknowledged.includes(view.current.resolvedAt[slot] - 1);
    });
  }

  finishRound() {
    assert(this.pending?.acknowledgements.size === 2, 'round is not irrevocable');
    assert.deepEqual(this.disk.R.current, this.disk.S.current);
    this.pending = null;
    this.nextVersion++;
  }

  complete(operations) {
    this.propose(operations);
    for (const peer of peers) {
      this.receiveSignature(peer);
      this.persistSuccessor(peer);
      this.revokePrevious(peer);
      this.acknowledgeRevocation(peer);
    }
    this.finishRound();
    this.assertSafety();
  }

  crash(owner) {
    this.memory[owner] = clone(this.disk[owner]);
    if (owner === 'S') {
      this.settlement = clone(this.durableSettlement);
      this.mode = this.durableMode;
    } else {
      this.proofs = clone(this.durableProofs);
    }
    if (this.pending) {
      const previous = this.pending.previous.version;
      this.pending.acknowledgements = new Set(peers.filter(peer =>
        this.disk[other(peer)].peerAcknowledged.includes(previous)));
    }
  }

  commitUpstream(slot, htlcId) {
    assert(!this.upstream.has(htlcId), 'duplicate upstream HTLC identity');
    this.upstream.set(htlcId, { slot, irrevocable: true });
  }

  prepareSettlement(slot, htlcId) {
    assert.equal(this.durableMode, 'ACTIVE', 'delegated admission closed');
    assert.equal(this.upstream.get(htlcId)?.slot, slot, 'upstream HTLC not irrevocably committed');
    assert.equal(this.settlement[slot].state, 'UNUSED', 'slot consumed');
    this.settlement[slot] = { state: 'SETTLING', consumed: true, upstreamId: htlcId };
  }

  persistSettlement() {
    this.durableSettlement = clone(this.settlement);
  }

  releasePreimage(slot, htlcId) {
    const state = this.durableSettlement[slot];
    assert(state.consumed && state.upstreamId === htlcId, 'no durable matching settlement decision');
    assert(['SETTLING', 'SETTLED'].includes(state.state), 'slot not settled');
    const preimage = `secret-${slot}`;
    this.network.preimages.push({ slot, htlcId, preimage });
    state.state = 'SETTLED';
    this.settlement = clone(this.durableSettlement);
    return preimage;
  }

  learnPreimage(slot, preimage, persist = true) {
    assert.equal(hash(preimage), this.book.find(v => v.slot === slot)?.hash, 'wrong preimage');
    this.proofs[slot] = preimage;
    if (persist) this.durableProofs[slot] = preimage;
  }

  pay(slot, htlcId = `upstream-${slot}`) {
    this.commitUpstream(slot, htlcId);
    this.prepareSettlement(slot, htlcId);
    this.persistSettlement();
    this.learnPreimage(slot, this.releasePreimage(slot, htlcId));
  }

  closeAdmission() {
    // The serial S decision is persisted before a signed close result is exposed.
    this.persistSettlement();
    this.durableMode = this.mode = 'DRAINING';
    this.closeDecision = Object.fromEntries(Object.entries(this.durableSettlement)
      .map(([slot, state]) => [slot, state.consumed ? 'SETTLED' : 'UNUSED']));
    return clone(this.closeDecision);
  }

  assertSafety() {
    for (const peer of peers) {
      const view = this.disk[peer];
      this.assertSnapshot(view.current);
      if (view.next) this.assertSnapshot(view.next);
      assert(!view.revoked.includes(view.current.version), 'current commitment is revoked');
      for (const version of view.revoked) {
        assert(view.current.version > version, 'revoked without durable replacement');
      }
    }
    for (const record of this.network.preimages) {
      const durable = this.durableSettlement[record.slot];
      assert(durable.consumed && durable.upstreamId === record.htlcId, 'unbacked preimage release');
    }
  }
}

function interleavings(left, right) {
  if (!left.length) return [right];
  if (!right.length) return [left];
  return [
    ...interleavings(left.slice(1), right).map(rest => [left[0], ...rest]),
    ...interleavings(left, right.slice(1)).map(rest => [right[0], ...rest]),
  ];
}

const stages = ['receiveSignature', 'persistSuccessor', 'revokePrevious', 'acknowledgeRevocation'];
const schedules = interleavings(stages.map(method => ['R', method]), stages.map(method => ['S', method]));

test('all 70 bilateral interleavings retain either voucher or full redemption credit', () => {
  assert.equal(schedules.length, 70);
  for (const schedule of schedules) {
    const model = fixture();
    model.pay(1);
    model.propose([{ type: 'redeem', slot: 1 }]);
    for (const [owner, method] of schedule) {
      model[method](owner);
      model.assertSafety();
      const bothAcked = model.pending.acknowledgements.size === 2;
      assert.equal(model.resolutionFinal(1), bothAcked, 'resolution declared before both acknowledgements');
      for (const peer of peers) {
        const snapshot = model.disk[peer].current;
        assert.equal(snapshot.balances.R + (snapshot.vouchers.some(v => v.slot === 1) ? 5_000_000 : 0),
          33_130_000, 'partial transition lost the receiver allocation');
        assert(snapshot.vouchers.some(v => v.slot === 2), 'unpaid invoice lost its backing');
      }
    }
    model.finishRound();
    assert(model.resolutionFinal(1));
  }
});

test('630 crash positions across bilateral schedules recover or retransmit safely', () => {
  let positions = 0;
  for (const schedule of schedules) {
    for (let crashAfter = 0; crashAfter <= schedule.length; crashAfter++) {
      const model = fixture();
      model.pay(1);
      model.propose([{ type: 'redeem', slot: 1 }]);
      for (let i = 0; i <= schedule.length; i++) {
        if (i === crashAfter) {
          for (const peer of peers) model.crash(peer);
          model.assertSafety();
          positions++;
        }
        if (i === schedule.length) break;
        const [owner, method] = schedule[i];
        // An unpersisted received signature is retransmitted after restart.
        if (method === 'persistSuccessor' && !model.memory[owner].next) model.receiveSignature(owner);
        model[method](owner);
        model.assertSafety();
      }
      model.finishRound();
      assert(model.resolutionFinal(1));
      assert.equal(model.disk.R.current.activation, model.activation);
    }
  }
  assert.equal(positions, 630);
});

test('revocation and resolution cannot precede durable successor material', () => {
  const model = fixture();
  model.pay(1);
  model.propose([{ type: 'redeem', slot: 1 }]);
  model.receiveSignature('R');
  assert.throws(() => model.revokePrevious('R'), /durable/);
  assert.throws(() => model.acknowledgeRevocation('R'), /not been transmitted/);
  assert.throws(() => model.finishRound(), /not irrevocable/);
  assert.equal(model.network.revocations.size, 0);
  model.crash('R');
  assert.equal(model.memory.R.next, null);
  assert.equal(model.disk.R.current.version, 0);
  assert.equal(model.resolutionFinal(1), false);
});

test('wrong voucher id, amount, hash, expiry, direction or missing backing is rejected', () => {
  for (const [field, value] of [
    ['id', 39], ['amount', 4_999_000], ['hash', hash('substitute')],
    ['expiry', 9_999], ['offerer', 'R'], ['slot', 3],
  ]) {
    const model = fixture();
    const invalid = clone(model.disk.R.current);
    invalid.version++;
    invalid.vouchers[0][field] = value;
    assert.throws(() => model.assertSuccessor(model.disk.R.current, invalid), /backing changed/);
  }
  const model = fixture();
  const invalid = clone(model.disk.R.current);
  invalid.version++;
  invalid.vouchers.shift();
  assert.throws(() => model.assertSuccessor(model.disk.R.current, invalid), /backing changed/);
  assert.throws(() => model.propose([{ type: 'redeem', slot: 1 }]), /preimage/);
  assert.throws(() => model.propose([{ type: 'refund', slot: 1 }]), /admission closed/);
});

test('conservation alone cannot approve redirecting a paid voucher to the peer', () => {
  const model = fixture();
  model.pay(1);
  const invalid = model.propose([{ type: 'redeem', slot: 1 }]);
  invalid.balances.R -= 5_000_000;
  invalid.balances.S += 5_000_000;
  assert.throws(() => model.assertSuccessor(model.disk.R.current, invalid), /incorrect value allocation/);
});

test('preimage release requires the exact irrevocable upstream HTLC and durable decision', () => {
  const model = fixture();
  assert.throws(() => model.prepareSettlement(1, 'missing'), /irrevocably committed/);
  model.commitUpstream(1, 'first');
  model.prepareSettlement(1, 'first');
  assert.throws(() => model.releasePreimage(1, 'first'), /durable matching/);
  assert.equal(model.network.preimages.length, 0);
  model.crash('S');
  assert.equal(model.settlement[1].state, 'UNUSED');
  model.prepareSettlement(1, 'first');
  model.persistSettlement();
  model.crash('S');
  assert.equal(model.settlement[1].state, 'SETTLING');
  model.commitUpstream(1, 'second');
  assert.throws(() => model.prepareSettlement(1, 'second'), /consumed/);
  assert.throws(() => model.releasePreimage(1, 'second'), /durable matching/);
  const first = model.releasePreimage(1, 'first');
  model.crash('S');
  assert.equal(model.releasePreimage(1, 'first'), first, 'retry must reveal the same secret');
  model.assertSafety();
});

test('165 delegated-settlement interleavings preserve ordinary payments in both directions', () => {
  const channelEvents = peers.flatMap(peer => stages.map(method => [peer, method]));
  const settlementEvents = [
    ['settlement', 'prepare'], ['settlement', 'persist'], ['settlement', 'release'],
  ];
  const races = interleavings(channelEvents, settlementEvents);
  assert.equal(races.length, 165);
  for (const sequence of races) {
    const model = fixture();
    model.commitUpstream(1, 'concurrent');
    model.propose([
      { type: 'add', offerer: 'R', amount: 2_000_000 },
      { type: 'add', offerer: 'S', amount: 1_000_000 },
    ]);
    for (const [actor, event] of sequence) {
      if (actor !== 'settlement') model[event](actor);
      else if (event === 'prepare') model.prepareSettlement(1, 'concurrent');
      else if (event === 'persist') model.persistSettlement();
      else model.learnPreimage(1, model.releasePreimage(1, 'concurrent'));
      model.assertSafety();
    }
    model.finishRound();
    model.complete([{ type: 'redeem', slot: 1 }]);
    const state = model.disk.R.current;
    assert.equal(state.ordinary['R:0'].state, 'PENDING');
    assert.equal(state.ordinary['S:42'].state, 'PENDING');
    assert.equal(state.vouchers.length, 1);
    assert.equal(state.vouchers[0].slot, 2);
    assert.equal(state.balances.R, 31_130_000);
    assert.equal(state.balances.S, 91_000_000);
  }
});

test('volatile or invalid preimages cannot authorize a durable redemption', () => {
  const model = fixture();
  assert.throws(() => model.learnPreimage(1, 'wrong'), /wrong preimage/);
  model.commitUpstream(1, 'first');
  model.prepareSettlement(1, 'first');
  model.persistSettlement();
  const preimage = model.releasePreimage(1, 'first');
  model.learnPreimage(1, preimage, false);
  assert.throws(() => model.propose([{ type: 'redeem', slot: 1 }]), /durable valid preimage/);
  model.crash('R');
  assert.equal(model.proofs[1], undefined);
  model.learnPreimage(1, preimage);
  model.complete([{ type: 'redeem', slot: 1 }]);
});

test('remaining directional slots and value limits apply independently', () => {
  const incoming = fixture();
  incoming.complete([{ type: 'add', offerer: 'S', amount: 1_000_000 }]);
  assert.throws(() => incoming.propose([{ type: 'add', offerer: 'S', amount: 1_000_000 }]), /R incoming slots/);
  incoming.complete([{ type: 'add', offerer: 'R', amount: 3_000_000 }]);
  incoming.complete([{ type: 'add', offerer: 'R', amount: 3_000_000 }]);
  assert.throws(() => incoming.propose([{ type: 'add', offerer: 'R', amount: 1_000_000 }]), /S incoming slots/);
  const value = fixture();
  assert.throws(() => value.propose([{ type: 'add', offerer: 'R', amount: 8_000_001 }]), /S incoming value/);
  assert.throws(() => value.propose([{ type: 'add', offerer: 'S', amount: 12_000_001 }]), /R incoming value/);
  assert.equal(value.disk.S.current.balances.S, 92_000_000, 'voucher budget was reserved exactly once');
});

test('reserve, funder fee obligation and both dust floors constrain admission', () => {
  const limits = { R: { count: 20, value: 200_000_000 }, S: { count: 20, value: 200_000_000 } };
  for (const funder of peers) {
    const model = fixture({ funder, limits });
    const spendable = model.disk.R.current.balances[funder] - model.config.reserve[funder] - model.config.feeBuffer;
    assert.throws(() => model.propose([{ type: 'add', offerer: funder, amount: spendable + 1 }]), /fee obligation/);
    model.complete([{ type: 'add', offerer: funder, amount: spendable }]);
    model.assertSafety();
  }
  assert.throws(() => fixture({ dust: { R: 354_000, S: 3_000_001 } }), /trimmed voucher/);
});

test('ACTIVE and DRAINING permit new ordinary traffic without retiring unresolved vouchers', () => {
  const model = fixture();
  const activation = model.activation;
  model.complete([{ type: 'add', offerer: 'R', amount: 2_000_000 }]);
  model.closeAdmission();
  model.complete([{ type: 'resolveOrdinary', offerer: 'R', id: 0, result: 'FULFILLED' }]);
  model.complete([{ type: 'add', offerer: 'S', amount: 1_000_000 }]);
  model.complete([{ type: 'resolveOrdinary', offerer: 'S', id: 42, result: 'FAILED' }]);
  model.complete([{ type: 'add', offerer: 'R', amount: 1_000_000 }]);
  for (const peer of peers) model.crash(peer);
  assert.equal(model.mode, 'DRAINING');
  assert.equal(model.disk.R.current.vouchers.length, 2);
  assert.equal(model.disk.R.current.activation, activation);
  assert.equal(model.disk.R.current.nextId.S, 43);
  model.commitUpstream(1, 'too-late');
  assert.throws(() => model.prepareSettlement(1, 'too-late'), /admission closed/);
});

test('redeemed slots stay consumed while other invoices and ordinary payments continue', () => {
  const model = fixture();
  model.pay(1);
  model.complete([{ type: 'redeem', slot: 1 }]);
  model.complete([{ type: 'add', offerer: 'R', amount: 5_000_000 }]);
  model.complete([{ type: 'resolveOrdinary', offerer: 'R', id: 0, result: 'FULFILLED' }]);
  for (const peer of peers) model.crash(peer);
  assert.equal(model.mode, 'ACTIVE');
  assert(model.disk.R.current.vouchers.some(v => v.slot === 2));
  model.learnPreimage(1, 'secret-1');
  assert.throws(() => model.propose([{ type: 'redeem', slot: 1 }]), /no longer present/);
  model.commitUpstream(1, 'duplicate');
  assert.throws(() => model.prepareSettlement(1, 'duplicate'), /consumed/);
  assert.equal(model.closeAdmission()[1], 'SETTLED', 'close bitmap must include previously redeemed slots');
  assert.equal(model.disk.R.current.nextId.S, 42);
});

test('final redemption stays final through unrelated later updates and crashes', () => {
  const model = fixture();
  model.pay(1);
  model.complete([{ type: 'redeem', slot: 1 }]);
  model.propose([{ type: 'add', offerer: 'R', amount: 1_000_000 }]);
  for (const peer of peers) {
    for (const stage of stages) {
      model[stage](peer);
      model.crash(peer);
      assert(model.resolutionFinal(1));
      if (stage === 'receiveSignature') model.receiveSignature(peer);
    }
  }
  model.finishRound();
  assert(model.resolutionFinal(1));
});

test('both settlement-versus-close orders are final and crash stable', () => {
  for (const settleFirst of [true, false]) {
    const model = fixture();
    model.commitUpstream(1, 'race');
    if (settleFirst) {
      model.prepareSettlement(1, 'race');
      model.persistSettlement();
      assert.equal(model.closeAdmission()[1], 'SETTLED');
      model.crash('S');
      model.learnPreimage(1, model.releasePreimage(1, 'race'));
      assert.throws(() => model.propose([{ type: 'refund', slot: 1 }]), /close authority/);
      model.complete([{ type: 'redeem', slot: 1 }]);
    } else {
      assert.equal(model.closeAdmission()[1], 'UNUSED');
      model.crash('S');
      assert.throws(() => model.prepareSettlement(1, 'race'), /admission closed/);
      model.complete([{ type: 'refund', slot: 1 }]);
    }
    assert(model.resolutionFinal(1));
    assert.equal(model.disk.R.current.vouchers.length, 1);
    model.assertSafety();
  }
});

test('a learned preimage overrides an unused close claim and ids cannot roll back', () => {
  const model = fixture();
  model.closeAdmission();
  model.learnPreimage(1, 'secret-1');
  assert.throws(() => model.propose([{ type: 'refund', slot: 1 }]), /known paid voucher/);
  model.complete([{ type: 'redeem', slot: 1 }]);
  model.complete([{ type: 'add', offerer: 'S', amount: 1_000_000 }]);
  model.complete([{ type: 'resolveOrdinary', offerer: 'S', id: 42, result: 'FAILED' }]);
  const invalid = clone(model.disk.R.current);
  invalid.version++;
  invalid.nextId.S = 42;
  assert.throws(() => model.assertSuccessor(model.disk.R.current, invalid), /counter rollback/);
});

test('historical activation state is no longer a safe broadcast after ordinary updates', () => {
  const model = fixture();
  const activationSnapshot = clone(model.disk.R.current);
  model.complete([{ type: 'add', offerer: 'R', amount: 1_000_000 }]);
  assert(model.disk.R.revoked.includes(activationSnapshot.version));
  assert.equal(model.disk.R.current.activation, activationSnapshot.activation);
  const stale = clone(model.disk.R.current);
  stale.version++;
  stale.activation = hash('a replacement activation');
  assert.throws(() => model.assertSuccessor(model.disk.R.current, stale), /activation identity changed/);
  // A rollback is an explicit unsafe input, not a state the model can repair.
  model.disk.R.current = activationSnapshot;
  assert.throws(() => model.assertSafety(), /current commitment is revoked/);
});
