// Executable model of CONCURRENT-RECEIVE.md section 5, not a production codec.
// Dummy signature bytes exercise framing and digest boundaries only. This suite
// does not verify ECDSA, authentication, persistence, or channel transactions.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/concurrent-receive-wire.json', import.meta.url)));
const REQUEST = 55075;
const REPLY = 55077;
const MAX_FRAME = 65535;
const MAX_SLOTS = 483;
const TAG = Buffer.from('ffor/msg', 'ascii');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest();
const same = (a, b) => a.equals(b);

function uint(value, size) {
  const result = Buffer.alloc(size);
  if (size === 8) result.writeBigUInt64BE(BigInt(value));
  else result.writeUIntBE(Number(value), 0, size);
  return result;
}

function bigSize(value) {
  const n = BigInt(value);
  if (n < 0n || n > 0xffffffffffffffffn) throw new Error('BigSize range');
  if (n < 253n) return uint(n, 1);
  if (n <= 65535n) return Buffer.concat([Buffer.from([253]), uint(n, 2)]);
  if (n <= 4294967295n) return Buffer.concat([Buffer.from([254]), uint(n, 4)]);
  return Buffer.concat([Buffer.from([255]), uint(n, 8)]);
}

class Reader {
  constructor(bytes) { this.bytes = bytes; this.offset = 0; }
  get remaining() { return this.bytes.length - this.offset; }
  take(length) {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {
      throw new Error('truncated field');
    }
    const result = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }
  uint(size) {
    const bytes = this.take(size);
    return size === 8 ? bytes.readBigUInt64BE() : bytes.readUIntBE(0, size);
  }
  bigSize() {
    const prefix = this.uint(1);
    if (prefix < 253) return BigInt(prefix);
    const n = BigInt(this.uint(prefix === 253 ? 2 : prefix === 254 ? 4 : 8));
    const minimum = prefix === 253 ? 253n : prefix === 254 ? 65536n : 4294967296n;
    if (n < minimum) throw new Error('noncanonical BigSize');
    return n;
  }
}

function encodeTlvs(entries = []) {
  return Buffer.concat(entries.flatMap(([type, value]) => [bigSize(type), bigSize(value.length), value]));
}

function readTlvs(reader) {
  const entries = [];
  let previous = -1n;
  while (reader.remaining) {
    const type = reader.bigSize();
    const length = reader.bigSize();
    if (type <= previous) throw new Error('TLV order or duplicate');
    if (type % 2n === 0n) throw new Error('unknown even TLV');
    // Check the encoded length before converting it to Number or allocating.
    if (length > BigInt(reader.remaining)) throw new Error('truncated TLV');
    entries.push([type, reader.take(Number(length))]);
    previous = type;
  }
  return entries;
}

function book(slots) {
  if (!Number.isInteger(slots) || slots < 1 || slots > MAX_SLOTS) throw new Error('fixture book size');
  const preimages = Array.from({ length: slots }, (_, i) => Buffer.concat([Buffer.alloc(28), uint(i + 1, 4)]));
  return {
    channel: Buffer.alloc(32, 0x11), epoch: Buffer.alloc(32, 0x22), activation: Buffer.alloc(32, 0x33),
    nonce: Buffer.alloc(32, 0x44), signature: Buffer.alloc(64, 0x55),
    slots, preimages, hashes: preimages.map(sha256),
  };
}

function signedFrame(type, b, fields, tlvs = [], signature = b.signature) {
  return Buffer.concat([uint(type, 2), b.channel, b.epoch, ...fields, encodeTlvs(tlvs), signature]);
}

function request(b, { nonce = b.nonce, tlvs = [], signature = b.signature } = {}) {
  return signedFrame(REQUEST, b, [b.activation, nonce], tlvs, signature);
}

