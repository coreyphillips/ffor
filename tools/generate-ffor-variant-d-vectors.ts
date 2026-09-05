/**
 * FFOR Appendix D test-vector generator: the Variant D setup transcript.
 *
 * Generates deterministic, byte-exact test vectors for the Variant D
 * (pre-signed voucher book) setup of ffor-offline-receive.md: the signed
 * ff_init / ff_accept exchange (7.1, 7.2), the transcript hashes and the
 * voucher book (7.5.2, 7.5.3), the K update_add_htlc messages with their
 * onions (9.5.1), BOTH commitment views after the voucher round with the
 * counterparty's commitment and HTLC signatures, H_commit, the signed
 * ff_activate / ff_activate_ack pair and H_act (7.5.4), and the force-close
 * claim paths for voucher 1 from both views (9.5.1).
 *
 * Everything is built, signed and verified with the beignet Lightning
 * library's real BOLT 3 commitment builder, BOLT 4 onion code and script
 * helpers. The output (stdout) is the complete Markdown appendix; it is
 * byte-for-byte deterministic (RFC 6979 signatures, fixed seeds, no clocks,
 * no unseeded randomness).
 *
 * HOW TO RUN (module resolution + deps come from the beignet repo; the
 * tsconfig next to this file extends beignet's):
 *
 *   cd /path/to/beignet
 *   npx ts-node -P ../specs/tools/tsconfig.json \
 *     ../specs/tools/generate-ffor-variant-d-vectors.ts \
 *     > ../specs/ffor-variant-d-vectors.md
 *
 * The script imports beignet FROM SOURCE via relative paths and modifies
 * nothing inside the beignet repo. It reuses the Appendix A fixture
 * (BOLT 3 Appendix C key material where it exists, SHA256(tag) elsewhere) so
 * the two appendices can be cross-referenced.
 */

import crypto from 'crypto';
// bitcoinjs-lib is reached through beignet's dependency tree (the specs repo has
// no node_modules); this resolves to the same module beignet's sources import.
import * as bitcoin from '../../beignet/node_modules/bitcoinjs-lib';
import {
	buildLocalCommitment,
	buildRemoteCommitment,
	signRemoteCommitment,
	verifyRemoteCommitmentSig,
	verifyRemoteHtlcSignatures,
	deriveCommitmentKeys,
	calculateCommitmentFee,
	HTLC_SUCCESS_WEIGHT_ANCHORS,
	HTLC_TIMEOUT_WEIGHT_ANCHORS,
	ICommitmentKeys
} from '../../beignet/src/lightning/channel/commitment-builder';
import {
	createOpenerState,
	createAcceptorState,
	IChannelState
} from '../../beignet/src/lightning/channel/channel-state';
import {
	ChannelState,
	HtlcDirection,
	HtlcState,
	IChannelConfig
} from '../../beignet/src/lightning/channel/types';
import { deriveChannelId } from '../../beignet/src/lightning/channel/validation';
import {
	IChannelBasepoints,
	perCommitmentPointFromSecret,
	derivePrivateKey,
	derivePublicKey
} from '../../beignet/src/lightning/keys/derivation';
import { ChannelSigner } from '../../beignet/src/lightning/keys/signer';
import {
	getPublicKey,
	sign,
	verify
} from '../../beignet/src/lightning/crypto/ecdh';
import {
	generateFromSeed,
	MAX_INDEX
} from '../../beignet/src/lightning/keys/shachain';
import { createFundingScript } from '../../beignet/src/lightning/script/funding';
import {
	buildHtlcSuccessTx,
	buildHtlcTimeoutTx,
	buildOfferedHtlcScript,
	buildReceivedHtlcScript
} from '../../beignet/src/lightning/script/htlc';
import { calculateObscuredCommitmentNumber } from '../../beignet/src/lightning/script/commitment';
import {
	buildRemoteHtlcPreimageClaimTx,
	buildRemoteHtlcPreimageWitness,
	buildRemoteHtlcTimeoutClaimTx,
	buildRemoteHtlcTimeoutWitness
} from '../../beignet/src/lightning/chain/sweep';
import {
	constructOnionPacket,
	encodeOnionPacket,
	decodeOnionPacket,
	processOnionPacket,
	isFinalHop,
	ONION_PACKET_LENGTH
} from '../../beignet/src/lightning/onion';
import { encodeBigSize } from '../../beignet/src/lightning/message/codec';
import {
	FeatureFlags,
	Feature
} from '../../beignet/src/lightning/features/flags';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(b: Buffer): Buffer {
	return crypto.createHash('sha256').update(b).digest();
}
function hex(b: Buffer): string {
	return b.toString('hex');
}
function h2b(s: string): Buffer {
	return Buffer.from(s, 'hex');
}
function ascii(s: string): Buffer {
	return Buffer.from(s, 'ascii');
}
function u8(v: number): Buffer {
	return Buffer.from([v & 0xff]);
}
function u16(v: number | bigint): Buffer {
	const b = Buffer.alloc(2);
	b.writeUInt16BE(Number(v));
	return b;
}
function u32(v: number | bigint): Buffer {
	const b = Buffer.alloc(4);
	b.writeUInt32BE(Number(v));
	return b;
}
function u64(v: bigint): Buffer {
	const b = Buffer.alloc(8);
	b.writeBigUInt64BE(v);
	return b;
}

const assertions: string[] = [];
function assert(cond: boolean, msg: string): void {
	if (!cond) {
		throw new Error(`ASSERTION FAILED: ${msg}`);
	}
}
/** An assertion that is also recorded for the "verification performed" list. */
function check(cond: boolean, msg: string): void {
	assert(cond, msg);
	assertions.push(msg);
}

/** Encode a 64-byte compact sig as DER and append the sighash-type byte. */
function toDerWithSighash(sig: Buffer, sighashByte: number): Buffer {
	assert(sig.length === 64, 'compact signature must be 64 bytes');
	const encodeInt = (val: Buffer): Buffer => {
		let v = val;
		let start = 0;
		while (start < v.length - 1 && v[start] === 0) start++;
		v = v.subarray(start);
		if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0x00]), v]);
		return Buffer.concat([Buffer.from([0x02, v.length]), v]);
	};
	const rDer = encodeInt(sig.subarray(0, 32));
	const sDer = encodeInt(sig.subarray(32, 64));
	return Buffer.concat([
		Buffer.from([0x30, rDer.length + sDer.length]),
		rDer,
		sDer,
		Buffer.from([sighashByte])
	]);
}

/** Per-commitment secret/point for commitment number n (shachain index counts down). */
function pcSecret(seed: Buffer, n: bigint): Buffer {
	return generateFromSeed(seed, MAX_INDEX - n);
}
function pcPoint(seed: Buffer, n: bigint): Buffer {
	return perCommitmentPointFromSecret(pcSecret(seed, n));
}

/** BOLT 1 TLV record: BigSize type, BigSize length, value. */
function tlv(type: number, value: Buffer): Buffer {
	return Buffer.concat([
		encodeBigSize(BigInt(type)),
		encodeBigSize(BigInt(value.length)),
		value
	]);
}
/** BOLT 1 TLV stream: records in strictly increasing type order. */
function tlvStream(records: { type: number; value: Buffer }[]): Buffer {
	const sorted = [...records].sort((a, b) => a.type - b.type);
	for (let i = 1; i < sorted.length; i++) {
		assert(sorted[i].type > sorted[i - 1].type, 'TLV types strictly increasing');
	}
	return Buffer.concat(sorted.map((r) => tlv(r.type, r.value)));
}

/** Witness stack serialization (for the signed-tx hex the doc shows). */
function witnessHex(stack: Buffer[]): string {
	return stack.map((w) => (w.length === 0 ? '<>' : hex(w))).join(' ');
}

// ---------------------------------------------------------------------------
// FFOR section 7 signed-message envelope
//
//   wire     = [2: type] || body
//   body     = [32: channel_id][32: epoch_id] || fixed fields || TLV stream || [64: sig]
//   digest   = SHA256("ffor/msg" || [2: type] || body_excluding_signature)
//   sig      = 64-byte compact ECDSA (RFC 6979, low-S) by the sender's node key
//
// The 32-byte digest is signed directly (one SHA256, no second hash).
// ---------------------------------------------------------------------------

const MSG_FF_INIT = 55001;
const MSG_FF_ACCEPT = 55003;
const MSG_FF_ACTIVATE = 55045;
const MSG_FF_ACTIVATE_ACK = 55047;
const MSG_UPDATE_ADD_HTLC = 128;

interface ISignedMessage {
	type: number;
	unsignedBody: Buffer; // channel_id || epoch_id || fixed || TLV stream
	digest: Buffer;
	signature: Buffer; // 64-byte compact
	wire: Buffer; // type || unsignedBody || signature
}

function msgDigest(type: number, unsignedBody: Buffer): Buffer {
	return sha256(Buffer.concat([ascii('ffor/msg'), u16(type), unsignedBody]));
}

function signMessage(
	type: number,
	unsignedBody: Buffer,
	nodePriv: Buffer,
	nodePub: Buffer
): ISignedMessage {
	const digest = msgDigest(type, unsignedBody);
	const signature = sign(digest, nodePriv);
	assert(
		verify(digest, nodePub, signature, true),
		'node-key signature verifies (strict low-S)'
	);
	return {
		type,
		unsignedBody,
		digest,
		signature,
		wire: Buffer.concat([u16(type), unsignedBody, signature])
	};
}

/** Verifier-side: split a received wire message and check its signature. */
function verifyMessage(wire: Buffer, expectedType: number, nodePub: Buffer): boolean {
	if (wire.length < 2 + 64 + 64) return false;
	const type = wire.readUInt16BE(0);
	if (type !== expectedType) return false;
	const unsignedBody = wire.subarray(2, wire.length - 64);
	const sig = wire.subarray(wire.length - 64);
	return verify(msgDigest(type, unsignedBody), nodePub, sig, true);
}

// ---------------------------------------------------------------------------
// Fixture material (shared with Appendix A; see ffor-test-vectors.md A.1)
// ---------------------------------------------------------------------------

// BOLT 3 Appendix C constants (trailing "01" compression markers stripped)
const R_FUNDING_PRIV = h2b(
	'30ff4956bbdd3222d44cc5e8a1261dab1e07957bdac5ae88fe3261ef321f3749'
); // local_funding_privkey
const S_FUNDING_PRIV = h2b(
	'1552dfba4f6cf29a62a0af13c8d6981d36d0ef8d61ba10fb0fe90da7634d7e13'
); // remote_funding_privkey
const R_PAYMENT_BASEPOINT_SECRET = h2b(
	'1111111111111111111111111111111111111111111111111111111111111111'
); // local_payment_basepoint_secret (= local htlc basepoint secret)
const S_REVOCATION_BASEPOINT_SECRET = h2b(
	'2222222222222222222222222222222222222222222222222222222222222222'
); // remote_revocation_basepoint_secret
const R_DELAYED_BASEPOINT_SECRET = h2b(
	'3333333333333333333333333333333333333333333333333333333333333333'
); // local_delayed_payment_basepoint_secret
const S_PAYMENT_BASEPOINT_SECRET = h2b(
	'4444444444444444444444444444444444444444444444444444444444444444'
); // remote_payment_basepoint_secret (= remote htlc basepoint secret)

const EXPECTED_R_FUNDING_PUB =
	'023da092f6980e58d2c037173180e9a465476026ee50f96695963e8efe436f54eb';
const EXPECTED_S_FUNDING_PUB =
	'030e9f7b623d2ccc7c9bd44d66d5ce21ce504c0acf6385a132cec6d3c39fa711c1';
const EXPECTED_FUNDING_WSCRIPT =
	'5221023da092f6980e58d2c037173180e9a465476026ee50f96695963e8efe436f54eb21030e9f7b623d2ccc7c9bd44d66d5ce21ce504c0acf6385a132cec6d3c39fa711c152ae';

// Appendix C funding outpoint (txid internal byte order, as serialized in txs)
const FUNDING_TXID_INTERNAL =
	'bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489';
const FUNDING_TXID_DISPLAY =
	'8984484a580b825b9972d7adb15050b3ab624ccd731946b3eeddb92f4e7ef6be';
const FUNDING_OUTPUT_INDEX = 0;
const FUNDING_SAT = 10_000_000n;

// FFOR-specific material (Appendix C has no counterpart): SHA256 of fixed tags
const FFOR_TAGS = {
	rRevocationBasepointSecret: 'ffor/R/revocation-basepoint-secret',
	sDelayedBasepointSecret: 'ffor/S/delayed-payment-basepoint-secret',
	rPerCommitmentSeed: 'ffor/R/per-commitment-seed',
	sPerCommitmentSeed: 'ffor/S/per-commitment-seed',
	rNodeKey: 'ffor/R/node-key',
	sNodeKey: 'ffor/S/node-key',
	rSweepKey: 'ffor/R/sweep-key',
	sSweepKey: 'ffor/S/sweep-key'
};
const R_REVOCATION_BASEPOINT_SECRET = sha256(ascii(FFOR_TAGS.rRevocationBasepointSecret));
const S_DELAYED_BASEPOINT_SECRET = sha256(ascii(FFOR_TAGS.sDelayedBasepointSecret));
const R_PC_SEED = sha256(ascii(FFOR_TAGS.rPerCommitmentSeed));
const S_PC_SEED = sha256(ascii(FFOR_TAGS.sPerCommitmentSeed));
// Node keys: sign the ff_* messages (section 7) and, for R, decrypt the voucher onions.
const R_NODE_PRIV = sha256(ascii(FFOR_TAGS.rNodeKey));
const S_NODE_PRIV = sha256(ascii(FFOR_TAGS.sNodeKey));
const R_NODE_PUB = getPublicKey(R_NODE_PRIV);
const S_NODE_PUB = getPublicKey(S_NODE_PRIV);
// On-chain sweep destinations for the force-close vectors (P2WPKH).
const R_SWEEP_PRIV = sha256(ascii(FFOR_TAGS.rSweepKey));
const S_SWEEP_PRIV = sha256(ascii(FFOR_TAGS.sSweepKey));
const R_SWEEP_SPK = bitcoin.payments.p2wpkh({ pubkey: getPublicKey(R_SWEEP_PRIV) }).output!;
const S_SWEEP_SPK = bitcoin.payments.p2wpkh({ pubkey: getPublicKey(S_SWEEP_PRIV) }).output!;