function bitmapFor(slots, settled) {
  const bitmap = Buffer.alloc(Math.ceil(slots / 8));
  for (const k of settled) {
    if (!Number.isInteger(k) || k < 1 || k > slots) throw new Error('fixture slot range');
    bitmap[Math.floor((k - 1) / 8)] |= 1 << ((k - 1) % 8);
  }
  return bitmap;
}

function response(b, { seq = 7n, settled = Array.from({ length: b.slots }, (_, i) => i + 1),
  nonce = b.nonce, tlvs = [], signature = b.signature } = {}) {
  return signedFrame(REPLY, b, [b.activation, nonce, uint(seq, 8), uint(b.slots, 2),
    bitmapFor(b.slots, settled), uint(settled.length, 2),
    ...settled.flatMap((k) => [uint(k, 2), b.preimages[k - 1]])], tlvs, signature);
}

function digest(frame) { return sha256(Buffer.concat([TAG, frame.subarray(0, -64)])); }

function readEnvelope(frame, expectedType, b, minimum) {
  if (frame.length > MAX_FRAME) throw new Error('overlong frame');
  if (frame.length < minimum) throw new Error('truncated frame');
  const reader = new Reader(frame.subarray(0, -64));
  if (reader.uint(2) !== expectedType) throw new Error('message type');
  if (!same(reader.take(32), b.channel)) throw new Error('channel mismatch');
  if (!same(reader.take(32), b.epoch)) throw new Error('epoch mismatch');
  if (!same(reader.take(32), b.activation)) throw new Error('activation mismatch');
  return { reader, nonce: reader.take(32), signature: frame.subarray(-64) };
}

function parseRequest(frame, b) {
  const result = readEnvelope(frame, REQUEST, b, 194);
  return { nonce: result.nonce, signature: result.signature, tlvs: readTlvs(result.reader), digest: digest(frame) };
}

function parseResponse(frame, b) {
  const { reader, nonce, signature } = readEnvelope(frame, REPLY, b, 206);
  const seq = reader.uint(8);
  const canonicalStart = reader.offset;
  const slots = reader.uint(2);
  if (slots < 1 || slots > MAX_SLOTS || slots !== b.slots) throw new Error('book size mismatch');
  const bitmap = reader.take(Math.ceil(slots / 8));
  if (slots % 8 && (bitmap.at(-1) & (0xff << (slots % 8)))) throw new Error('bitmap padding');
  const settled = Array.from({ length: slots }, (_, i) => i + 1)
    .filter((k) => bitmap[Math.floor((k - 1) / 8)] & (1 << ((k - 1) % 8)));
  const count = reader.uint(2);
  if (count > slots || count !== settled.length) throw new Error('preimage count/popcount');
  if (count * 34 > reader.remaining) throw new Error('truncated preimage entries');
  const preimages = new Map();
  for (let i = 0; i < count; i += 1) {
    const k = reader.uint(2);
    if (k < 1 || k > slots) throw new Error('preimage index range');
    if (k !== settled[i]) throw new Error('preimage index order or bitmap mismatch');
    const preimage = reader.take(32);
    if (!same(sha256(preimage), b.hashes[k - 1])) throw new Error('preimage hash mismatch');
    preimages.set(k, preimage);
  }
  const canonical = reader.bytes.subarray(canonicalStart, reader.offset);
  const tlvs = readTlvs(reader);
  return { seq, slots, bitmap, settled, preimages, canonical, nonce, signature, tlvs, digest: digest(frame) };
}

// A receiver evidence model only: no signatures, channel updates or storage are
// simulated. Its input must have passed the wire and hash checks above.
function receiver() {
  return { seq: null, canonical: null, settled: new Set(), evidence: new Map(), consumed: new Set(),
    nonce: null, phase: 'ACTIVE' };
}

function acceptSnapshot(state, parsed) {
  for (const [k, preimage] of parsed.preimages) state.evidence.set(k, preimage);
  if (state.nonce === null || !same(parsed.nonce, state.nonce)) return 'uncorrelated';
  if (state.seq !== null && parsed.seq < state.seq) return 'stale';
  if (state.seq !== null && parsed.seq === state.seq) {
    if (!same(parsed.canonical, state.canonical)) throw new Error('conflicting equal sequence');
    return 'unchanged';
  }
  if ([...state.settled].some((k) => !parsed.preimages.has(k))) throw new Error('higher sequence lost settled slot');
  state.seq = parsed.seq;
  state.canonical = Buffer.from(parsed.canonical);
  state.settled = new Set(parsed.settled);
  return 'advanced';
}

function replace(frame, offset, bytes) {
  const copy = Buffer.from(frame);
  bytes.copy(copy, offset);
  return copy;
}

function appendRawTlv(frame, bytes) { return Buffer.concat([frame.subarray(0, -64), bytes, frame.subarray(-64)]); }
const countOffset = (slots) => 140 + Math.ceil(slots / 8);
const entryOffset = (slots, entry = 0) => countOffset(slots) + 2 + entry * 34;

// Negotiation decision model; base feature parsing and signed setup transcripts
// are outside this file. These values are the decoded TLV 17 payloads.
function selectMode({ rFeatures, sFeatures, requested, echoed, variant = 4, hashChain = false }) {
  if (requested === undefined) {
    if (echoed !== undefined) throw new Error('unsolicited mode echo');
    return 'legacy';
  }
  const supported = (features, bit) => features.includes(bit) || features.includes(bit + 1);
  if (![rFeatures, sFeatures].every((features) => supported(features, 560) && supported(features, 562))) {
    throw new Error('missing negotiated feature');
  }
  if (variant !== 4 || hashChain) throw new Error('unsupported concurrent profile');
  if (requested.length !== 2 || requested.toString('hex') !== '0001') throw new Error('unsupported mode value');
  if (echoed === undefined || !same(requested, echoed)) throw new Error('missing or different mode echo');
  return 'concurrent-v1';
}

test('concurrent negotiation needs both feature pairs and exact signed TLV 17 selection', () => {
  const mode = Buffer.from('0001', 'hex');
  assert.equal(encodeTlvs([[17n, mode]]).toString('hex'), '11020001');
  const options = { rFeatures: [561, 563], sFeatures: [560, 562], requested: mode, echoed: mode };
  assert.equal(selectMode(options), 'concurrent-v1');
  assert.equal(selectMode({ ...options, requested: undefined, echoed: undefined }), 'legacy');
  assert.throws(() => selectMode({ ...options, requested: undefined }), /unsolicited/);
  assert.throws(() => selectMode({ ...options, echoed: undefined }), /mode echo/);
  for (const features of [[], [561], [563]]) {
    assert.throws(() => selectMode({ ...options, rFeatures: features }), /feature/);
    assert.throws(() => selectMode({ ...options, sFeatures: features }), /feature/);
  }
  for (const hex of ['', '01', '000100', '0000', '0002']) {
    assert.throws(() => selectMode({ ...options, requested: Buffer.from(hex, 'hex') }), /mode value/);
    assert.throws(() => selectMode({ ...options, echoed: Buffer.from(hex, 'hex') }), /mode echo/);
  }
  for (const variant of [1, 2, 3]) {
    assert.throws(() => selectMode({ ...options, variant }), /profile/);
  }
  assert.throws(() => selectMode({ ...options, hashChain: true }), /profile/);
});

test('request has pinned full bytes, one-SHA256 digest and 194-byte framing', () => {
  const b = book(1);
  const frame = request(b);
  assert.equal(frame.length, 194);
  assert.equal(frame.toString('hex'), fixture.request.hex);
  assert.equal(parseRequest(frame, b).digest.toString('hex'), fixture.request.digest);
});