// ---------------------------------------------------------------------------
// Channel and epoch parameters common to every scenario
// ---------------------------------------------------------------------------

const FEERATE_PER_KW = 2500; // frozen for the epoch
const DUST_LIMIT_SAT = 546n; // both sides
const TO_SELF_DELAY = 144; // both sides
const CHANNEL_RESERVE_SAT = 10_000n; // both sides
const MAX_ACCEPTED_HTLCS = 483; // both sides (R's value binds the vouchers)
const MAX_HTLC_VALUE_IN_FLIGHT_MSAT = 5_000_000_000n;
const HTLC_MINIMUM_MSAT = 1n;
const N_R = 42n; // R's commitment number before the voucher round
const N0 = 42n; // S's commitment number before the voucher round (ff_accept)
const N_R_ACT = N_R + 1n; // R's commitment number at activation
const N_S_ACT = N0 + 1n; // S's commitment number at activation
const T_EXP = 800_000; // voucher_expiry (uniform cltv_expiry)
const D_DEADLINE = 798_992; // settlement_deadline = T_exp - 1008 (7.5.6 margin)
const EPOCH_START_HEIGHT = 790_000; // ff_activate.epoch_start_height
const FEE_BASE_MSAT = 1000n;
const FEE_PROP_MILLIONTHS = 5000n;
const MIN_PAYMENT_MSAT = 546_000n; // = voucher dust floor (546 sat, anchors)
const VARIANT_D = 4;
const PROFILE_FIXED = 1;
const G_ESCAPE = 0n;
const ANCHOR_TOTAL_SAT = 660n;
// Nominal fee for the direct on-chain claims (not a fee estimate: chosen so a
// floor voucher of 546 sat still leaves a non-dust P2WPKH output).
const CLAIM_FEE_SAT = 200n;

// Pre-round balances. D.1 to D.5: S holds 7,000,000 sat and R holds
// 3,000,000 sat; only the funder role changes between D.2 and D.3, so the two
// transcripts differ exactly where the funder's obligations move. D.6 gives R
// a zero pre-round balance (S holds the whole 10,000,000 sat). A scenario's S
// balance is always funding minus R's balance.
const R_BALANCE_MSAT_PRE = 3_000_000_000n;
const S_BALANCE_MSAT_PRE = FUNDING_SAT * 1000n - R_BALANCE_MSAT_PRE;

const U64_MAX = (1n << 64n) - 1n;

function forwardingFee(d: bigint): bigint {
	return FEE_BASE_MSAT + (d * FEE_PROP_MILLIONTHS) / 1_000_000n;
}

// ---------------------------------------------------------------------------
// Keys and channel material
// ---------------------------------------------------------------------------

const rBasepoints: IChannelBasepoints = {
	fundingPubkey: getPublicKey(R_FUNDING_PRIV),
	revocationBasepoint: getPublicKey(R_REVOCATION_BASEPOINT_SECRET),
	paymentBasepoint: getPublicKey(R_PAYMENT_BASEPOINT_SECRET),
	delayedPaymentBasepoint: getPublicKey(R_DELAYED_BASEPOINT_SECRET),
	htlcBasepoint: getPublicKey(R_PAYMENT_BASEPOINT_SECRET),
	firstPerCommitmentPoint: pcPoint(R_PC_SEED, 0n)
};
const sBasepoints: IChannelBasepoints = {
	fundingPubkey: getPublicKey(S_FUNDING_PRIV),
	revocationBasepoint: getPublicKey(S_REVOCATION_BASEPOINT_SECRET),
	paymentBasepoint: getPublicKey(S_PAYMENT_BASEPOINT_SECRET),
	delayedPaymentBasepoint: getPublicKey(S_DELAYED_BASEPOINT_SECRET),
	htlcBasepoint: getPublicKey(S_PAYMENT_BASEPOINT_SECRET),
	firstPerCommitmentPoint: pcPoint(S_PC_SEED, 0n)
};

check(
	hex(rBasepoints.fundingPubkey) === EXPECTED_R_FUNDING_PUB &&
		hex(sBasepoints.fundingPubkey) === EXPECTED_S_FUNDING_PUB,
	'Fixture keys re-derive the BOLT 3 Appendix C funding pubkeys'
);
const fundingScriptRS = createFundingScript(rBasepoints.fundingPubkey, sBasepoints.fundingPubkey);
const fundingScriptSR = createFundingScript(sBasepoints.fundingPubkey, rBasepoints.fundingPubkey);
check(
	hex(fundingScriptRS.witnessScript) === EXPECTED_FUNDING_WSCRIPT &&
		hex(fundingScriptSR.witnessScript) === EXPECTED_FUNDING_WSCRIPT,
	'Funding witness script matches Appendix C funding_wscript whichever side is the opener (BOLT 3 lexicographic key order)'
);

const channelTypeFlags = FeatureFlags.empty();
channelTypeFlags.setCompulsory(Feature.STATIC_REMOTE_KEY);
channelTypeFlags.setCompulsory(Feature.ANCHOR_ZERO_FEE_HTLC);
const CHANNEL_TYPE = channelTypeFlags.toBuffer();

const CONFIG: IChannelConfig = {
	dustLimitSatoshis: DUST_LIMIT_SAT,
	maxHtlcValueInFlightMsat: MAX_HTLC_VALUE_IN_FLIGHT_MSAT,
	channelReserveSatoshis: CHANNEL_RESERVE_SAT,
	htlcMinimumMsat: HTLC_MINIMUM_MSAT,
	toSelfDelay: TO_SELF_DELAY,
	maxAcceptedHtlcs: MAX_ACCEPTED_HTLCS,
	feeratePerKw: FEERATE_PER_KW
};

const CHANNEL_ID = deriveChannelId(h2b(FUNDING_TXID_INTERNAL), FUNDING_OUTPUT_INDEX);

const sSigner = new ChannelSigner(S_FUNDING_PRIV, S_PAYMENT_BASEPOINT_SECRET);
const rSigner = new ChannelSigner(R_FUNDING_PRIV, R_PAYMENT_BASEPOINT_SECRET);

type Funder = 'S' | 'R';

/** Fresh mirrored channel states for the given funder, at the pre-round numbers. */
function makeStates(funder: Funder, rPreMsat: bigint): { sState: IChannelState; rState: IChannelState } {
	const sPreMsat = FUNDING_SAT * 1000n - rPreMsat;
	let sState: IChannelState;
	let rState: IChannelState;
	if (funder === 'S') {
		sState = createOpenerState({
			temporaryChannelId: Buffer.alloc(32),
			fundingSatoshis: FUNDING_SAT,
			pushMsat: rPreMsat,
			localConfig: { ...CONFIG },
			localBasepoints: sBasepoints,
			localPerCommitmentSeed: S_PC_SEED
		});
		sState.remoteBasepoints = rBasepoints;
		sState.remoteConfig = { ...CONFIG };
		rState = createAcceptorState({
			temporaryChannelId: Buffer.alloc(32),
			fundingSatoshis: FUNDING_SAT,
			pushMsat: rPreMsat,
			localConfig: { ...CONFIG },
			localBasepoints: rBasepoints,
			localPerCommitmentSeed: R_PC_SEED,
			remoteBasepoints: sBasepoints,
			remoteConfig: { ...CONFIG }
		});
	} else {
		rState = createOpenerState({
			temporaryChannelId: Buffer.alloc(32),
			fundingSatoshis: FUNDING_SAT,
			pushMsat: sPreMsat,
			localConfig: { ...CONFIG },
			localBasepoints: rBasepoints,
			localPerCommitmentSeed: R_PC_SEED
		});
		rState.remoteBasepoints = sBasepoints;
		rState.remoteConfig = { ...CONFIG };
		sState = createAcceptorState({
			temporaryChannelId: Buffer.alloc(32),
			fundingSatoshis: FUNDING_SAT,
			pushMsat: sPreMsat,
			localConfig: { ...CONFIG },
			localBasepoints: sBasepoints,
			localPerCommitmentSeed: S_PC_SEED,
			remoteBasepoints: rBasepoints,
			remoteConfig: { ...CONFIG }
		});
	}
	for (const st of [sState, rState]) {
		st.channelId = CHANNEL_ID;
		st.fundingTxid = h2b(FUNDING_TXID_INTERNAL);
		st.fundingOutputIndex = FUNDING_OUTPUT_INDEX;
		st.channelType = CHANNEL_TYPE;
		st.state = ChannelState.NORMAL;
	}
	sState.localCommitmentNumber = N0;
	sState.remoteCommitmentNumber = N_R;
	rState.localCommitmentNumber = N_R;
	rState.remoteCommitmentNumber = N0;
	assert(sState.localBalanceMsat === sPreMsat, 'S pre-round balance');
	assert(rState.localBalanceMsat === rPreMsat, 'R pre-round balance');
	return { sState, rState };
}

// ---------------------------------------------------------------------------
// Scenario definitions
// ---------------------------------------------------------------------------

interface IScenario {
	id: string; // "D.1"
	title: string;
	funder: Funder;
	amounts: bigint[];
	sHtlcIdBase: bigint;
	abbreviated: boolean; // D.5: txids, hashes, first/last voucher only
	rPreMsat: bigint; // R's pre-round balance (S holds funding minus this)
	intro: string[];
}

const SCENARIOS: IScenario[] = [
	{
		id: 'D.1',
		title: 'K = 1, S opener and funder',
		funder: 'S',
		amounts: [1_000_000n],
		sHtlcIdBase: 0n,
		abbreviated: false,
		rPreMsat: R_BALANCE_MSAT_PRE,
		intro: [
			'The minimal transcript: one voucher of 1,000,000 msat on a channel `S`',
			'opened and funds. `s_htlc_id_base = 0`: `S` has never offered an HTLC on',
			'this channel, so its next offered id is 0.'
		]
	},
	{
		id: 'D.2',
		title: 'K = 3, S opener and funder, the Appendix A amounts',
		funder: 'S',
		amounts: [994_000n, 546_250n, 49_749_000n],
		sHtlcIdBase: 7n,
		abbreviated: false,
		rPreMsat: R_BALANCE_MSAT_PRE,
		intro: [
			'The three payee amounts of Appendix A (`994,000`, `546,250`, `49,749,000`',
			'msat) added in ONE voucher round. `R`\'s view is therefore its commitment',
			'`n_R + 1 = 43` carrying all three vouchers, whereas Appendix A\'s `C_3` is',
			'commitment `n_R + 3 = 45` reached by adding them one at a time. The two',
			'commitments have the same output layout (same amounts, same BOLT 3 order:',
			'voucher 2 at 546 sat sorts before voucher 1 at 994 sat, then voucher 3,',
			'then `to_remote`, then `to_local`), the same `to_local`/`to_remote` values',
			'and the same commitment fee, but different per-commitment keys, so every',
			'scriptPubKey, txid and signature differs from Appendix A\'s `C_3`.',
			'`s_htlc_id_base = 7`: `S` has offered seven HTLCs before this epoch, all',
			'resolved, so voucher `k` gets id `6 + k`.'
		]
	},
	{
		id: 'D.3',
		title: 'K = 3, R opener and funder, S acceptor',
		funder: 'R',
		amounts: [994_000n, 546_250n, 49_749_000n],
		sHtlcIdBase: 0n,
		abbreviated: false,
		rPreMsat: R_BALANCE_MSAT_PRE,
		intro: [
			'The same three amounts and the same balances as D.2 (`S` 7,000,000 sat,',
			'`R` 3,000,000 sat), but `R` opened and funds the channel. BOLT 3 charges',
			'the commitment fee and both anchors to the funder, so here they come out of',
			'`R`\'s `to_local` on `R`\'s view and `R`\'s `to_remote` on `S`\'s view, the',
			'obscured commitment number uses `R`\'s payment basepoint as the opener\'s,',
			'and the 7.6 funder obligations (reserve, fee at the frozen rate for K',
			'outputs, fee-spike buffer at twice the rate, anchors) are checked against',
			'`R`. Diff this section against D.2 to see exactly what moves.'
		]
	},
	{
		id: 'D.4',
		title: 'dust boundary: one voucher at exactly 546,000 msat',
		funder: 'S',
		amounts: [546_000n],
		sHtlcIdBase: 0n,
		abbreviated: false,
		rPreMsat: R_BALANCE_MSAT_PRE,
		intro: [
			'One voucher at exactly `min_payment_msat = 546,000` msat, whose output is',
			'`546` sat = `dust_limit_satoshis`: the smallest voucher the profile admits',
			'(section 8: under `option_anchors_zero_fee_htlc_tx` the second-level fee',
			'term of the trim rule is zero, so the floor is exactly `dust_limit`). The',
			'generator also asserts that `545,999` msat (a 545 sat output) fails BOTH',
			'setup checks, `d_k >= min_payment_msat` and the section 8 trim check, so a',
			'book carrying it is refused at step 2 and never built (see D.4.9).'
		]
	},
	{
		id: 'D.5',
		title: 'K = 483, the BOLT 2 maximum, minimal equal amounts',
		funder: 'S',
		amounts: Array.from({ length: 483 }, () => 546_000n),
		sHtlcIdBase: 0n,
		abbreviated: true,
		rPreMsat: R_BALANCE_MSAT_PRE,
		intro: [
			'`K = 483 = max_accepted_htlcs`, every voucher at the floor `546,000` msat',
			'(`budget_msat = 263,718,000`). This section is abbreviated: the messages',
			'are given as sizes plus the SHA256 of their wire bytes, the commitments as',
			'txids plus their non-voucher outputs, and only vouchers 1 and 483 in full.',
			'Everything omitted is reproduced by the generator. Note that 483 equal',
			'amounts make BOLT 3 order the voucher outputs purely by scriptPubKey, so',
			'voucher 1 and voucher 483 land at output indices unrelated to `k`.'
		]
	},
	{
		id: 'D.6',
		title: 'K = 1, S opener and funder, R holds zero pre-epoch balance',
		funder: 'S',
		amounts: [1_000_000n],
		sHtlcIdBase: 0n,
		abbreviated: false,
		rPreMsat: 0n,
		intro: [
			'The motivating case: `S` opened and funds the channel, holds all 10,000,000',
			'sat, and `R` has received nothing yet (a fresh inbound-only channel). One',
			'voucher of 1,000,000 msat, as in D.1. Because `R`\'s balance is 0 msat, BOLT 3',
			'omits its main output on both views (`to_local` on `R`\'s view, `to_remote`',
			'on `S`\'s view: 0 sat is below `dust_limit`); its anchor is still present',
			'because the commitment carries an untrimmed HTLC. Section 8 constrains only',
			'the funder\'s balance by its reserve when `S` funds, so `R`\'s zero balance',
			'is legal and the setup-checks row for `R` reads "not applied". The voucher',
			'output, both signatures and every claim path are unaffected: `R`\'s claim',
			'needs only the HTLC output and `t_1`, never a main output.'
		]
	}
];