for (const slots of [1, 9, 483]) {
  test(`complete ${slots}-slot reply matches independently serialized pinned fixture`, () => {
    const b = book(slots);
    const frame = response(b);
    const expected = fixture.responses[String(slots)];
    assert.equal(frame.length, 206 + Math.ceil(slots / 8) + 34 * slots);
    assert.equal(frame.length, expected.bytes);
    assert.equal(frame.toString('hex'), expected.hex);
    const parsed = parseResponse(frame, b);
    assert.equal(parsed.digest.toString('hex'), expected.digest);
    assert.equal(parsed.preimages.size, slots);
    assert.equal(parsed.bitmap.toString('hex'), expected.bitmap);
    assert.equal(sha256(b.preimages[0]).toString('hex'), fixture.first_preimage_hash);
    assert.equal(sha256(b.preimages.at(-1)).toString('hex'), expected.last_preimage_hash);
    if (slots === 483) assert.equal(frame.length, 16689);
  });
}

test('slot bits cross byte boundaries using least-significant-bit-first order', () => {
  const b = book(9);
  const parsed = parseResponse(response(b, { settled: [1, 8, 9] }), b);
  assert.equal(parsed.bitmap.toString('hex'), '8101');
  assert.deepEqual([...parsed.preimages.keys()], [1, 8, 9]);
});

test('empty sequence-zero snapshot has no preimages and is an accepted first observation', () => {
  const b = book(9);
  const parsed = parseResponse(response(b, { seq: 0n, settled: [] }), b);
  assert.equal(parsed.preimages.size, 0);
  assert.equal(parsed.bitmap.toString('hex'), '0000');
  const state = receiver();
  state.nonce = b.nonce;
  assert.equal(acceptSnapshot(state, parsed), 'advanced');
  assert.equal(state.seq, 0n);
});

test('canonical odd TLVs of all BigSize widths are preserved and signed', () => {
  const b = book(1);
  const tlvs = [[1n, Buffer.from('aabb', 'hex')], [253n, Buffer.alloc(253, 0x66)],
    [65537n, Buffer.alloc(0)], [4294967297n, Buffer.from([7])]];
  const parsed = parseResponse(response(b, { tlvs }), b);
  assert.deepEqual(parsed.tlvs, tlvs);
  const requestWithTlvs = request(b, { tlvs: [[1n, Buffer.from('aabb', 'hex')]] });
  assert.equal(parseRequest(requestWithTlvs, b).digest.toString('hex'), fixture.odd_tlv_request_digest);
  assert.notDeepEqual(digest(requestWithTlvs), digest(request(b)));
  assert.equal(parseRequest(requestWithTlvs, b).tlvs[0][1].toString('hex'), 'aabb');
});

test('dummy signatures are excluded from the digest but header and nonce bytes are included', () => {
  const b = book(1);
  assert.deepEqual(digest(request(b)), digest(request(b, { signature: Buffer.alloc(64, 0x99) })));
  for (const offset of [0, 2, 34, 66, 98]) {
    const changed = Buffer.from(request(b));
    changed[offset] ^= 1;
    assert.notDeepEqual(digest(changed), digest(request(b)));
  }
});

const malformedTlvs = [
  ['unknown even type', '0200', /unknown even/],
  ['duplicate types', '01000100', /order or duplicate/],
  ['descending types', '03000100', /order or duplicate/],
  ['noncanonical u16 type', 'fd000100', /noncanonical/],
  ['noncanonical u32 type', 'fe000000fd00', /noncanonical/],
  ['noncanonical u64 type', 'ff000000000001000100', /noncanonical/],
  ['noncanonical length', '01fd0000', /noncanonical/],
  ['truncated type', 'fd', /truncated/],
  ['missing length', '01', /truncated/],
  ['truncated value', '0102aa', /truncated/],
  ['u64 length exceeds frame', '01ffffffffffffffffff', /truncated/],
];
for (const [label, hex, error] of malformedTlvs) {
  test(`request and reply reject ${label}`, () => {
    const b = book(1);
    const bytes = Buffer.from(hex, 'hex');
    assert.throws(() => parseRequest(appendRawTlv(request(b), bytes), b), error);
    assert.throws(() => parseResponse(appendRawTlv(response(b), bytes), b), error);
  });
}