// ---------------------------------------------------------------------------
// Per-scenario computation
// ---------------------------------------------------------------------------

interface IVoucher {
	k: number; // 1-based
	d: bigint;
	feeMsat: bigint;
	grossMsat: bigint;
	preimage: Buffer;
	hash: Buffer;
	htlcId: bigint;
	paymentSecret: Buffer;
	sessionKey: Buffer;
	onion: Buffer; // 1366 bytes
	ephemeralPubkey: Buffer;
	addHtlcWire: Buffer;
}

interface IVoucherOnView {
	k: number;
	outputIndex: number;
	amountSat: bigint;
	witnessScript: Buffer;
	secondLevelKind: 'HTLC-success' | 'HTLC-timeout';
	secondLevelTxHex: string;
	secondLevelTxid: string;
	sighash: Buffer;
	counterpartySig: Buffer; // compact, SIGHASH_SINGLE|ANYONECANPAY
}

interface ICommitView {
	holder: 'R' | 'S';
	signer: 'S' | 'R'; // the counterparty who signs it
	commitmentNumber: bigint;
	perCommitmentPoint: Buffer;
	obscured: bigint;
	txHex: string;
	txid: string;
	txidInternal: Buffer;
	commitFeeSat: bigint;
	outputRows: { index: number; kind: string; amountSat: number; spk: string }[];
	commitSig: Buffer;
	vouchers: IVoucherOnView[];
	keys: ICommitmentKeys;
	wireSha256: Buffer;
	absentNote?: string;
}

interface ICheckRow {
	name: string;
	value: string;
	pass: boolean;
}

interface IClaimVector {
	title: string;
	description: string[];
	txHexUnsigned: string;
	txHexSigned: string;
	txid: string;
	sighash: Buffer;
	sighashType: string;
	witness: string;
	witnessLayout: string;
	extra: [string, string][];
}

interface IScenarioResult {
	sc: IScenario;
	K: number;
	budget: bigint;
	epochId: Buffer;
	vouchers: IVoucher[];
	rPoints: Buffer[]; // r_per_commitment_points, n_R+1 .. n_R+K
	sPointAct: Buffer;
	ffInit: ISignedMessage;
	ffAccept: ISignedMessage;
	tInit: Buffer;
	tSetup: Buffer;
	book: Buffer;
	hBook: Buffer;
	checks: ICheckRow[];
	rView: ICommitView;
	sView: ICommitView;
	hCommit: Buffer;
	ffActivate: ISignedMessage;
	hAct: Buffer;
	ffActivateAck: ISignedMessage;
	claims: IClaimVector[];
	refusedDust?: { d: bigint; reasons: string[] };
}

function runScenario(sc: IScenario): IScenarioResult {
	const K = sc.amounts.length;
	const tag = `[${sc.id}]`;
	const budget = sc.amounts.reduce((a, b) => a + b, 0n);
	const epochId = sha256(ascii(`ffor/vector/${sc.id}/epoch_id`));

	// -- Voucher material: S generates t_k; H_k = SHA256(t_k) (9.5.2) --------
	const vouchers: IVoucher[] = sc.amounts.map((d, idx) => {
		const k = idx + 1;
		const preimage = sha256(
			Buffer.concat([ascii(`ffor/vector/${sc.id}/preimage`), u16(k)])
		);
		return {
			k,
			d,
			feeMsat: forwardingFee(d),
			grossMsat: d + forwardingFee(d),
			preimage,
			hash: sha256(preimage),
			htlcId: sc.sHtlcIdBase + BigInt(k) - 1n,
			paymentSecret: sha256(
				Buffer.concat([ascii('ffor/voucher-secret'), epochId, u16(k)])
			),
			sessionKey: sha256(
				Buffer.concat([ascii('ffor/vector/onion-session'), epochId, u16(k)])
			),
			onion: Buffer.alloc(0),
			ephemeralPubkey: Buffer.alloc(0),
			addHtlcWire: Buffer.alloc(0)
		};
	});

	// 7.2: under variant 4, H_1 MUST NOT be SHA256 of any secret S has revealed.
	// S has revealed per_commitment_secret_S[0 .. n0 - 1] (n0 itself is revealed
	// by the setup revoke_and_ack); assert against all of 0 .. n0.
	for (let n = 0n; n <= N0; n++) {
		assert(
			!sha256(pcSecret(S_PC_SEED, n)).equals(vouchers[0].hash),
			`${tag} H_1 is not SHA256(per_commitment_secret_S[${n}])`
		);
	}
	assertions.push(
		`${tag} H_1 != SHA256(per_commitment_secret_S[n]) for every n in 0..n0 (7.2 Variant D binding forbidden)`
	);

	// -- R's pre-shared points (7.1) and S's point at activation ---------------
	const rPoints = Array.from({ length: K }, (_, i) => pcPoint(R_PC_SEED, N_R + 1n + BigInt(i)));
	const sPointAct = pcPoint(S_PC_SEED, N_S_ACT);

	// -- ff_init (7.1) --------------------------------------------------------
	const initFixed = Buffer.concat([
		u8(VARIANT_D),
		u64(budget),
		u16(K),
		u64(MIN_PAYMENT_MSAT),
		u32(D_DEADLINE),
		u32(T_EXP),
		u32(FEE_BASE_MSAT),
		u32(FEE_PROP_MILLIONTHS),
		u64(G_ESCAPE),
		// 7.1: under Variant D r_per_commitment_points MUST be empty (count 0).
		// R's point for n_R+1 is the one S already holds from R's last
		// revoke_and_ack; the vectors derive it from R_PC_SEED below.
		u16(0)
	]);
	const tlv9 = Buffer.concat(sc.amounts.map((d) => u64(d)));
	const initTlvs = tlvStream([{ type: 9, value: tlv9 }]);
	const ffInit = signMessage(
		MSG_FF_INIT,
		Buffer.concat([CHANNEL_ID, epochId, initFixed, initTlvs]),
		R_NODE_PRIV,
		R_NODE_PUB
	);
	check(verifyMessage(ffInit.wire, MSG_FF_INIT, R_NODE_PUB), `${tag} ff_init: R's node-key signature verifies from the wire bytes alone (strict low-S)`);
	const tInit = sha256(Buffer.concat([ascii('ffor/tr/init'), ffInit.wire]));

	// -- ff_accept (7.2) ------------------------------------------------------
	const acceptFixed = u64(N0);
	const acceptTlvs = tlvStream([
		{ type: 1, value: Buffer.concat(vouchers.map((v) => v.hash)) },
		{ type: 7, value: u64(sc.sHtlcIdBase) },
		{ type: 9, value: tlv9 },
		{ type: 11, value: tInit }
	]);
	const ffAccept = signMessage(
		MSG_FF_ACCEPT,
		Buffer.concat([CHANNEL_ID, epochId, acceptFixed, acceptTlvs]),
		S_NODE_PRIV,
		S_NODE_PUB
	);
	check(verifyMessage(ffAccept.wire, MSG_FF_ACCEPT, S_NODE_PUB), `${tag} ff_accept: S's node-key signature verifies from the wire bytes alone (strict low-S)`);
	check(
		ffAccept.unsignedBody.subarray(64 + 8).includes(tlv(11, tInit)) &&
			ffAccept.unsignedBody.subarray(64 + 8).includes(tlv(9, tlv9)),
		`${tag} ff_accept carries TLV 11 = T_init and a TLV 9 byte-identical to ff_init's`
	);
	const tSetup = sha256(Buffer.concat([ascii('ffor/tr/setup'), tInit, ffAccept.wire]));

	// -- The book (7.5.3) -----------------------------------------------------
	const entries = vouchers.map((v) =>
		Buffer.concat([u16(v.k), v.hash, u64(v.d), u32(T_EXP), u32(D_DEADLINE), u64(v.htlcId)])
	);
	const book = Buffer.concat([epochId, u8(VARIANT_D), u8(PROFILE_FIXED), u16(K), ...entries]);
	assert(book.length === 36 + 58 * K, `${tag} book length = 36 + 58K`);
	const hBook = sha256(Buffer.concat([ascii('ffor/book'), book]));

	// -- Setup checks (7.1, 7.2, 7.5.3, 7.6, 8, 9.5.1 bounds) -----------------
	const checks: ICheckRow[] = [];
	const row = (name: string, value: string, pass: boolean): void => {
		checks.push({ name, value, pass });
		check(pass, `${tag} ${name}: ${value}`);
	};
	row('variant == 4, G == 0, TLVs 1/3/5 absent from ff_init', `variant ${VARIANT_D}, G ${G_ESCAPE}`, VARIANT_D === 4 && G_ESCAPE === 0n);
	row('sum(d_k) == budget_msat', `${budget} msat`, budget === sc.amounts.reduce((a, b) => a + b, 0n));
	row('K <= 483 and K <= R max_accepted_htlcs', `K = ${K}`, K <= 483 && K <= MAX_ACCEPTED_HTLCS);
	row('sum(d_k) <= R max_htlc_value_in_flight_msat', `${budget} <= ${MAX_HTLC_VALUE_IN_FLIGHT_MSAT}`, budget <= MAX_HTLC_VALUE_IN_FLIGHT_MSAT);
	const minD = sc.amounts.reduce((a, b) => (b < a ? b : a));
	row('every d_k >= min_payment_msat', `min d_k = ${minD} >= ${MIN_PAYMENT_MSAT}`, sc.amounts.every((d) => d >= MIN_PAYMENT_MSAT));
	row('every d_k >= htlc_minimum_msat', `min d_k = ${minD} >= ${HTLC_MINIMUM_MSAT}`, sc.amounts.every((d) => d >= HTLC_MINIMUM_MSAT));
	row('no d_k trims (floor(d_k/1000) >= dust_limit, zero second-level fee under anchors)', `min output ${minD / 1000n} sat >= ${DUST_LIMIT_SAT}`, sc.amounts.every((d) => d / 1000n >= DUST_LIMIT_SAT));
	row('no overflow: d_k * fee_ppm and gross_into_S(d_k) <= 2^64 - 1', `max d_k * ppm = ${sc.amounts.reduce((a, b) => (b > a ? b : a)) * FEE_PROP_MILLIONTHS}`, sc.amounts.every((d) => d * FEE_PROP_MILLIONTHS <= U64_MAX && d + forwardingFee(d) <= U64_MAX));
	const sPreMsat = FUNDING_SAT * 1000n - sc.rPreMsat;
	row('S holds budget + S channel_reserve spendable', `${sPreMsat / 1000n} sat >= ${budget / 1000n} + ${CHANNEL_RESERVE_SAT}`, sPreMsat >= budget + CHANNEL_RESERVE_SAT * 1000n);
	const feeFrozen = calculateCommitmentFee(FEERATE_PER_KW, K, true, false);
	const feeSpike = calculateCommitmentFee(2 * FEERATE_PER_KW, K, true, false);
	const sAfterMsat = sPreMsat - budget;
	const funderAfterSat = (sc.funder === 'S' ? sAfterMsat : sc.rPreMsat) / 1000n;
	const funderCostFrozen = feeFrozen + ANCHOR_TOTAL_SAT;
	const funderCostSpike = feeSpike + ANCHOR_TOTAL_SAT;
	row(`funder (${sc.funder}) covers fee(K=${K}) + anchors at the frozen rate above its reserve`, `${funderAfterSat} - ${CHANNEL_RESERVE_SAT} >= ${feeFrozen} + ${ANCHOR_TOTAL_SAT}`, funderAfterSat - CHANNEL_RESERVE_SAT >= funderCostFrozen);
	row(`funder (${sc.funder}) fee-spike buffer: fee(K=${K}) at 2 x feerate + anchors above its reserve`, `${funderAfterSat} - ${CHANNEL_RESERVE_SAT} >= ${feeSpike} + ${ANCHOR_TOTAL_SAT}`, funderAfterSat - CHANNEL_RESERVE_SAT >= funderCostSpike);
	const sPostSat = sAfterMsat / 1000n - (sc.funder === 'S' ? funderCostFrozen : 0n);
	const rPostSat = sc.rPreMsat / 1000n - (sc.funder === 'R' ? funderCostFrozen : 0n);
	// Section 8: S's post-round balance must stay above S's reserve; R's must stay
	// above R's reserve only when R is the funder. When S funds, R's balance is
	// unconstrained and may be zero (D.6).
	row(
		'S post-round balance >= S channel_reserve; R post-round balance >= R channel_reserve only when R funds',
		sc.funder === 'R'
			? `S ${sPostSat} sat, R ${rPostSat} sat (R funds: checked), reserve ${CHANNEL_RESERVE_SAT}`
			: `S ${sPostSat} sat, R ${rPostSat} sat (S funds: R not applied), reserve ${CHANNEL_RESERVE_SAT}`,
		sPostSat >= CHANNEL_RESERVE_SAT && (sc.funder !== 'R' || rPostSat >= CHANNEL_RESERVE_SAT)
	);
	row('T_exp - D >= claim_margin (1008)', `${T_EXP} - ${D_DEADLINE} = ${T_EXP - D_DEADLINE}`, T_EXP - D_DEADLINE >= 1008);
	row('s_htlc_id_k = s_htlc_id_base + k - 1', `ids ${vouchers[0].htlcId} .. ${vouchers[K - 1].htlcId}`, vouchers.every((v) => v.htlcId === sc.sHtlcIdBase + BigInt(v.k) - 1n));

	// -- update_add_htlc + voucher onions (9.5.1 step 3) -----------------------
	for (const v of vouchers) {
		const packet = constructOnionPacket(
			v.sessionKey,
			[
				{
					pubkey: R_NODE_PUB,
					payload: {
						amountToForwardMsat: v.d,
						outgoingCltvValue: T_EXP,
						paymentSecret: v.paymentSecret,
						totalMsat: v.d
					}
				}
			],
			v.hash // associated data = payment_hash (BOLT 4)
		);
		v.onion = encodeOnionPacket(packet);
		v.ephemeralPubkey = packet.ephemeralKey;
		assert(v.onion.length === ONION_PACKET_LENGTH, `${tag} onion is 1366 bytes`);
		// R decodes it with a stock BOLT 4 decoder and must find exactly the values.
		const processed = processOnionPacket(decodeOnionPacket(v.onion), R_NODE_PRIV, v.hash);
		const p = processed.hopPayload;
		assert(isFinalHop(processed.nextPacket), `${tag} voucher ${v.k} onion: R is the final hop`);
		assert(
			p.amountToForwardMsat === v.d &&
				p.outgoingCltvValue === T_EXP &&
				p.paymentSecret !== undefined &&
				p.paymentSecret.equals(v.paymentSecret) &&
				p.totalMsat === v.d &&
				p.shortChannelId === undefined,
			`${tag} voucher ${v.k} onion payload decodes to {amt_to_forward = d_k, outgoing_cltv_value = T_exp, payment_data = {SHA256("ffor/voucher-secret" || epoch_id || k), d_k}}`
		);
		v.addHtlcWire = Buffer.concat([
			u16(MSG_UPDATE_ADD_HTLC),
			CHANNEL_ID,
			u64(v.htlcId),
			u64(v.d),
			v.hash,
			u32(T_EXP),
			v.onion
		]);
	}
	assertions.push(
		`${tag} all ${K} voucher onions (1366 bytes, single hop to R's node key, associated data H_k) decode on R's side with beignet's processOnionPacket as a final hop with exactly the 9.5.1 payload`
	);

	// -- Channel states after the round ----------------------------------------
	const { sState, rState } = makeStates(sc.funder, sc.rPreMsat);
	for (const v of vouchers) {
		const key = `s-offered-${v.k}`;
		const base = {
			id: v.htlcId,
			amountMsat: v.d,
			paymentHash: v.hash,
			cltvExpiry: T_EXP,
			onionRoutingPacket: v.onion,
			state: HtlcState.COMMITTED
		};
		sState.htlcs.set(key, { ...base, direction: HtlcDirection.OFFERED });
		rState.htlcs.set(key, { ...base, direction: HtlcDirection.RECEIVED });
		sState.localBalanceMsat -= v.d;
		rState.remoteBalanceMsat -= v.d;
	}
	// The verify* helpers build commitment localCommitmentNumber + 1 by default;
	// we pass the number explicitly everywhere but keep the states coherent.
	sState.localCommitmentNumber = N0;
	rState.localCommitmentNumber = N_R;

	// -- Both views --------------------------------------------------------------
	const rPointAct = rPoints[0];
	const rView = buildView('R', sState, rState, sSigner, rSigner, rPointAct, N_R_ACT, vouchers, sc);
	const sView = buildView('S', rState, sState, rSigner, sSigner, sPointAct, N_S_ACT, vouchers, sc);

	// -- H_commit, ff_activate, H_act, ff_activate_ack (7.5.2, 7.5.4) ----------
	const hCommit = sha256(
		Buffer.concat([
			ascii('ffor/commit'),
			u64(N_R_ACT),
			rView.txidInternal,
			u64(N_S_ACT),
			sView.txidInternal
		])
	);
	const ffActivate = signMessage(
		MSG_FF_ACTIVATE,
		Buffer.concat([CHANNEL_ID, epochId, tSetup, hBook, hCommit, u32(EPOCH_START_HEIGHT)]),
		R_NODE_PRIV,
		R_NODE_PUB
	);
	check(verifyMessage(ffActivate.wire, MSG_FF_ACTIVATE, R_NODE_PUB), `${tag} ff_activate: R's node-key signature verifies from the wire bytes alone`);
	const hAct = sha256(
		Buffer.concat([ascii('ffor/activate'), tSetup, hBook, hCommit, u32(EPOCH_START_HEIGHT)])
	);
	const ffActivateAck = signMessage(
		MSG_FF_ACTIVATE_ACK,
		Buffer.concat([CHANNEL_ID, epochId, hAct]),
		S_NODE_PRIV,
		S_NODE_PUB
	);
	check(verifyMessage(ffActivateAck.wire, MSG_FF_ACTIVATE_ACK, S_NODE_PUB), `${tag} ff_activate_ack: S's node-key signature verifies from the wire bytes alone`);

	// -- Force-close claim paths for voucher 1 (9.5.1) --------------------------
	const claims = buildClaims(rView, sView, vouchers[0], rPointAct, sPointAct, sc);

	// -- D.4: the refused amount ---------------------------------------------------
	let refusedDust: IScenarioResult['refusedDust'];
	if (sc.id === 'D.4') {
		const dBad = 545_999n;
		const reasons: string[] = [];
		if (dBad < MIN_PAYMENT_MSAT) reasons.push(`d = ${dBad} < min_payment_msat = ${MIN_PAYMENT_MSAT} (7.1)`);
		if (dBad / 1000n < DUST_LIMIT_SAT) reasons.push(`floor(d / 1000) = ${dBad / 1000n} sat < dust_limit ${DUST_LIMIT_SAT} sat: the output would trim (8, 7.6)`);
		check(reasons.length === 2, `${tag} 545,999 msat fails both setup checks (min_payment_msat and the section 8 trim floor) and is refused before any HTLC is built`);
		refusedDust = { d: dBad, reasons };
	}

	return {
		sc, K, budget, epochId, vouchers, rPoints, sPointAct,
		ffInit, ffAccept, tInit, tSetup, book, hBook, checks,
		rView, sView, hCommit, ffActivate, hAct, ffActivateAck, claims, refusedDust
	};
}

/**
 * Build one commitment view. `holder` owns the commitment; `builderState` is
 * the counterparty's state (it builds and signs the holder's commitment with
 * buildRemoteCommitment / signRemoteCommitment); `holderState` rebuilds it with
 * buildLocalCommitment and verifies the signatures.
 */
function buildView(
	holder: 'R' | 'S',
	builderState: IChannelState,
	holderState: IChannelState,
	builderSigner: ChannelSigner,
	holderSigner: ChannelSigner,
	point: Buffer,
	n: bigint,
	vouchers: IVoucher[],
	sc: IScenario
): ICommitView {
	const tag = `[${sc.id}] ${holder}-view`;
	const signer: 'R' | 'S' = holder === 'R' ? 'S' : 'R';
	const built = buildRemoteCommitment(builderState, point, n);
	const { signature, htlcSignatures } = signRemoteCommitment(builderState, builderSigner, point, n);
	const tx = built.result.tx;
	const txHex = tx.toHex();
	const txid = tx.getId();

	// Verification 1: the holder rebuilds identical bytes from its own state.
	const rebuilt = buildLocalCommitment(holderState, point, n);
	check(rebuilt.result.tx.toHex() === txHex, `${tag}: ${holder}'s own rebuild (buildLocalCommitment) is byte-identical to ${signer}'s construction (buildRemoteCommitment)`);
	// Verification 2: beignet's verifiers accept the counterparty's signatures.
	check(verifyRemoteCommitmentSig(holderState, holderSigner, point, signature, n), `${tag}: ${signer}'s commitment signature verifies (beignet verifyRemoteCommitmentSig)`);
	check(verifyRemoteHtlcSignatures(holderState, holderSigner, point, htlcSignatures, n), `${tag}: ${signer}'s ${htlcSignatures.length} htlc_signature(s) verify (beignet verifyRemoteHtlcSignatures)`);
	// Verification 3: independent strict ECDSA check of the commitment sig.
	const commitSighash = tx.hashForWitnessV0(0, built.fundingWitnessScript, built.fundingAmount, 0x01);
	const signerFundingPub = signer === 'S' ? sBasepoints.fundingPubkey : rBasepoints.fundingPubkey;
	check(verify(commitSighash, signerFundingPub, signature, true), `${tag}: ${signer}'s commitment signature verifies independently against the BIP 143 sighash of the funding input`);
	// Verification 4: round trip.
	check(bitcoin.Transaction.fromHex(txHex).getId() === txid, `${tag}: tx hex round-trips through the decoder to the same txid`);

	// Keys as they appear on this commitment ("local" = holder).
	const holderBp = holder === 'R' ? rBasepoints : sBasepoints;
	const signerBp = holder === 'R' ? sBasepoints : rBasepoints;
	const keys = deriveCommitmentKeys(holderBp, signerBp, point, true);
	check(keys.remotePaymentPubkey.equals(signerBp.paymentBasepoint), `${tag}: static_remotekey, to_remote pays ${signer}'s payment basepoint`);

	const om = built.result.outputMap;
	const { htlcs, htlcOriginalIndices } = om;
	check(htlcs.length === vouchers.length && htlcSignatures.length === vouchers.length, `${tag}: ${vouchers.length} voucher outputs and ${vouchers.length} htlc_signatures, none trimmed`);

	// Verification 5: BOLT 3 rounding. The funder's output is
	// floor(balance_msat / 1000) - fee - anchors with nothing added back.
	const feeSat = calculateCommitmentFee(FEERATE_PER_KW, htlcs.length, true, false);
	const holderIsFunder = sc.funder === holder;
	const holderMsat = holder === 'R' ? holderState.localBalanceMsat : holderState.localBalanceMsat;
	const signerMsat = holderState.remoteBalanceMsat;
	const expectedToLocal = holderMsat / 1000n - (holderIsFunder ? feeSat + ANCHOR_TOTAL_SAT : 0n);
	const expectedToRemote = signerMsat / 1000n - (holderIsFunder ? 0n : feeSat + ANCHOR_TOTAL_SAT);
	// BOLT 3: a main output below the holder's dust_limit is omitted (D.6: R's
	// 0 sat balance). The builder reports an omitted output as an undefined index.
	const mainOutputOk = (idx: number | undefined, expected: bigint): boolean =>
		expected < DUST_LIMIT_SAT ? idx === undefined : idx !== undefined && BigInt(tx.outs[idx].value) === expected;
	const describe = (name: string, expected: bigint): string =>
		expected < DUST_LIMIT_SAT ? `${name} omitted (${expected} sat < dust_limit)` : `${name} = ${expected}`;
	check(
		mainOutputOk(om.toLocal, expectedToLocal) && mainOutputOk(om.toRemote, expectedToRemote),
		`${tag}: ${describe('to_local', expectedToLocal)} and ${describe('to_remote', expectedToRemote)} sat, i.e. floor(msat balance / 1000) with fee ${feeSat} + anchors ${ANCHOR_TOTAL_SAT} charged to the funder (${sc.funder}) and sub-satoshi remainders left to the on-chain fee`
	);
	let absentNote: string | undefined;
	if (om.toLocal === undefined || om.toRemote === undefined) {
		const missing = om.toLocal === undefined ? `\`to_local\` (${holder})` : `\`to_remote\` (${signer})`;
		const anchorsPresent = om.anchorLocal !== undefined && om.anchorRemote !== undefined;
		check(anchorsPresent, `${tag}: both anchors are present although ${missing} is omitted (the commitment carries an untrimmed HTLC)`);
		absentNote = `${missing} is omitted: its balance is 0 msat, below \`dust_limit\` (BOLT 3). Both anchors remain because the commitment carries an untrimmed HTLC output. The fee and anchors are charged to \`${sc.funder}\` as usual.`;
	}

	const vouchersOnView: IVoucherOnView[] = [];
	for (let i = 0; i < htlcs.length; i++) {
		const outputIndex = htlcs[i];
		const meta = built.htlcOutputs[htlcOriginalIndices[i]];
		const v = vouchers.find((x) => x.hash.equals(meta.paymentHash))!;
		assert(v !== undefined, `${tag}: htlc output maps to a voucher by payment hash`);
		const amountSat = v.d / 1000n;
		assert(BigInt(tx.outs[outputIndex].value) === amountSat, `${tag} voucher ${v.k}: output value = floor(d_k / 1000)`);
		assert(meta.cltvExpiry === T_EXP, `${tag} voucher ${v.k}: cltv_expiry = T_exp`);
		// Holder R: received HTLC (S-offered), second level = HTLC-success (S signs).
		// Holder S: offered HTLC, second level = HTLC-timeout (R signs).
		let witnessScript: Buffer;
		let secondLevel: bitcoin.Transaction;
		let kind: IVoucherOnView['secondLevelKind'];
		if (holder === 'R') {
			witnessScript = buildReceivedHtlcScript(keys.revocationPubkey, keys.localHtlcPubkey, keys.remoteHtlcPubkey, v.hash, T_EXP, true);
			secondLevel = buildHtlcSuccessTx(txid, outputIndex, amountSat, keys.revocationPubkey, keys.localDelayedPubkey, TO_SELF_DELAY, BigInt(Math.floor((HTLC_SUCCESS_WEIGHT_ANCHORS * FEERATE_PER_KW) / 1000)), true);
			kind = 'HTLC-success';
		} else {
			witnessScript = buildOfferedHtlcScript(keys.revocationPubkey, keys.localHtlcPubkey, keys.remoteHtlcPubkey, v.hash, true);
			secondLevel = buildHtlcTimeoutTx(txid, outputIndex, amountSat, T_EXP, keys.revocationPubkey, keys.localDelayedPubkey, TO_SELF_DELAY, BigInt(Math.floor((HTLC_TIMEOUT_WEIGHT_ANCHORS * FEERATE_PER_KW) / 1000)), true);
			kind = 'HTLC-timeout';
		}
		assert(witnessScript.equals(meta.script), `${tag} voucher ${v.k}: reconstructed HTLC witness script matches the builder's`);
		const p2wsh = bitcoin.payments.p2wsh({ redeem: { output: witnessScript } }).output!;
		assert(p2wsh.equals(tx.outs[outputIndex].script), `${tag} voucher ${v.k}: output scriptPubKey = P2WSH(witness script)`);
		const sighash = secondLevel.hashForWitnessV0(0, witnessScript, Number(amountSat), 0x83);
		assert(verify(sighash, keys.remoteHtlcPubkey, htlcSignatures[i], true), `${tag} voucher ${v.k}: ${signer}'s htlc sig verifies independently (SINGLE|ANYONECANPAY over the ${kind} tx)`);
		vouchersOnView.push({
			k: v.k,
			outputIndex,
			amountSat,
			witnessScript,
			secondLevelKind: kind,
			secondLevelTxHex: secondLevel.toHex(),
			secondLevelTxid: secondLevel.getId(),
			sighash,
			counterpartySig: htlcSignatures[i]
		});
	}
	assertions.push(`${tag}: every voucher output has value floor(d_k / 1000), cltv_expiry T_exp, scriptPubKey = P2WSH of the reconstructed BOLT 3 HTLC script, and ${signer}'s htlc_signature verifies independently (strict low-S) against the SIGHASH_SINGLE|ANYONECANPAY digest of its ${holder === 'R' ? 'HTLC-success' : 'HTLC-timeout'} transaction`);

	const outputRows = tx.outs.map((o, idx) => {
		let kind = '';
		if (idx === om.toLocal) kind = `to_local (${holder})`;
		else if (idx === om.toRemote) kind = `to_remote (${signer})`;
		else if (idx === om.anchorLocal) kind = `anchor (${holder})`;
		else if (idx === om.anchorRemote) kind = `anchor (${signer})`;
		else {
			const vv = vouchersOnView.find((x) => x.outputIndex === idx);
			assert(vv !== undefined, `${tag}: output ${idx} is classified`);
			kind = holder === 'R' ? `voucher_${vv!.k} (received HTLC, S-offered)` : `voucher_${vv!.k} (offered HTLC)`;
		}
		return { index: idx, kind, amountSat: o.value, spk: hex(o.script) };
	});

	const openerBp = sc.funder === 'S' ? sBasepoints : rBasepoints;
	const acceptorBp = sc.funder === 'S' ? rBasepoints : sBasepoints;
	return {
		holder,
		signer,
		commitmentNumber: n,
		perCommitmentPoint: point,
		obscured: calculateObscuredCommitmentNumber(openerBp.paymentBasepoint, acceptorBp.paymentBasepoint, n),
		txHex,
		txid,
		txidInternal: tx.getHash(),
		commitFeeSat: feeSat,
		outputRows,
		commitSig: signature,
		vouchers: vouchersOnView,
		keys,
		wireSha256: sha256(Buffer.from(txHex, 'hex')),
		absentNote
	};
}