test('frame size is checked before count-based reads, including exact maximum TLV padding', () => {
  const b = book(483);
  const frame = response(b);
  // Type 1 needs one byte; this length needs three. No other extension is added.
  const padded = appendRawTlv(frame, encodeTlvs([[1n, Buffer.alloc(MAX_FRAME - frame.length - 4)]]));
  assert.equal(padded.length, MAX_FRAME);
  assert.equal(parseResponse(padded, b).preimages.size, 483);
  const overlong = appendRawTlv(padded, Buffer.from([3, 0]));
  assert.throws(() => parseResponse(overlong, b), /overlong/);
  assert.throws(() => parseRequest(Buffer.alloc(MAX_FRAME + 1), b), /overlong/);
  assert.throws(() => parseResponse(Buffer.alloc(205), b), /truncated frame/);
  assert.throws(() => parseRequest(request(b).subarray(1), b), /truncated frame/);
  for (const slots of [0, 484, 65535]) {
    assert.throws(() => parseResponse(replace(frame, 138, uint(slots, 2)), b), /book size/);
  }
  assert.throws(() => parseResponse(replace(frame, countOffset(483), uint(65535, 2)), b), /count/);
});

test('type, channel, epoch and activation must match the selected book', () => {
  const b = book(9);
  for (const [offset, error] of [[0, /message type/], [2, /channel mismatch/],
    [34, /epoch mismatch/], [66, /activation mismatch/]]) {
    for (const [frame, parse] of [[request(b), parseRequest], [response(b), parseResponse]]) {
      const changed = Buffer.from(frame);
      changed[offset] ^= 1;
      assert.throws(() => parse(changed, b), error);
    }
  }
  assert.throws(() => parseResponse(replace(response(b), 138, uint(8, 2)), b), /book size/);
});

test('unused bitmap high bits must be zero for one, nine and 483 slots', () => {
  for (const slots of [1, 9, 483]) {
    const b = book(slots);
    const changed = Buffer.from(response(b));
    changed[140 + Math.ceil(slots / 8) - 1] |= 0x80;
    assert.throws(() => parseResponse(changed, b), /bitmap padding/);
  }
});

test('preimage entry count must equal popcount, with no absent or extra entries', () => {
  const b = book(9);
  const frame = response(b, { settled: [1, 9] });
  for (const count of [0, 1, 3, 10, 65535]) {
    assert.throws(() => parseResponse(replace(frame, countOffset(9), uint(count, 2)), b), /count/);
  }
  const absent = Buffer.concat([frame.subarray(0, entryOffset(9, 1)), frame.subarray(-64)]);
  assert.throws(() => parseResponse(absent, b), /truncated preimage/);
  // An undeclared [u16 index][preimage] entry cannot be hidden before the TLVs.
  const extra = appendRawTlv(frame, Buffer.concat([uint(2, 2), b.preimages[1]]));
  assert.throws(() => parseResponse(extra, b), /unknown even TLV/);
});

test('preimage indexes must be unique, increasing, set in the bitmap and within K', () => {
  const b = book(9);
  const frame = response(b, { settled: [1, 9] });
  for (const [entry, index, error] of [[0, 0, /range/], [1, 10, /range/],
    [1, 1, /order/], [0, 9, /order/], [1, 8, /bitmap mismatch/]]) {
    assert.throws(() => parseResponse(replace(frame, entryOffset(9, entry), uint(index, 2)), b), error);
  }
});

test('preimage must match its indexed hash before any receiver state changes', () => {
  const b = book(9);
  const frame = replace(response(b), entryOffset(9) + 2, b.preimages[1]);
  const state = receiver();
  state.nonce = b.nonce;
  assert.throws(() => acceptSnapshot(state, parseResponse(frame, b)), /hash mismatch/);
  assert.equal(state.seq, null);
  assert.equal(state.evidence.size, 0);
});