/** The four force-close spends of voucher 1, two per view (9.5.1). */
function buildClaims(
	rView: ICommitView,
	sView: ICommitView,
	v: IVoucher,
	rPoint: Buffer,
	sPoint: Buffer,
	sc: IScenario
): IClaimVector[] {
	const tag = `[${sc.id}]`;
	const claims: IClaimVector[] = [];
	const onR = rView.vouchers.find((x) => x.k === v.k)!;
	const onS = sView.vouchers.find((x) => x.k === v.k)!;

	// Per-commitment HTLC private keys.
	const rHtlcPrivOnR = derivePrivateKey(R_PAYMENT_BASEPOINT_SECRET, rPoint, rBasepoints.htlcBasepoint);
	const sHtlcPrivOnR = derivePrivateKey(S_PAYMENT_BASEPOINT_SECRET, rPoint, sBasepoints.htlcBasepoint);
	const rHtlcPrivOnS = derivePrivateKey(R_PAYMENT_BASEPOINT_SECRET, sPoint, rBasepoints.htlcBasepoint);
	const sHtlcPrivOnS = derivePrivateKey(S_PAYMENT_BASEPOINT_SECRET, sPoint, sBasepoints.htlcBasepoint);
	assert(getPublicKey(rHtlcPrivOnR).equals(rView.keys.localHtlcPubkey) && getPublicKey(sHtlcPrivOnR).equals(rView.keys.remoteHtlcPubkey), `${tag} HTLC keys on R's view re-derive`);
	assert(getPublicKey(sHtlcPrivOnS).equals(sView.keys.localHtlcPubkey) && getPublicKey(rHtlcPrivOnS).equals(sView.keys.remoteHtlcPubkey), `${tag} HTLC keys on S's view re-derive`);
	assert(derivePublicKey(rBasepoints.htlcBasepoint, sPoint).equals(sView.keys.remoteHtlcPubkey), `${tag} R's HTLC pubkey on S's view = derive(R htlc basepoint, S point)`);

	// (a) R's view: HTLC-success, S's setup-time sig + R's sig + preimage.
	{
		const tx = bitcoin.Transaction.fromHex(onR.secondLevelTxHex);
		const rSighash = tx.hashForWitnessV0(0, onR.witnessScript, Number(onR.amountSat), 0x01);
		const rSigCompact = sign(rSighash, rHtlcPrivOnR);
		check(verify(rSighash, rView.keys.localHtlcPubkey, rSigCompact, true), `${tag} R-view HTLC-success: R's own signature (SIGHASH_ALL) verifies`);
		check(verify(onR.sighash, rView.keys.remoteHtlcPubkey, onR.counterpartySig, true), `${tag} R-view HTLC-success: S's setup-time htlc_signature (SINGLE|ANYONECANPAY) verifies over the same transaction`);
		check(sha256(v.preimage).equals(v.hash), `${tag} preimage t_1 hashes to H_1`);
		const witness = [Buffer.alloc(0), toDerWithSighash(onR.counterpartySig, 0x83), toDerWithSighash(rSigCompact, 0x01), v.preimage, onR.witnessScript];
		tx.setWitness(0, witness);
		claims.push({
			title: `R's view: HTLC-success transaction for voucher 1 (R claims with t_1)`,
			description: [
				`Spends output ${onR.outputIndex} of R's commitment (${onR.amountSat} sat, received-HTLC script). Zero fee,`,
				'`nSequence = 1`, `nLockTime = 0`, single output of the full amount to the CSV-delayed script',
				'(revocation key or R\'s delayed key after `to_self_delay = 144`). S\'s signature is the',
				'`htlc_signature` from the setup `commitment_signed` (9.5.3): R needs nothing from S at claim time.'
			],
			txHexUnsigned: onR.secondLevelTxHex,
			txHexSigned: tx.toHex(),
			txid: tx.getId(),
			sighash: rSighash,
			sighashType: 'R: `SIGHASH_ALL` (0x01); S: `SIGHASH_SINGLE|ANYONECANPAY` (0x83), sighash in the R-view table above',
			witness: witnessHex(witness),
			witnessLayout: '`0 <S htlc sig, DER+0x83> <R htlc sig, DER+0x01> <t_1> <received-HTLC witness script>`',
			extra: [
				['R HTLC privkey on this commitment', hex(rHtlcPrivOnR)],
				['R signature (compact)', hex(rSigCompact)],
				['R signature (DER + 0x01)', hex(toDerWithSighash(rSigCompact, 0x01))],
				['S signature (DER + 0x83)', hex(toDerWithSighash(onR.counterpartySig, 0x83))]
			]
		});
	}

	// (b) R's view: S spends the received-HTLC output directly after T_exp.
	{
		const tx = buildRemoteHtlcTimeoutClaimTx({
			commitmentTxid: rView.txid,
			outputIndex: onR.outputIndex,
			amount: onR.amountSat,
			witnessScript: onR.witnessScript,
			destinationScript: S_SWEEP_SPK,
			feeSatoshis: CLAIM_FEE_SAT,
			cltvExpiry: T_EXP,
			inputSequence: 1
		});
		const unsigned = tx.toHex();
		const sighash = tx.hashForWitnessV0(0, onR.witnessScript, Number(onR.amountSat), 0x01);
		const sSig = sign(sighash, sHtlcPrivOnR);
		check(verify(sighash, rView.keys.remoteHtlcPubkey, sSig, true), `${tag} R-view direct timeout spend by S: S's signature verifies against the received-HTLC script`);
		const witness = buildRemoteHtlcTimeoutWitness(toDerWithSighash(sSig, 0x01), onR.witnessScript);
		tx.setWitness(0, witness);
		claims.push({
			title: `R's view: S's direct timeout spend of voucher 1 after T_exp`,
			description: [
				`Spends the same output ${onR.outputIndex} through the received-HTLC script's timeout branch:`,
				'`nLockTime = T_exp`, `nSequence = 1` (the anchor CSV; also what makes CLTV enforceable),',
				`${CLAIM_FEE_SAT} sat nominal fee, remainder to S's sweep P2WPKH. No second-level transaction and no`,
				'signature from R: this is how S recovers an unclaimed voucher if R never returns (9.5.1).',
				'beignet builder: `buildRemoteHtlcTimeoutClaimTx` + `buildRemoteHtlcTimeoutWitness`.'
			],
			txHexUnsigned: unsigned,
			txHexSigned: tx.toHex(),
			txid: tx.getId(),
			sighash,
			sighashType: '`SIGHASH_ALL` (0x01)',
			witness: witnessHex(witness),
			witnessLayout: '`<S htlc sig, DER+0x01> <> <received-HTLC witness script>` (the empty element fails `OP_SIZE 32 OP_EQUAL`, selecting the timeout branch)',
			extra: [
				['S HTLC privkey on this commitment', hex(sHtlcPrivOnR)],
				['S signature (compact)', hex(sSig)],
				['destination (S sweep P2WPKH)', hex(S_SWEEP_SPK)]
			]
		});
	}

	// (c) S's view: R claims the offered-HTLC output directly with t_1.
	{
		const tx = buildRemoteHtlcPreimageClaimTx({
			commitmentTxid: sView.txid,
			outputIndex: onS.outputIndex,
			amount: onS.amountSat,
			witnessScript: onS.witnessScript,
			destinationScript: R_SWEEP_SPK,
			feeSatoshis: CLAIM_FEE_SAT,
			inputSequence: 1
		});
		const unsigned = tx.toHex();
		const sighash = tx.hashForWitnessV0(0, onS.witnessScript, Number(onS.amountSat), 0x01);
		const rSig = sign(sighash, rHtlcPrivOnS);
		check(verify(sighash, sView.keys.remoteHtlcPubkey, rSig, true), `${tag} S-view direct preimage claim by R: R's signature verifies against the offered-HTLC script`);
		const witness = buildRemoteHtlcPreimageWitness(toDerWithSighash(rSig, 0x01), v.preimage, onS.witnessScript);
		tx.setWitness(0, witness);
		claims.push({
			title: `S's view: R's direct preimage claim of voucher 1`,
			description: [
				`Spends output ${onS.outputIndex} of S's commitment (${onS.amountSat} sat, offered-HTLC script) through the`,
				'preimage branch with R\'s own key and `t_1`: no second-stage signature is needed (9.5.1).',
				`\`nSequence = 1\` (anchor CSV), \`nLockTime = 0\`, ${CLAIM_FEE_SAT} sat nominal fee, remainder to R's sweep P2WPKH.`,
				'beignet builder: `buildRemoteHtlcPreimageClaimTx` + `buildRemoteHtlcPreimageWitness`.'
			],
			txHexUnsigned: unsigned,
			txHexSigned: tx.toHex(),
			txid: tx.getId(),
			sighash,
			sighashType: '`SIGHASH_ALL` (0x01)',
			witness: witnessHex(witness),
			witnessLayout: '`<R htlc sig, DER+0x01> <t_1> <offered-HTLC witness script>`',
			extra: [
				['R HTLC privkey on this commitment', hex(rHtlcPrivOnS)],
				['R signature (compact)', hex(rSig)],
				['destination (R sweep P2WPKH)', hex(R_SWEEP_SPK)]
			]
		});
	}

	// (d) S's view: HTLC-timeout after T_exp, R's setup-time sig + S's sig.
	{
		const tx = bitcoin.Transaction.fromHex(onS.secondLevelTxHex);
		const sSighash = tx.hashForWitnessV0(0, onS.witnessScript, Number(onS.amountSat), 0x01);
		const sSig = sign(sSighash, sHtlcPrivOnS);
		check(verify(sSighash, sView.keys.localHtlcPubkey, sSig, true), `${tag} S-view HTLC-timeout: S's own signature (SIGHASH_ALL) verifies`);
		check(verify(onS.sighash, sView.keys.remoteHtlcPubkey, onS.counterpartySig, true), `${tag} S-view HTLC-timeout: R's setup-time htlc_signature (SINGLE|ANYONECANPAY) verifies over the same transaction`);
		const witness = [Buffer.alloc(0), toDerWithSighash(onS.counterpartySig, 0x83), toDerWithSighash(sSig, 0x01), Buffer.alloc(0), onS.witnessScript];
		tx.setWitness(0, witness);
		claims.push({
			title: `S's view: HTLC-timeout transaction for voucher 1 (S recovers after T_exp)`,
			description: [
				`Spends output ${onS.outputIndex} of S's commitment. Zero fee, \`nSequence = 1\`, \`nLockTime = T_exp = ${T_EXP}\`,`,
				'single output of the full amount to the CSV-delayed script (revocation key or S\'s delayed key',
				'after `to_self_delay = 144`). R\'s signature is the `htlc_signature` R sent in its setup',
				'`commitment_signed` (9.5.1 step 4).'
			],
			txHexUnsigned: onS.secondLevelTxHex,
			txHexSigned: tx.toHex(),
			txid: tx.getId(),
			sighash: sSighash,
			sighashType: 'S: `SIGHASH_ALL` (0x01); R: `SIGHASH_SINGLE|ANYONECANPAY` (0x83), sighash in the S-view table above',
			witness: witnessHex(witness),
			witnessLayout: '`0 <R htlc sig, DER+0x83> <S htlc sig, DER+0x01> <> <offered-HTLC witness script>`',
			extra: [
				['S HTLC privkey on this commitment', hex(sHtlcPrivOnS)],
				['S signature (compact)', hex(sSig)],
				['S signature (DER + 0x01)', hex(toDerWithSighash(sSig, 0x01))],
				['R signature (DER + 0x83)', hex(toDerWithSighash(onS.counterpartySig, 0x83))]
			]
		});
	}
	return claims;
}

// ---------------------------------------------------------------------------
// Run every scenario
// ---------------------------------------------------------------------------

const results = SCENARIOS.map(runScenario);

// Cross-scenario checks.
{
	const d2 = results.find((r) => r.sc.id === 'D.2')!;
	const d3 = results.find((r) => r.sc.id === 'D.3')!;
	check(
		d2.rView.vouchers.map((v) => `${v.k}:${v.outputIndex}`).join(',') === d3.rView.vouchers.map((v) => `${v.k}:${v.outputIndex}`).join(','),
		'[D.2 vs D.3] the voucher output order on R\'s view is the same whichever side funds (BOLT 3 order depends on amount and script, not on the funder)'
	);
	// Appendix A layout cross-check: same output layout as A.3.3 C_3 (anchors,
	// then voucher 2 at 546 sat, voucher 1 at 994 sat, voucher 3 at 49,749 sat,
	// then to_local 3,000,000 sat, then to_remote 6,943,950 sat).
	const rowsD2 = d2.rView.outputRows.map((r) => r.kind.split(' ')[0]).join(',');
	check(rowsD2 === 'anchor,anchor,voucher_2,voucher_1,voucher_3,to_local,to_remote', `[D.2] R-view output layout is ${rowsD2}: the Appendix A C_3 layout (voucher 2 at 546 sat sorts before voucher 1 at 994 sat)`);
	const a3ToLocal = 3_000_000; // Appendix A C_3 to_local (R, not the funder)
	const a3ToRemote = 6_943_950; // Appendix A C_3 to_remote (S funder, after 3 vouchers, fee 4100 + anchors 660)
	check(
		d2.rView.outputRows.find((r) => r.kind.startsWith('to_local'))!.amountSat === a3ToLocal &&
			d2.rView.outputRows.find((r) => r.kind.startsWith('to_remote'))!.amountSat === a3ToRemote,
		`[D.2] R-view to_local ${a3ToLocal} / to_remote ${a3ToRemote} sat equal Appendix A C_3's values (same balances, same fee, keys differ)`
	);
	const d5 = results.find((r) => r.sc.id === 'D.5')!;
	check(d5.rView.vouchers.length === 483 && d5.sView.vouchers.length === 483, '[D.5] both views carry 483 untrimmed voucher outputs');
	check(d5.ffInit.wire.length <= 65535 && d5.ffAccept.wire.length <= 65535, `[D.5] ff_init (${d5.ffInit.wire.length} bytes) and ff_accept (${d5.ffAccept.wire.length} bytes) fit a BOLT 8 message`);
	// Determinism: a second run of D.1 reproduces every byte.
	const again = runScenario(SCENARIOS[0]);
	const first = results[0];
	check(
		again.ffInit.wire.equals(first.ffInit.wire) && again.ffAccept.wire.equals(first.ffAccept.wire) && again.hAct.equals(first.hAct) && again.rView.txHex === first.rView.txHex && again.sView.txHex === first.sView.txHex && again.vouchers[0].onion.equals(first.vouchers[0].onion),
		'[D.1] a second in-process run reproduces every message, onion, commitment and hash byte-for-byte'
	);
}

// ---------------------------------------------------------------------------
// Emit the Markdown appendix
// ---------------------------------------------------------------------------

const out: string[] = [];
const w = (s = ''): number => out.push(s);
const kv = (rows: [string, string][]): void => {
	w('| Field | Value |');
	w('|---|---|');
	for (const [k, v] of rows) w(`| ${k} | ${v} |`);
	w();
};
const code = (s: string): void => {
	w('```');
	w(s);
	w('```');
	w();
};