test('canonical snapshot identity is stable across nonce, signature and odd TLV changes', () => {
  const b = book(9);
  const state = receiver();
  state.nonce = b.nonce;
  const first = parseResponse(response(b, { seq: 1n, settled: [1] }), b);
  assert.equal(acceptSnapshot(state, first), 'advanced');
  state.nonce = Buffer.alloc(32, 0x88);
  const second = parseResponse(response(b, { seq: 1n, settled: [1], nonce: state.nonce,
    signature: Buffer.alloc(64, 0x99), tlvs: [[1n, Buffer.from([3])]] }), b);
  assert.deepEqual(second.canonical, first.canonical);
  assert.notDeepEqual(second.digest, first.digest);
  assert.equal(acceptSnapshot(state, second), 'unchanged');
  assert.equal(state.seq, 1n);
});

test('a repeated nonce may observe a newer cumulative snapshot without rollback from a late reply', () => {
  const b = book(9);
  const state = receiver();
  state.nonce = b.nonce;
  const earlier = parseResponse(response(b, { seq: 1n, settled: [1] }), b);
  const later = parseResponse(response(b, { seq: 2n, settled: [1, 9] }), b);
  assert.equal(acceptSnapshot(state, earlier), 'advanced');
  assert.equal(acceptSnapshot(state, later), 'advanced');
  assert.equal(acceptSnapshot(state, earlier), 'stale');
  assert.equal(state.seq, 2n);
  assert.deepEqual([...state.settled], [1, 9]);
  assert.equal(state.evidence.size, 2);
});

test('equal-sequence contradiction and higher-sequence lost bits retain claims without replacing progress', () => {
  const b = book(9);
  for (const [seq, expected] of [[1n, /conflicting equal/], [2n, /lost settled slot/]]) {
    const state = receiver();
    state.nonce = b.nonce;
    acceptSnapshot(state, parseResponse(response(b, { seq: 1n, settled: [1] }), b));
    assert.throws(() => acceptSnapshot(state,
      parseResponse(response(b, { seq, settled: [9] }), b)), expected);
    assert.equal(state.seq, 1n);
    assert.deepEqual([...state.settled], [1]);
    assert.deepEqual([...state.evidence.keys()], [1, 9]);
    assert.equal(state.phase, 'ACTIVE');
  }
});

test('uncorrelated or post-close replies may preserve evidence but cannot reopen lifecycle', () => {
  const b = book(9);
  const state = receiver();
  state.nonce = Buffer.alloc(32, 0x77);
  assert.equal(acceptSnapshot(state, parseResponse(response(b), b)), 'uncorrelated');
  assert.equal(state.seq, null);
  assert.equal(state.evidence.size, 9);
  for (const phase of ['DRAINING', 'CLOSED']) {
    state.phase = phase;
    state.nonce = null; // The final close acknowledgement supersedes a live fetch.
    assert.equal(acceptSnapshot(state, parseResponse(response(b), b)), 'uncorrelated');
    assert.equal(state.phase, phase);
    assert.equal(state.seq, null);
  }
});

test('cumulative snapshots still contain consumed vouchers; duplicate receipts do not recreate inventory', () => {
  const b = book(9);
  const state = receiver();
  state.nonce = b.nonce;
  acceptSnapshot(state, parseResponse(response(b, { seq: 1n, settled: [1] }), b));
  state.consumed.add(1); // Represents an already irrevocably redeemed voucher.
  const later = parseResponse(response(b, { seq: 2n, settled: [1, 9] }), b);
  assert.equal(later.preimages.size, 2);
  assert.equal(acceptSnapshot(state, later), 'advanced');
  assert.equal(acceptSnapshot(state, later), 'unchanged');
  assert.deepEqual([...state.consumed], [1]);
  assert.deepEqual([...state.settled], [1, 9]);
  assert.equal(state.evidence.size, 2);
});