w('# FFOR Appendix D: Variant D setup transcript and both-view commitment vectors');
w();
w('Deterministic, byte-exact test vectors for the Variant D setup of');
w('[FFOR](ffor-offline-receive.md): the signed `ff_init` / `ff_accept` exchange');
w('(7.1, 7.2), the transcript hashes and the voucher book (7.5.2, 7.5.3), the');
w('`update_add_htlc` messages with their onions and BOTH commitment views after');
w('the voucher round (9.5.1), `H_commit`, the signed `ff_activate` /');
w('`ff_activate_ack` pair and `H_act` (7.5.4), and the force-close claim paths of');
w('voucher 1 from both views. Every message, transaction and signature was built,');
w('signed and verified by running the beignet Lightning library (BOLT 3');
w('commitment builder and signer, BOLT 4 onion construction and processing,');
w('script helpers), not written by hand. All hex is lowercase; all signatures are');
w('deterministic (RFC 6979, low-S), so this file regenerates byte-identically.');
w();
w('Six scenarios share one fixture (D.0). Each scenario is a complete transcript:');
w();
w('| Scenario | K | Funder | Amounts (msat) | `s_htlc_id_base` | R pre-round balance (msat) |');
w('|---|---|---|---|---|---|');
for (const r of results) {
	const amt = r.K > 3 ? `${r.K} x ${r.sc.amounts[0]}` : r.sc.amounts.join(', ');
	w(`| ${r.sc.id} | ${r.K} | \`${r.sc.funder}\` | ${amt} | ${r.sc.sHtlcIdBase} | ${r.sc.rPreMsat} |`);
}
w();
w('Conventions used throughout, where the spec leaves the byte layout to the');
w('implementer (each is also listed in D.8 for the spec author):');
w();
w('- **Signed message body.** `body` in 7\'s `SHA256("ffor/msg" || type || body_excluding_the_signature)`');
w('  is everything after the 2-byte type: `channel_id`, `epoch_id`, the fixed');
w('  fields, then the TLV stream. The 32-byte digest is signed directly with');
w('  ECDSA (no second hash) and carried as a 64-byte compact `r || s`.');
w('- **TLV stream.** BOLT 1 encoding (BigSize type, BigSize length, value),');
w('  strictly increasing types, no length prefix: the stream runs from the end of');
w('  the fixed fields to the start of the final 64-byte signature. A message with');
w('  no TLVs has an empty stream (`ff_activate`, `ff_activate_ack`).');
w('- **"Wire bytes"** of a message (the input of `T_init` and `T_setup`) are the');
w('  complete message as sent: `[2: type] || body || signature`.');
w('- **Voucher onion.** Single hop to `R`\'s node key, associated data =');
w('  `payment_hash = H_k` (BOLT 4), session key seeded as');
w('  `SHA256("ffor/vector/onion-session" || epoch_id || [2: k])` (the spec says');
w('  "fresh random"; a vector must be reproducible).');
w('- **`epoch_id`** is `SHA256("ffor/vector/<scenario>/epoch_id")` and preimage');
w('  `t_k` is `SHA256("ffor/vector/<scenario>/preimage" || [2: k])`; both are');
w('  random in a real run.');
w('- **`channel_id`** is BOLT 2\'s `funding_txid XOR funding_output_index` over the');
w('  Appendix C funding outpoint.');
w();
w('## D.0 Shared fixture');
w();
w('### Channel');
w();
w('| Parameter | Value |');
w('|---|---|');
w('| channel type | `option_static_remotekey` + `option_anchors_zero_fee_htlc_tx` |');
w(`| \`channel_type\` bits (hex) | \`${hex(CHANNEL_TYPE)}\` (bits 12, 22) |`);
w(`| funding outpoint | \`${FUNDING_TXID_DISPLAY}:${FUNDING_OUTPUT_INDEX}\` (BOLT 3 Appendix C) |`);
w(`| funding txid (internal byte order) | \`${FUNDING_TXID_INTERNAL}\` |`);
w(`| \`channel_id\` | \`${hex(CHANNEL_ID)}\` |`);
w(`| funding amount | ${FUNDING_SAT} sat |`);
w(`| pre-round balance \`S\` | ${S_BALANCE_MSAT_PRE} msat (D.1 to D.5); ${FUNDING_SAT * 1000n} msat (D.6) |`);
w(`| pre-round balance \`R\` | ${R_BALANCE_MSAT_PRE} msat (D.1 to D.5); 0 msat (D.6) |`);
w(`| \`dust_limit_satoshis\` (both sides) | ${DUST_LIMIT_SAT} |`);
w(`| \`to_self_delay\` (both sides) | ${TO_SELF_DELAY} |`);
w(`| \`channel_reserve_satoshis\` (both sides) | ${CHANNEL_RESERVE_SAT} |`);
w(`| \`max_accepted_htlcs\` (both sides; R's binds the vouchers) | ${MAX_ACCEPTED_HTLCS} |`);
w(`| \`max_htlc_value_in_flight_msat\` (both sides) | ${MAX_HTLC_VALUE_IN_FLIGHT_MSAT} |`);
w(`| \`htlc_minimum_msat\` (both sides) | ${HTLC_MINIMUM_MSAT} |`);
w(`| frozen \`feerate_per_kw\` | ${FEERATE_PER_KW} |`);
w();
w('### Epoch parameters common to every scenario (7.1)');
w();
w('| Parameter | Value |');
w('|---|---|');
w(`| \`variant\` | ${VARIANT_D} (D) |`);
w(`| \`profile\` (book byte, 7.5.3) | ${PROFILE_FIXED} (fixed-amount: TLV 9 present) |`);
w(`| \`n_R\` / \`n0\` (commitment numbers before the round) | ${N_R} / ${N0} |`);
w(`| \`n_R^act\` / \`n_S^act\` (at activation, after the round) | ${N_R_ACT} / ${N_S_ACT} |`);
w(`| \`T_exp\` (\`voucher_expiry\`, uniform \`cltv_expiry\`) | ${T_EXP} |`);
w(`| \`D\` (\`settlement_deadline\`) | ${D_DEADLINE} (= T_exp - 1008) |`);
w(`| \`epoch_start_height\` (\`ff_activate\`) | ${EPOCH_START_HEIGHT} |`);
w(`| \`fee_base_msat\` | ${FEE_BASE_MSAT} |`);
w(`| \`fee_proportional_millionths\` | ${FEE_PROP_MILLIONTHS} |`);
w(`| \`min_payment_msat\` (= voucher dust floor, 546 sat) | ${MIN_PAYMENT_MSAT} |`);
w(`| \`G\` (\`escape_granularity_msat\`) | ${G_ESCAPE} (mandatory in Variant D) |`);
w(`| TLVs 1, 3, 5 in \`ff_init\` | absent (mandatory in Variant D) |`);
w(`| nominal fee of the direct on-chain claims (D.x.8) | ${CLAIM_FEE_SAT} sat |`);
w();
w('### Secrets and seeds');
w();
w('Identical to Appendix A.1 (BOLT 3 Appendix C material reused verbatim;');
w('`R` = Appendix C *local*, `S` = Appendix C *remote*; each side\'s HTLC basepoint');
w('equals its payment basepoint), plus node keys and sweep keys that Appendix A');
w('does not need.');
w();
w('| Secret | Value | Source |');
w('|---|---|---|');
w(`| \`R\` funding privkey | \`${hex(R_FUNDING_PRIV)}\` | Appendix C \`local_funding_privkey\` |`);
w(`| \`S\` funding privkey | \`${hex(S_FUNDING_PRIV)}\` | Appendix C \`remote_funding_privkey\` |`);
w(`| \`R\` payment+HTLC basepoint secret | \`${hex(R_PAYMENT_BASEPOINT_SECRET)}\` | Appendix C \`local_payment_basepoint_secret\` |`);
w(`| \`R\` delayed-payment basepoint secret | \`${hex(R_DELAYED_BASEPOINT_SECRET)}\` | Appendix C \`local_delayed_payment_basepoint_secret\` |`);
w(`| \`S\` payment+HTLC basepoint secret | \`${hex(S_PAYMENT_BASEPOINT_SECRET)}\` | Appendix C \`remote_payment_basepoint_secret\` |`);
w(`| \`S\` revocation basepoint secret | \`${hex(S_REVOCATION_BASEPOINT_SECRET)}\` | Appendix C \`remote_revocation_basepoint_secret\` |`);
w(`| \`R\` revocation basepoint secret | \`${hex(R_REVOCATION_BASEPOINT_SECRET)}\` | \`SHA256("${FFOR_TAGS.rRevocationBasepointSecret}")\` |`);
w(`| \`S\` delayed-payment basepoint secret | \`${hex(S_DELAYED_BASEPOINT_SECRET)}\` | \`SHA256("${FFOR_TAGS.sDelayedBasepointSecret}")\` |`);
w(`| \`R\` per-commitment seed | \`${hex(R_PC_SEED)}\` | \`SHA256("${FFOR_TAGS.rPerCommitmentSeed}")\` |`);
w(`| \`S\` per-commitment seed | \`${hex(S_PC_SEED)}\` | \`SHA256("${FFOR_TAGS.sPerCommitmentSeed}")\` |`);
w(`| \`R\` node privkey (signs \`ff_init\`, \`ff_activate\`; decrypts voucher onions) | \`${hex(R_NODE_PRIV)}\` | \`SHA256("${FFOR_TAGS.rNodeKey}")\` |`);
w(`| \`S\` node privkey (signs \`ff_accept\`, \`ff_activate_ack\`) | \`${hex(S_NODE_PRIV)}\` | \`SHA256("${FFOR_TAGS.sNodeKey}")\` |`);
w(`| \`R\` sweep privkey (P2WPKH destination of R's direct claim) | \`${hex(R_SWEEP_PRIV)}\` | \`SHA256("${FFOR_TAGS.rSweepKey}")\` |`);
w(`| \`S\` sweep privkey (P2WPKH destination of S's direct claim) | \`${hex(S_SWEEP_PRIV)}\` | \`SHA256("${FFOR_TAGS.sSweepKey}")\` |`);
w();
w('Per-commitment secrets use the BOLT 3 shachain: the secret for commitment');
w('number `n` is `generate_from_seed(seed, 2^48 - 1 - n)`; the point is `secret * G`.');
w();
w('### Public keys (derived)');
w();
w('| Key | Value |');
w('|---|---|');
w(`| \`R\` node id | \`${hex(R_NODE_PUB)}\` |`);
w(`| \`S\` node id | \`${hex(S_NODE_PUB)}\` |`);
w(`| \`R\` funding pubkey | \`${hex(rBasepoints.fundingPubkey)}\` |`);
w(`| \`S\` funding pubkey | \`${hex(sBasepoints.fundingPubkey)}\` |`);
w(`| \`R\` payment (= HTLC) basepoint | \`${hex(rBasepoints.paymentBasepoint)}\` |`);
w(`| \`R\` delayed-payment basepoint | \`${hex(rBasepoints.delayedPaymentBasepoint)}\` |`);
w(`| \`R\` revocation basepoint | \`${hex(rBasepoints.revocationBasepoint)}\` |`);
w(`| \`S\` payment (= HTLC) basepoint | \`${hex(sBasepoints.paymentBasepoint)}\` |`);
w(`| \`S\` delayed-payment basepoint | \`${hex(sBasepoints.delayedPaymentBasepoint)}\` |`);
w(`| \`S\` revocation basepoint | \`${hex(sBasepoints.revocationBasepoint)}\` |`);
w(`| funding witness script | \`${hex(fundingScriptRS.witnessScript)}\` |`);
w(`| \`R\` sweep scriptPubKey | \`${hex(R_SWEEP_SPK)}\` |`);
w(`| \`S\` sweep scriptPubKey | \`${hex(S_SWEEP_SPK)}\` |`);
w(`| \`per_commitment_point_R[${N_R_ACT}]\` (R's view, every scenario) | \`${hex(pcPoint(R_PC_SEED, N_R_ACT))}\` |`);
w(`| \`per_commitment_point_S[${N_S_ACT}]\` (S's view, every scenario) | \`${hex(pcPoint(S_PC_SEED, N_S_ACT))}\` |`);
w(`| \`per_commitment_secret_S[${N0}]\` (revealed by the setup \`revoke_and_ack\`; no \`H_k\` may equal its hash) | \`${hex(pcSecret(S_PC_SEED, N0))}\` |`);
w();
w('### Wire layouts');
w();
code([
	'ff_init (55001)         [2: 0xd6d9][32: channel_id][32: epoch_id][1: variant][8: budget_msat]',
	'                        [2: max_payments K][8: min_payment_msat][4: settlement_deadline D]',
	'                        [4: voucher_expiry T_exp][4: fee_base_msat][4: fee_proportional_millionths]',
	'                        [8: escape_granularity_msat G][2: 0] (r_per_commitment_points, empty under Variant D)',
	'                        [TLV 9: K*8 voucher_amounts_msat][64: R node-key sig]',
	'ff_accept (55003)       [2: 0xd6db][32: channel_id][32: epoch_id][8: s_commitment_number n0]',
	'                        [TLV 1: K*32 payment_hashes][TLV 7: 8 s_htlc_id_base]',
	'                        [TLV 9: K*8 voucher_amounts_msat][TLV 11: 32 init_hash][64: S node-key sig]',
	'ff_activate (55045)     [2: 0xd705][32: channel_id][32: epoch_id][32: setup_hash][32: book_hash]',
	'                        [32: commit_hash][4: epoch_start_height][TLV stream: empty][64: R node-key sig]',
	'ff_activate_ack (55047) [2: 0xd707][32: channel_id][32: epoch_id][32: activation_hash]',
	'                        [TLV stream: empty][64: S node-key sig]',
	'update_add_htlc (128)   [2: 0x0080][32: channel_id][8: id][8: amount_msat][32: payment_hash]',
	'                        [4: cltv_expiry][1366: onion_routing_packet]',
	'',
	'digest(msg) = SHA256("ffor/msg" || [2: type] || body_excluding_signature)',
	'T_init      = SHA256("ffor/tr/init"  || ff_init wire bytes)',
	'T_setup     = SHA256("ffor/tr/setup" || T_init || ff_accept wire bytes)',
	'entry_k     = [2: k][32: H_k][8: d_k][4: T_exp][4: D][8: s_htlc_id_k]',
	'book        = [32: epoch_id][1: variant][1: profile][2: K] || entry_1 || ... || entry_K',
	'H_book      = SHA256("ffor/book" || book)',
	'H_commit    = SHA256("ffor/commit" || [8: n_R^act] || txid(C^R) internal || [8: n_S^act] || txid(C^S) internal)',
	'H_act       = SHA256("ffor/activate" || T_setup || H_book || H_commit || [4: epoch_start_height])'
].join('\n'));

for (const r of results) {
	emitScenario(r);
}

function emitScenario(r: IScenarioResult): void {
	const { sc, K } = r;
	const id = sc.id;
	const ab = sc.abbreviated;
	w(`## ${id} ${sc.title}`);
	w();
	for (const line of sc.intro) w(line);
	w();

	// -- parameters --------------------------------------------------------------
	w(`### ${id}.1 Parameters`);
	w();
	w('| Parameter | Value |');
	w('|---|---|');
	w(`| funder / opener | \`${sc.funder}\` |`);
	w(`| \`epoch_id\` | \`${hex(r.epochId)}\` |`);
	w(`| \`K\` (\`max_payments\`) | ${K} |`);
	w(`| \`voucher_amounts_msat\` (TLV 9, \`d_1..d_${K}\`) | ${K > 3 ? `${K} x ${sc.amounts[0]}` : sc.amounts.join(', ')} |`);
	w(`| \`budget_msat\` (= sum) | ${r.budget} |`);
	w(`| \`min_payment_msat\` | ${MIN_PAYMENT_MSAT} |`);
	w(`| \`T_exp\` / \`D\` | ${T_EXP} / ${D_DEADLINE} |`);
	w(`| \`fee_base_msat\` / \`fee_proportional_millionths\` | ${FEE_BASE_MSAT} / ${FEE_PROP_MILLIONTHS} |`);
	w(`| \`G\` / \`variant\` / \`profile\` | ${G_ESCAPE} / ${VARIANT_D} / ${PROFILE_FIXED} |`);
	w(`| \`s_htlc_id_base\` (\`ff_accept\` TLV 7) | ${sc.sHtlcIdBase} |`);
	w(`| \`n0\` (\`ff_accept\`) | ${N0} |`);
	w(`| commitment fee at the frozen rate, ${K} outputs (paid by \`${sc.funder}\`) | ${r.rView.commitFeeSat} sat (+ ${ANCHOR_TOTAL_SAT} sat anchors) |`);
	w(`| pre-round balance \`S\` / \`R\` | ${FUNDING_SAT * 1000n - sc.rPreMsat} / ${sc.rPreMsat} msat |`);
	w(`| \`S\` balance after the round | ${FUNDING_SAT * 1000n - sc.rPreMsat - r.budget} msat |`);
	w();
	w('Vouchers (`fee_S` and `gross_into_S` per 7.6 are what the payer\'s HTLC must deliver; they never appear on the channel):');
	w();
	w('| k | d_k (msat) | output (sat) | fee_S(d_k) | gross_into_S(d_k) | s_htlc_id_k | preimage t_k (S only) | H_k |');
	w('|---|---|---|---|---|---|---|---|');
	const shown = ab ? [r.vouchers[0], r.vouchers[K - 1]] : r.vouchers;
	for (const v of shown) {
		w(`| ${v.k} | ${v.d} | ${v.d / 1000n} | ${v.feeMsat} | ${v.grossMsat} | ${v.htlcId} | \`${hex(v.preimage)}\` | \`${hex(v.hash)}\` |`);
		if (ab && v.k === 1) w('| ... | | | | | | | |');
	}
	w();
	w(`\`r_per_commitment_points\` is empty under Variant D (7.1: count 0). \`R\`'s per-commitment point for commitment number ${N_R + 1n}, which \`S\` holds from \`R\`'s last \`revoke_and_ack\`, is \`${hex(r.rPoints[0])}\`.`);
	w();

	// -- setup checks ------------------------------------------------------------
	w(`### ${id}.2 Setup checks (7.1, 7.2, 7.5.3, 7.6, 8, 9.5.1 bounds)`);
	w();
	w('All checked at `ff_accept` and rechecked at `ff_activate`; every row is a hard assertion in the generator.');
	w();
	w('| Check | Values | Result |');
	w('|---|---|---|');
	for (const c of r.checks) w(`| ${c.name} | ${c.value} | ${c.pass ? 'pass' : 'FAIL'} |`);
	w();

	// -- messages ------------------------------------------------------------------
	w(`### ${id}.3 \`ff_init\` and \`ff_accept\` (7.1, 7.2)`);
	w();
	const emitMsg = (name: string, m: ISignedMessage, signer: string, note?: string): void => {
		w(`**\`${name}\` (type ${m.type}, ${m.wire.length} bytes, signed by \`${signer}\`)**${note ? ` ${note}` : ''}`);
		w();
		kv([
			['digest `SHA256("ffor/msg" || type || body)`', `\`${hex(m.digest)}\``],
			['signature (final 64 bytes)', `\`${hex(m.signature)}\``],
			['SHA256(wire bytes)', `\`${hex(sha256(m.wire))}\``]
		]);
		if (ab && m.wire.length > 1024) {
			w(`Wire bytes (first 160 bytes; the full ${m.wire.length} bytes are reproduced by the generator):`);
			w();
			code(hex(m.wire.subarray(0, 160)) + '...');
		} else {
			w('Wire bytes:');
			w();
			code(hex(m.wire));
		}
	};
	emitMsg('ff_init', r.ffInit, 'R');
	kv([['`T_init`', `\`${hex(r.tInit)}\``]]);
	emitMsg('ff_accept', r.ffAccept, 'S', '(TLV 1 hashes, TLV 7 `s_htlc_id_base`, TLV 9 byte-identical to `ff_init`\'s, TLV 11 = `T_init`)');
	kv([['`T_setup`', `\`${hex(r.tSetup)}\``]]);

	// -- book ----------------------------------------------------------------------
	w(`### ${id}.4 The voucher book (7.5.3)`);
	w();
	w(`\`book\` is ${r.book.length} bytes (\`36 + 58 K\`): \`[32: epoch_id][1: 0x04][1: 0x01][2: K]\` then one 58-byte entry per slot.`);
	w();
	if (ab) {
		w('First and last entries:');
		w();
		code(`entry_1:   ${hex(r.book.subarray(36, 36 + 58))}\nentry_${K}: ${hex(r.book.subarray(36 + 58 * (K - 1)))}`);
	} else {
		code(hex(r.book));
	}
	kv([['`H_book`', `\`${hex(r.hBook)}\``], ['SHA256(book) (for cross-checking an encoder without the tag)', `\`${hex(sha256(r.book))}\``]]);

	// -- adds + onion --------------------------------------------------------------
	w(`### ${id}.5 \`update_add_htlc\` and the voucher onions (9.5.1 step 3)`);
	w();
	w('`S` sends one stock `update_add_htlc` per slot in `k` order. `R` recognises a');
	w('voucher by `(id, amount_msat, payment_hash, cltv_expiry)` matching the book and');
	w('parks it; the onion is decodable but never acted on.');
	w();
	w('| k | id | amount_msat | payment_hash | cltv_expiry | payment_secret (final payload) | onion session key | onion ephemeral pubkey |');
	w('|---|---|---|---|---|---|---|---|');
	for (const v of shown) {
		w(`| ${v.k} | ${v.htlcId} | ${v.d} | \`${hex(v.hash)}\` | ${T_EXP} | \`${hex(v.paymentSecret)}\` | \`${hex(v.sessionKey)}\` | \`${hex(v.ephemeralPubkey)}\` |`);
		if (ab && v.k === 1) w('| ... | | | | | | | |');
	}
	w();
	const v1 = r.vouchers[0];
	w(`Voucher 1's complete \`update_add_htlc\` (${v1.addHtlcWire.length} bytes; the final 1366 bytes are the onion packet, whose first byte is the version 0x00 and whose next 33 are the ephemeral pubkey above). Final hop payload: \`{amt_to_forward = ${v1.d}, outgoing_cltv_value = ${T_EXP}, payment_data = {payment_secret, total_msat = ${v1.d}}}\`, TLV types 2, 4, 8.`);
	w();
	code(hex(v1.addHtlcWire));

	// -- both views ----------------------------------------------------------------
	w(`### ${id}.6 Both commitment views after the round (9.5.1 steps 4 and 5)`);
	w();
	emitView(r, r.rView, `${id}.6.1`);
	emitView(r, r.sView, `${id}.6.2`);

	// -- activation ----------------------------------------------------------------
	w(`### ${id}.7 \`H_commit\`, \`ff_activate\`, \`H_act\`, \`ff_activate_ack\` (7.5.2, 7.5.4)`);
	w();
	kv([
		[`\`n_R^act\` / \`txid(C^R)\` internal byte order`, `${N_R_ACT} / \`${hex(r.rView.txidInternal)}\``],
		[`\`n_S^act\` / \`txid(C^S)\` internal byte order`, `${N_S_ACT} / \`${hex(r.sView.txidInternal)}\``],
		['`H_commit`', `\`${hex(r.hCommit)}\``]
	]);
	emitMsg('ff_activate', r.ffActivate, 'R', `(\`setup_hash = T_setup\`, \`book_hash = H_book\`, \`commit_hash = H_commit\`, \`epoch_start_height = ${EPOCH_START_HEIGHT}\`)`);
	kv([['`H_act`', `\`${hex(r.hAct)}\``]]);
	emitMsg('ff_activate_ack', r.ffActivateAck, 'S', '(`activation_hash = H_act`)');

	// -- claims --------------------------------------------------------------------
	w(`### ${id}.8 Force-close claim paths for voucher 1 (9.5.1)`);
	w();
	for (let i = 0; i < r.claims.length; i++) {
		const c = r.claims[i];
		w(`#### ${id}.8.${i + 1} ${c.title}`);
		w();
		for (const line of c.description) w(line);
		w();
		kv([
			['txid', `\`${c.txid}\``],
			['sighash type', c.sighashType],
			['sighash signed here', `\`${hex(c.sighash)}\``],
			['witness layout', c.witnessLayout],
			...c.extra.map(([k, v]): [string, string] => [k, `\`${v}\``])
		]);
		w('Unsigned:');
		w();
		code(c.txHexUnsigned);
		w('Witness stack (space-separated; `<>` is the empty element):');
		w();
		code(c.witness);
		w('Fully signed (serialized with witness):');
		w();
		code(c.txHexSigned);
	}

	if (r.refusedDust) {
		w(`### ${id}.9 The refused amount`);
		w();
		w(`A book carrying \`d_k = ${r.refusedDust.d}\` msat is refused at 9.5.1 step 2 with \`ff_abort\` (reason 2 or 3) and never reaches step 3: no HTLC is built and no commitment exists for it. The generator asserts both refusals:`);
		w();
		for (const reason of r.refusedDust.reasons) w(`- ${reason}`);
		w();
	}
}

function emitView(r: IScenarioResult, v: ICommitView, num: string): void {
	const ab = r.sc.abbreviated;
	const plural = r.K === 1 ? '' : 's';
	const holderRole = v.holder === 'R' ? `received HTLC${plural} (S-offered)` : `offered HTLC${plural}`;
	w(`#### ${num} \`${v.holder}\`'s view: commitment ${v.commitmentNumber}, ${r.K} ${holderRole}, signed by \`${v.signer}\``);
	w();
	kv([
		[`commitment number (${v.holder})`, `${v.commitmentNumber}`],
		[`\`per_commitment_point_${v.holder}[${v.commitmentNumber}]\``, `\`${hex(v.perCommitmentPoint)}\``],
		['obscured commitment number', `\`0x${v.obscured.toString(16).padStart(12, '0')}\``],
		[`commitment fee (paid by \`${r.sc.funder}\`)`, `${v.commitFeeSat} sat + ${ANCHOR_TOTAL_SAT} sat anchors`],
		['txid', `\`${v.txid}\``],
		['txid (internal byte order, as hashed into `H_commit`)', `\`${hex(v.txidInternal)}\``],
		['SHA256(tx bytes)', `\`${hex(v.wireSha256)}\``],
		['revocation pubkey', `\`${hex(v.keys.revocationPubkey)}\``],
		[`${v.holder} delayed pubkey (\`to_local\`)`, `\`${hex(v.keys.localDelayedPubkey)}\``],
		[`${v.holder} HTLC pubkey`, `\`${hex(v.keys.localHtlcPubkey)}\``],
		[`${v.signer} HTLC pubkey`, `\`${hex(v.keys.remoteHtlcPubkey)}\``],
		[`\`to_remote\` key (static, = ${v.signer} payment basepoint)`, `\`${hex(v.keys.remotePaymentPubkey)}\``]
	]);
	w('Outputs (BOLT 3 order):');
	w();
	w('| # | Output | Amount (sat) | scriptPubKey |');
	w('|---|---|---|---|');
	const firstLast = new Set([r.vouchers[0].k, r.vouchers[r.K - 1].k]);
	let elided = false;
	for (const row of v.outputRows) {
		const isVoucher = row.kind.startsWith('voucher_');
		if (ab && isVoucher) {
			const k = Number(row.kind.slice('voucher_'.length).split(' ')[0]);
			if (!firstLast.has(k)) {
				if (!elided) {
					w(`| ... | ${r.K - 2} further voucher outputs | ${r.sc.amounts[0] / 1000n} each | (ordered by scriptPubKey) |`);
					elided = true;
				}
				continue;
			}
		}
		w(`| ${row.index} | ${row.kind} | ${row.amountSat} | \`${row.spk}\` |`);
	}
	w();
	if (v.absentNote) {
		w(v.absentNote);
		w();
	}
	if (ab) {
		w(`Transaction hex omitted (${v.txHex.length / 2} bytes); it is reproduced by the generator and pinned by the txid and SHA256 above.`);
		w();
	} else {
		w('Transaction (unsigned funding input, as signed by both parties):');
		w();
		code(v.txHex);
	}
	w(`\`${v.signer}\` commitment signature (\`commitment_signed.signature\`):`);
	w();
	w(`- compact: \`${hex(v.commitSig)}\``);
	w(`- DER + \`SIGHASH_ALL\`: \`${hex(toDerWithSighash(v.commitSig, 0x01))}\``);
	w();
	w(`\`${v.signer}\` HTLC signatures (\`commitment_signed.htlc_signature\`, ${v.vouchers.length} sig${v.vouchers.length > 1 ? 's' : ''} in BOLT 3 output order, \`SIGHASH_SINGLE|ANYONECANPAY\` over each voucher's ${v.vouchers[0].secondLevelKind} transaction, anchor rules: zero fee, input \`nSequence = 1\`${v.holder === 'S' ? `, \`nLockTime = T_exp\`` : ''}):`);
	w();
	const shownV = ab ? v.vouchers.filter((x) => firstLast.has(x.k)).sort((a, b) => a.k - b.k) : v.vouchers;
	for (const vc of shownV) {
		w(`**htlc_signature for voucher ${vc.k} (output ${vc.outputIndex}, ${vc.amountSat} sat, position ${v.vouchers.indexOf(vc)} in the list)**`);
		w();
		kv([
			[`HTLC witness script (${v.holder === 'R' ? 'received' : 'offered'} HTLC${v.holder === 'R' ? `, \`cltv_expiry\` ${T_EXP}` : ''})`, `\`${hex(vc.witnessScript)}\``],
			[`${vc.secondLevelKind} tx (unsigned)`, `\`${vc.secondLevelTxHex}\``],
			[`${vc.secondLevelKind} txid`, `\`${vc.secondLevelTxid}\``],
			['sighash (`SINGLE|ANYONECANPAY` = `0x83`)', `\`${hex(vc.sighash)}\``],
			[`\`${v.signer}\` sig (compact)`, `\`${hex(vc.counterpartySig)}\``],
			[`\`${v.signer}\` sig (DER + \`0x83\`)`, `\`${hex(toDerWithSighash(vc.counterpartySig, 0x83))}\``]
		]);
	}
}

// -- D.7 verification list -------------------------------------------------------
w('## D.7 Verification performed by the generator');
w();
w('Every line below is a hard assertion in the generator: it refuses to emit');
w('this file if any fails. Scenario-tagged lines were checked in that scenario;');
w('untagged lines are cross-scenario or fixture checks.');
w();
assertions.forEach((a, i) => w(`${i + 1}. ${a}`));
w();
w('Independent means: verified with beignet\'s `verify(..., strict = true)` against');
w('a sighash computed here (`hashForWitnessV0`) rather than through the channel');
w('verifier. Every commitment and second-level transaction was additionally');
w('round-tripped through the transaction decoder.');
w();

// -- D.8 conventions and spec feedback ----------------------------------------------
w('## D.8 Conventions adopted and spec feedback');
w();
w('Byte-level conventions these vectors follow. Each was an implementer\'s choice');
w('in the first draft of v0.9 and is now normative text in the section named, so');
w('an implementation that matches these vectors matches the spec.');
w();
w('1. **7, signed messages.** `body` in the digest formula includes the');
w('   `[32: channel_id][32: epoch_id]` header: every byte after the 2-byte type.');
w('   The digest is signed directly (single SHA256, not BOLT 7\'s double hash), as');
w('   a 64-byte compact low-S ECDSA signature.');
w('2. **7, TLV stream extent.** No length prefix: the stream runs from the end of');
w('   the last fixed field to the final 64 bytes, BigSize type and length (BOLT 1),');
w('   and may be empty (`ff_activate`, `ff_activate_ack`).');
w('3. **9.5.1, voucher onion.** Associated data is `payment_hash = H_k`; the payload');
w('   carries exactly TLVs 2, 4 and 8. The ephemeral key is seeded here for');
w('   reproducibility; live implementations draw it fresh.');
w('4. **7.1, `r_per_commitment_points` in Variant D.** Count 0. The one point the');
w('   voucher round needs is the one `S` holds from `R`\'s last `revoke_and_ack`.');
w('5. **7.6, fee-spike buffer.** `fee(2 x feerate, K) + 660 sat`: the anchors are');
w('   a fixed 330 sat each and do not scale with the feerate.');
w('6. **7.5.2, `H_commit`.** Txids in internal byte order, the reverse of the');
w('   display order most tools print; both are given for every commitment.');
w('7. **Appendix A.** `D = 798,992 = T_exp - 1008` in both appendices; `D` enters');
w('   no commitment, so Appendix A\'s transactions are unchanged.');
w();
w('## D.9 How to regenerate');
w();
w('```sh');
w('cd <beignet repo>   # sibling of the specs repo, master branch');
w('npx ts-node -P ../specs/tools/tsconfig.json \\');
w('  ../specs/tools/generate-ffor-variant-d-vectors.ts > ../specs/ffor-variant-d-vectors.md');
w('```');
w();
w('The generator ([tools/generate-ffor-variant-d-vectors.ts](tools/generate-ffor-variant-d-vectors.ts))');
w('imports beignet from source (`../beignet/src/lightning/...`) and writes this');
w('entire file to stdout. Output is deterministic: running it twice yields');
w('byte-identical results.');
w();
w('---');
w();
w('*Generated by `tools/generate-ffor-variant-d-vectors.ts` against beignet master');
w('using its real BOLT 3 commitment builder and signer, BOLT 4 onion code and');
w('on-chain claim builders.*');

process.stdout.write(out.join('\n') + '\n');
