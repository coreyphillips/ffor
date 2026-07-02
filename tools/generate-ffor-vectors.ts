/**
 * FFOR Appendix A test-vector generator.
 *
 * Generates the canonical, byte-accurate test vectors for the FFOR spec's
 * deterministic voucher commitment construction C_i^R (ffor-offline-receive.md
 * §8), using the beignet Lightning library's real BOLT 3 commitment builder
 * and signer. The output (stdout) is the complete Markdown appendix; it is
 * byte-for-byte deterministic (RFC 6979 signatures, fixed seeds, no clocks).
 *
 * HOW TO RUN (module resolution + deps come from the beignet repo; the
 * tsconfig next to this file extends beignet's):
 *
 *   cd /path/to/beignet
 *   npx ts-node -P ../specs/tools/tsconfig.json \
 *     ../specs/tools/generate-ffor-vectors.ts > ../specs/ffor-test-vectors.md
 *
 * The script imports beignet FROM SOURCE via relative paths and modifies
 * nothing inside the beignet repo.
 *
 * Roles: S (settlement peer / LSP) is the channel OPENER and funder;
 * R (recipient) is the ACCEPTOR and the holder of C_i^R. C_i^R is therefore
 * built with beignet's buildRemoteCommitment/signRemoteCommitment from S's
 * state, and independently re-built + verified from R's mirror state with
 * buildLocalCommitment/verifyRemoteCommitmentSig/verifyRemoteHtlcSignatures.
 */

import crypto from 'crypto';
import {
	buildLocalCommitment,
	buildRemoteCommitment,
	signRemoteCommitment,
	verifyRemoteCommitmentSig,
	verifyRemoteHtlcSignatures,
	deriveCommitmentKeys,
	calculateCommitmentFee,
	HTLC_SUCCESS_WEIGHT_ANCHORS
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
import {
	IChannelBasepoints,
	perCommitmentPointFromSecret
} from '../../beignet/src/lightning/keys/derivation';
import { ChannelSigner } from '../../beignet/src/lightning/keys/signer';
import { getPublicKey, verify } from '../../beignet/src/lightning/crypto/ecdh';
import {
	generateFromSeed,
	MAX_INDEX
} from '../../beignet/src/lightning/keys/shachain';
import { createFundingScript } from '../../beignet/src/lightning/script/funding';
import {
	buildHtlcSuccessTx,
	buildReceivedHtlcScript
} from '../../beignet/src/lightning/script/htlc';
import { calculateObscuredCommitmentNumber } from '../../beignet/src/lightning/script/commitment';
import {
	FeatureFlags,
	Feature
} from '../../beignet/src/lightning/features/flags';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sha256(b: Buffer): Buffer {
	return crypto.createHash('sha256').update(b).digest();
}
function hex(b: Buffer): string {
	return b.toString('hex');
}
function h2b(s: string): Buffer {
	return Buffer.from(s, 'hex');
}
function assert(cond: boolean, msg: string): void {
	if (!cond) {
		throw new Error(`ASSERTION FAILED: ${msg}`);
	}
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

// ─────────────────────────────────────────────────────────────────────────────
// Fixture material
//
// Where BOLT 3 Appendix C provides material, we reuse it verbatim so readers
// can cross-reference. Mapping: R (holder of C_i^R) = Appendix C "local" node;
// S (builder/signer of C_i^R) = Appendix C "remote" node.
// Material Appendix C does not provide is derived from fixed, documented
// SHA256 tag strings.
// ─────────────────────────────────────────────────────────────────────────────

// BOLT 3 Appendix C constants (trailing "01" compression markers stripped)
const R_FUNDING_PRIV = h2b(
	'30ff4956bbdd3222d44cc5e8a1261dab1e07957bdac5ae88fe3261ef321f3749'
); // local_funding_privkey
const S_FUNDING_PRIV = h2b(
	'1552dfba4f6cf29a62a0af13c8d6981d36d0ef8d61ba10fb0fe90da7634d7e13'
); // remote_funding_privkey
const R_PAYMENT_BASEPOINT_SECRET = h2b(
	'1111111111111111111111111111111111111111111111111111111111111111'
); // local_payment_basepoint_secret (Appendix C: local htlc basepoint = local payment basepoint)
const S_REVOCATION_BASEPOINT_SECRET = h2b(
	'2222222222222222222222222222222222222222222222222222222222222222'
); // remote_revocation_basepoint_secret
const R_DELAYED_BASEPOINT_SECRET = h2b(
	'3333333333333333333333333333333333333333333333333333333333333333'
); // local_delayed_payment_basepoint_secret
const S_PAYMENT_BASEPOINT_SECRET = h2b(
	'4444444444444444444444444444444444444444444444444444444444444444'
); // remote_payment_basepoint_secret (Appendix C: remote htlc basepoint = remote payment basepoint)

// Appendix C expected public keys (asserted below)
const EXPECTED_R_FUNDING_PUB =
	'023da092f6980e58d2c037173180e9a465476026ee50f96695963e8efe436f54eb';
const EXPECTED_S_FUNDING_PUB =
	'030e9f7b623d2ccc7c9bd44d66d5ce21ce504c0acf6385a132cec6d3c39fa711c1';
const EXPECTED_R_PAYMENT_BASEPOINT =
	'034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa';
const EXPECTED_S_PAYMENT_BASEPOINT =
	'032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991';
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
	sPerCommitmentSeed: 'ffor/S/per-commitment-seed'
};
const R_REVOCATION_BASEPOINT_SECRET = sha256(
	Buffer.from(FFOR_TAGS.rRevocationBasepointSecret)
);
const S_DELAYED_BASEPOINT_SECRET = sha256(
	Buffer.from(FFOR_TAGS.sDelayedBasepointSecret)
);
const R_PC_SEED = sha256(Buffer.from(FFOR_TAGS.rPerCommitmentSeed));
const S_PC_SEED = sha256(Buffer.from(FFOR_TAGS.sPerCommitmentSeed));

// ─────────────────────────────────────────────────────────────────────────────
// Epoch parameters (FFOR §7)
// ─────────────────────────────────────────────────────────────────────────────

const FEERATE_PER_KW = 2500; // frozen for the epoch
const DUST_LIMIT_SAT = 546n; // both sides
const TO_SELF_DELAY = 144; // both sides
const N_R = 42n; // R's commitment number at quiescence (C_0 = commitment 42)
const N0 = 42n; // S's commitment number at quiescence (H_1 binding)
const T_EXP = 800_000; // voucher_expiry (uniform cltv_expiry)
const D_DEADLINE = 799_000; // settlement_deadline (documentation only)
const FEE_BASE_MSAT = 1000n;
const FEE_PROP_MILLIONTHS = 5000n;
const BUDGET_MSAT = 100_000_000n;
const K_MAX_PAYMENTS = 8;
const MIN_PAYMENT_MSAT = 10_000n;

// Pre-epoch balances (mirrors Appendix C's 7M/3M split):
// S (opener/funder) holds 7,000,000 sat; R holds 3,000,000 sat.
const S_BALANCE_MSAT_PRE = 7_000_000_000n;
const R_BALANCE_MSAT_PRE = 3_000_000_000n;

// Delegated payments. Payment 2 was specified as 250,000 msat, but
// v = 0.995a - 1000 gives 247,750 msat < the 546,000 msat voucher dust floor
// (dust_limit 546 sat; zero-fee second-level HTLC txs under option_anchors),
// so it is bumped to the smallest round value that does not trim: 550,000 msat
// (v_2 = 546,250 msat -> 546 sat output, exactly at the floor).
const HTLC_AMOUNTS_MSAT = [1_000_000n, 550_000n, 50_000_000n];

function skimFee(a: bigint): bigint {
	return FEE_BASE_MSAT + (a * FEE_PROP_MILLIONTHS) / 1_000_000n;
}

// ─────────────────────────────────────────────────────────────────────────────
// Key derivation + fixture assertions
// ─────────────────────────────────────────────────────────────────────────────

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

assert(
	hex(rBasepoints.fundingPubkey) === EXPECTED_R_FUNDING_PUB,
	'R funding pubkey matches BOLT 3 Appendix C local_funding_pubkey'
);
assert(
	hex(sBasepoints.fundingPubkey) === EXPECTED_S_FUNDING_PUB,
	'S funding pubkey matches BOLT 3 Appendix C remote_funding_pubkey'
);
assert(
	hex(rBasepoints.paymentBasepoint) === EXPECTED_R_PAYMENT_BASEPOINT,
	'R payment basepoint matches Appendix C local_payment_basepoint'
);
assert(
	hex(sBasepoints.paymentBasepoint) === EXPECTED_S_PAYMENT_BASEPOINT,
	'S payment basepoint matches Appendix C remote_payment_basepoint'
);
const fundingScript = createFundingScript(
	rBasepoints.fundingPubkey,
	sBasepoints.fundingPubkey
);
assert(
	hex(fundingScript.witnessScript) === EXPECTED_FUNDING_WSCRIPT,
	'funding witness script matches Appendix C funding_wscript'
);

// channel_type: option_static_remotekey (12) + option_anchors_zero_fee_htlc_tx (22)
const channelTypeFlags = FeatureFlags.empty();
channelTypeFlags.setCompulsory(Feature.STATIC_REMOTE_KEY);
channelTypeFlags.setCompulsory(Feature.ANCHOR_ZERO_FEE_HTLC);
const CHANNEL_TYPE = channelTypeFlags.toBuffer();

const CONFIG: IChannelConfig = {
	dustLimitSatoshis: DUST_LIMIT_SAT,
	maxHtlcValueInFlightMsat: 5_000_000_000n,
	channelReserveSatoshis: 10_000n,
	htlcMinimumMsat: 1n,
	toSelfDelay: TO_SELF_DELAY,
	maxAcceptedHtlcs: 483,
	feeratePerKw: FEERATE_PER_KW
};

// ─────────────────────────────────────────────────────────────────────────────
// Vouchers: amounts, preimages, hashes
// ─────────────────────────────────────────────────────────────────────────────

interface IVoucher {
	seq: number; // 1-based
	htlcAmountMsat: bigint;
	feeMsat: bigint;
	vMsat: bigint;
	preimage: Buffer;
	paymentHash: Buffer;
}

// FFOR §7.2 (Variant A): H_1 MUST equal SHA256(per_commitment_secret_S[n0]).
const P1 = pcSecret(S_PC_SEED, N0);
const S_PC_POINT_N0 = perCommitmentPointFromSecret(P1);
// Other preimages follow the Appendix C style (repeated bytes).
const PREIMAGES = [P1, Buffer.alloc(32, 0x02), Buffer.alloc(32, 0x03)];

const vouchers: IVoucher[] = HTLC_AMOUNTS_MSAT.map((a, idx) => {
	const feeMsat = skimFee(a);
	const vMsat = a - feeMsat;
	return {
		seq: idx + 1,
		htlcAmountMsat: a,
		feeMsat,
		vMsat,
		preimage: PREIMAGES[idx],
		paymentHash: sha256(PREIMAGES[idx])
	};
});

// §8 constraints S MUST enforce (the voucher dust floor is dust_limit + the
// second-level HTLC-success fee at the frozen feerate, which is ZERO for
// option_anchors_zero_fee_htlc_tx channels).
let cumulative = 0n;
for (const v of vouchers) {
	assert(
		v.htlcAmountMsat >= MIN_PAYMENT_MSAT,
		`payment ${v.seq}: htlc_amount >= min_payment_msat`
	);
	assert(
		v.vMsat / 1000n >= DUST_LIMIT_SAT,
		`payment ${v.seq}: v_${v.seq} (${v.vMsat} msat) clears the voucher dust floor (${DUST_LIMIT_SAT} sat)`
	);
	cumulative += v.vMsat;
	assert(cumulative <= BUDGET_MSAT, `payment ${v.seq}: cumulative <= budget`);
}
assert(vouchers.length <= K_MAX_PAYMENTS, 'i <= K');
assert(
	sha256(P1).equals(vouchers[0].paymentHash),
	'H_1 = SHA256(per_commitment_secret_S[n0])'
);
assert(
	getPublicKey(P1).equals(S_PC_POINT_N0),
	'P_1 * G = per_commitment_point_S[n0]'
);

// ─────────────────────────────────────────────────────────────────────────────
// Channel states. S = OPENER (funder), R = ACCEPTOR.
// C_i^R is S's *remote* commitment / R's *local* commitment.
// ─────────────────────────────────────────────────────────────────────────────

function makeSState(): IChannelState {
	const st = createOpenerState({
		temporaryChannelId: Buffer.alloc(32),
		fundingSatoshis: FUNDING_SAT,
		pushMsat: R_BALANCE_MSAT_PRE,
		localConfig: { ...CONFIG },
		localBasepoints: sBasepoints,
		localPerCommitmentSeed: S_PC_SEED
	});
	st.remoteBasepoints = rBasepoints;
	st.remoteConfig = { ...CONFIG };
	st.fundingTxid = h2b(FUNDING_TXID_INTERNAL);
	st.fundingOutputIndex = FUNDING_OUTPUT_INDEX;
	st.channelType = CHANNEL_TYPE;
	st.state = ChannelState.NORMAL;
	st.localCommitmentNumber = N0;
	st.remoteCommitmentNumber = N_R;
	return st;
}

function makeRState(): IChannelState {
	const st = createAcceptorState({
		temporaryChannelId: Buffer.alloc(32),
		fundingSatoshis: FUNDING_SAT,
		pushMsat: R_BALANCE_MSAT_PRE,
		localConfig: { ...CONFIG },
		localBasepoints: rBasepoints,
		localPerCommitmentSeed: R_PC_SEED,
		remoteBasepoints: sBasepoints,
		remoteConfig: { ...CONFIG }
	});
	st.fundingTxid = h2b(FUNDING_TXID_INTERNAL);
	st.fundingOutputIndex = FUNDING_OUTPUT_INDEX;
	st.channelType = CHANNEL_TYPE;
	st.state = ChannelState.NORMAL;
	st.remoteCommitmentNumber = N0;
	return st;
}

const sState = makeSState(); // localBalance = 7,000,000,000 msat (funder), remote = 3,000,000,000
const rState = makeRState(); // localBalance = 3,000,000,000 msat, remote = 7,000,000,000
const sSigner = new ChannelSigner(S_FUNDING_PRIV, S_PAYMENT_BASEPOINT_SECRET);
const rSigner = new ChannelSigner(R_FUNDING_PRIV, R_PAYMENT_BASEPOINT_SECRET);

// ─────────────────────────────────────────────────────────────────────────────
// Build C_0..C_3
// ─────────────────────────────────────────────────────────────────────────────

interface IVoucherOnCommit {
	seq: number;
	outputIndex: number;
	amountSat: bigint;
	witnessScript: Buffer;
	htlcSuccessTxHex: string;
	htlcSuccessTxid: string;
	sighashSingleAcp: Buffer;
	sSig: Buffer; // 64-byte compact
}

interface ICommitVector {
	i: number;
	commitmentNumber: bigint;
	rPerCommitmentPoint: Buffer;
	obscured: bigint;
	txHex: string;
	txid: string;
	commitFeeSat: bigint;
	toLocalSat: bigint;
	toRemoteSat: bigint;
	outputRows: { index: number; kind: string; amountSat: number; spk: string }[];
	sCommitSig: Buffer; // 64-byte compact
	vouchersOnCommit: IVoucherOnCommit[];
	keys: {
		revocationPubkey: Buffer;
		rDelayedPubkey: Buffer;
		rHtlcPubkey: Buffer;
		sHtlcPubkey: Buffer;
		toRemotePubkey: Buffer;
	};
}

const commits: ICommitVector[] = [];

for (let i = 0; i <= 3; i++) {
	if (i >= 1) {
		const v = vouchers[i - 1];
		// Voucher k = received HTLC from R's perspective, i.e. OFFERED by S.
		const key = `offered-${v.seq}`;
		const entryBase = {
			id: BigInt(v.seq - 1),
			amountMsat: v.vMsat,
			paymentHash: v.paymentHash,
			cltvExpiry: T_EXP,
			onionRoutingPacket: Buffer.alloc(0),
			state: HtlcState.COMMITTED
		};
		sState.htlcs.set(key, { ...entryBase, direction: HtlcDirection.OFFERED });
		rState.htlcs.set(key, { ...entryBase, direction: HtlcDirection.RECEIVED });
		sState.localBalanceMsat -= v.vMsat;
		rState.remoteBalanceMsat -= v.vMsat;
	}

	const n = N_R + BigInt(i);
	const rPoint = pcPoint(R_PC_SEED, n);

	// S builds + signs C_i^R alone (FFOR §8, §9.1).
	const built = buildRemoteCommitment(sState, rPoint, n);
	const { signature, htlcSignatures } = signRemoteCommitment(
		sState,
		sSigner,
		rPoint,
		n
	);

	const tx = built.result.tx;
	const txHex = tx.toHex();
	const txid = tx.getId();

	// ── Verification 1: R reconstructs the identical bytes from its own state ──
	rState.localCommitmentNumber = n - 1n; // verify* helpers use localCommitmentNumber + 1
	const rebuilt = buildLocalCommitment(rState, rPoint, n);
	assert(
		rebuilt.result.tx.toHex() === txHex,
		`C_${i}: R-side rebuild is byte-identical`
	);

	// ── Verification 2: beignet's own verify functions accept S's signatures ──
	assert(
		verifyRemoteCommitmentSig(rState, rSigner, rPoint, signature, n),
		`C_${i}: S commitment signature verifies (beignet verifyRemoteCommitmentSig)`
	);
	assert(
		verifyRemoteHtlcSignatures(rState, rSigner, rPoint, htlcSignatures),
		`C_${i}: S htlc signatures verify (beignet verifyRemoteHtlcSignatures)`
	);

	// ── Verification 3: independent low-S ECDSA check of the commitment sig ──
	const commitSighash = tx.hashForWitnessV0(
		0,
		built.fundingWitnessScript,
		built.fundingAmount,
		0x01 // SIGHASH_ALL
	);
	assert(
		verify(commitSighash, sBasepoints.fundingPubkey, signature, true),
		`C_${i}: S commitment signature verifies (independent, strict low-S)`
	);

	// ── Verification 4: round-trip decode of the serialized tx ──
	const TxCtor = tx.constructor as unknown as {
		fromHex: (h: string) => typeof tx;
	};
	assert(
		TxCtor.fromHex(txHex).getId() === txid,
		`C_${i}: tx hex round-trips through the decoder`
	);

	// Per-commitment keys as they appear on C_i^R ("local" = R, the holder).
	const keys = deriveCommitmentKeys(sBasepoints, rBasepoints, rPoint, false);
	assert(
		keys.remotePaymentPubkey.equals(sBasepoints.paymentBasepoint),
		`C_${i}: static_remotekey — to_remote key is S's payment basepoint`
	);

	// Reconstruct each voucher's HTLC-success transaction exactly as
	// signRemoteCommitment did, to document the tx S's htlc_sigs sign.
	const { htlcs, htlcOriginalIndices } = built.result.outputMap;
	assert(
		htlcs.length === i && htlcSignatures.length === i,
		`C_${i}: ${i} voucher outputs and ${i} htlc_sigs`
	);
	const htlcSuccessFee = BigInt(
		Math.floor((HTLC_SUCCESS_WEIGHT_ANCHORS * FEERATE_PER_KW) / 1000)
	); // computed per beignet's code path, then ignored (zero-fee HTLC txs)
	const vouchersOnCommit: IVoucherOnCommit[] = [];
	for (let k = 0; k < htlcs.length; k++) {
		const outputIndex = htlcs[k];
		const seq = htlcOriginalIndices[k] + 1; // insertion order = voucher seq
		const v = vouchers[seq - 1];
		const amountSat = v.vMsat / 1000n;
		assert(
			BigInt(tx.outs[outputIndex].value) === amountSat,
			`C_${i} voucher ${seq}: output value = floor(v_${seq} / 1000)`
		);
		const witnessScript = buildReceivedHtlcScript(
			keys.revocationPubkey,
			keys.localHtlcPubkey,
			keys.remoteHtlcPubkey,
			v.paymentHash,
			T_EXP,
			true
		);
		const successTx = buildHtlcSuccessTx(
			txid,
			outputIndex,
			amountSat,
			keys.revocationPubkey,
			keys.localDelayedPubkey,
			TO_SELF_DELAY,
			htlcSuccessFee,
			true // option_anchors: zero fee, nSequence = 1
		);
		const sighash = successTx.hashForWitnessV0(
			0,
			witnessScript,
			Number(amountSat),
			0x83 // SIGHASH_SINGLE | SIGHASH_ANYONECANPAY
		);
		assert(
			verify(sighash, keys.remoteHtlcPubkey, htlcSignatures[k], true),
			`C_${i} voucher ${seq}: S htlc sig verifies (independent, strict low-S)`
		);
		vouchersOnCommit.push({
			seq,
			outputIndex,
			amountSat,
			witnessScript,
			htlcSuccessTxHex: successTx.toHex(),
			htlcSuccessTxid: successTx.getId(),
			sighashSingleAcp: sighash,
			sSig: htlcSignatures[k]
		});
	}

	// Output map rows
	const om = built.result.outputMap;
	const outputRows = tx.outs.map((o, idx) => {
		let kind = '';
		if (idx === om.toLocal) kind = 'to_local (R)';
		else if (idx === om.toRemote) kind = 'to_remote (S)';
		else if (idx === om.anchorLocal) kind = 'anchor (R)';
		else if (idx === om.anchorRemote) kind = 'anchor (S)';
		else {
			const pos = om.htlcs.indexOf(idx);
			kind = `voucher_${om.htlcOriginalIndices[pos] + 1} (received HTLC)`;
		}
		return { index: idx, kind, amountSat: o.value, spk: hex(o.script) };
	});

	const commitFeeSat = calculateCommitmentFee(FEERATE_PER_KW, i, true, false);
	commits.push({
		i,
		commitmentNumber: n,
		rPerCommitmentPoint: rPoint,
		obscured: calculateObscuredCommitmentNumber(
			sBasepoints.paymentBasepoint, // opener = S
			rBasepoints.paymentBasepoint, // acceptor = R
			n
		),
		txHex,
		txid,
		commitFeeSat,
		toLocalSat: BigInt(tx.outs[om.toLocal!].value),
		toRemoteSat: BigInt(tx.outs[om.toRemote!].value),
		outputRows,
		sCommitSig: signature,
		vouchersOnCommit,
		keys: {
			revocationPubkey: keys.revocationPubkey,
			rDelayedPubkey: keys.localDelayedPubkey,
			rHtlcPubkey: keys.localHtlcPubkey,
			sHtlcPubkey: keys.remoteHtlcPubkey,
			toRemotePubkey: keys.remotePaymentPubkey
		}
	});
}

// Balance sanity: after all three settlements S still covers reserve.
assert(
	sState.localBalanceMsat / 1000n >= CONFIG.channelReserveSatoshis,
	'S post-settlement balance >= channel_reserve'
);

// ─────────────────────────────────────────────────────────────────────────────
// Emit the Markdown appendix
// ─────────────────────────────────────────────────────────────────────────────

const out: string[] = [];
const w = (s = ''): number => out.push(s);

w('# FFOR Appendix A: canonical `C_i^R` test vectors');
w();
w('Byte-accurate test vectors for the deterministic voucher commitment');
w('construction of [FFOR §8](ffor-offline-receive.md) (`C_i^R`), computed with');
w("the beignet Lightning library's BOLT 3 commitment builder and signer —");
w('every transaction and signature below was built, signed, and verified by');
w('running code, not written by hand. All hex is lowercase; all signatures are');
w('deterministic (RFC 6979), so this file regenerates byte-identically.');
w();
w('The scenario: a quiescent channel between `S` (settlement peer, channel');
w('opener and funder) and `R` (recipient, holder of `C_i^R`), followed by three');
w('delegated settlements. `C_0` is the pre-epoch base state (no vouchers);');
w('`C_1..C_3` each add one voucher HTLC per FFOR §8/§9.');
w();
w('## A.1 Input parameters');
w();
w('### Channel');
w();
w('| Parameter | Value |');
w('|---|---|');
w('| channel type | `option_static_remotekey` + `option_anchors_zero_fee_htlc_tx` |');
w(`| \`channel_type\` bits (hex) | \`${hex(CHANNEL_TYPE)}\` (bits 12, 22) |`);
w(`| funding outpoint | \`${FUNDING_TXID_DISPLAY}:${FUNDING_OUTPUT_INDEX}\` (BOLT 3 Appendix C) |`);
w(`| funding txid (internal byte order) | \`${FUNDING_TXID_INTERNAL}\` |`);
w(`| funding amount | ${FUNDING_SAT} sat |`);
w('| funder / opener | `S` |');
w(`| pre-epoch balance \`S\` | ${S_BALANCE_MSAT_PRE} msat |`);
w(`| pre-epoch balance \`R\` | ${R_BALANCE_MSAT_PRE} msat |`);
w(`| \`dust_limit_satoshis\` (both sides) | ${DUST_LIMIT_SAT} |`);
w(`| \`to_self_delay\` (both sides) | ${TO_SELF_DELAY} |`);
w(`| frozen \`feerate_per_kw\` | ${FEERATE_PER_KW} |`);
w(`| \`channel_reserve_satoshis\` | ${CONFIG.channelReserveSatoshis} |`);
w();
w('### Epoch (FFOR §7)');
w();
w('| Parameter | Value |');
w('|---|---|');
w(`| \`n_R\` | ${N_R} (so \`C_i^R\` is R's commitment number ${N_R} + i) |`);
w(`| \`n0\` | ${N0} |`);
w(`| \`T_exp\` (\`voucher_expiry\`, uniform \`cltv_expiry\`) | ${T_EXP} |`);
w(`| \`D\` (\`settlement_deadline\`) | ${D_DEADLINE} |`);
w(`| \`fee_base_msat\` | ${FEE_BASE_MSAT} |`);
w(`| \`fee_proportional_millionths\` | ${FEE_PROP_MILLIONTHS} |`);
w(`| \`budget_msat\` | ${BUDGET_MSAT} |`);
w(`| \`K\` (\`max_payments\`) | ${K_MAX_PAYMENTS} |`);
w(`| \`min_payment_msat\` | ${MIN_PAYMENT_MSAT} |`);
w(`| \`G\` (\`escape_granularity_msat\`) | 0 (no escape set) |`);
w();
w('### Secrets and seeds');
w();
w('Where BOLT 3 Appendix C provides material it is reused verbatim so readers');
w('can cross-reference (mapping: `R` = Appendix C *local* node, `S` = Appendix C');
w('*remote* node; per Appendix C, each side\'s HTLC basepoint equals its payment');
w('basepoint). Material Appendix C does not provide is `SHA256(tag)` of the');
w('documented ASCII tag.');
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
w();
w('Per-commitment secrets use the BOLT 3 shachain: the secret for commitment');
w('number `n` is `generate_from_seed(seed, 2^48 - 1 - n)`; the point is');
w('`secret * G`.');
w();
w('### Basepoints (derived)');
w();
w('| Key | Value |');
w('|---|---|');
w(`| \`R\` funding pubkey | \`${hex(rBasepoints.fundingPubkey)}\` |`);
w(`| \`S\` funding pubkey | \`${hex(sBasepoints.fundingPubkey)}\` |`);
w(`| \`R\` payment (= HTLC) basepoint | \`${hex(rBasepoints.paymentBasepoint)}\` |`);
w(`| \`R\` delayed-payment basepoint | \`${hex(rBasepoints.delayedPaymentBasepoint)}\` |`);
w(`| \`R\` revocation basepoint | \`${hex(rBasepoints.revocationBasepoint)}\` |`);
w(`| \`S\` payment (= HTLC) basepoint | \`${hex(sBasepoints.paymentBasepoint)}\` |`);
w(`| \`S\` delayed-payment basepoint | \`${hex(sBasepoints.delayedPaymentBasepoint)}\` |`);
w(`| \`S\` revocation basepoint | \`${hex(sBasepoints.revocationBasepoint)}\` |`);
w(`| funding witness script | \`${hex(fundingScript.witnessScript)}\` |`);
w();
w('### `r_per_commitment_points` (ff_init, commitment numbers 43..50)');
w();
w("`R`'s pre-shared points for `n_R + 1 .. n_R + K`. `C_0` additionally uses");
w(`R's point for commitment number ${N_R} (the pre-epoch state).`);
w();
w('| n | per_commitment_point_R[n] |');
w('|---|---|');
for (let n = N_R; n <= N_R + BigInt(K_MAX_PAYMENTS); n++) {
	const marker = n === N_R ? ' (pre-epoch, used by C_0)' : '';
	w(`| ${n}${marker} | \`${hex(pcPoint(R_PC_SEED, n))}\` |`);
}
w();
w('### `S` per-commitment material at `n0` (H_1 binding, FFOR §7.2/§12.1)');
w();
w('| Item | Value |');
w('|---|---|');
w(`| \`per_commitment_secret_S[${N0}]\` (= \`P_1\`) | \`${hex(P1)}\` |`);
w(`| \`per_commitment_point_S[${N0}]\` | \`${hex(S_PC_POINT_N0)}\` |`);
w(`| \`H_1 = SHA256(P_1)\` | \`${hex(vouchers[0].paymentHash)}\` |`);
w();
w('## A.2 Delegated payments and voucher values');
w();
w('`fee(a) = fee_base_msat + a * fee_proportional_millionths / 10^6`;');
w('`v_k = htlc_amount_k - fee(htlc_amount_k)`. All voucher HTLCs use');
w(`\`cltv_expiry = T_exp = ${T_EXP}\`.`);
w();
w('> Note: payment 2 was originally scripted as 250,000 msat, but that yields');
w('> `v_2 = 247,750 msat` — below the voucher dust floor (`dust_limit` 546 sat;');
w('> the second-level HTLC fee term is zero under');
w('> `option_anchors_zero_fee_htlc_tx`), so a compliant `S` MUST reject it');
w('> (FFOR §8). It is bumped to the smallest round amount that does not trim:');
w('> 550,000 msat, giving `v_2 = 546,250 msat` → a 546 sat output, exactly at');
w('> the floor (the `>= dust_limit` boundary is intentionally exercised).');
w();
w('| k | htlc_amount_msat | fee(a) msat | v_k msat | v_k output (sat) | preimage P_k | payment_hash H_k |');
w('|---|---|---|---|---|---|---|');
for (const v of vouchers) {
	w(
		`| ${v.seq} | ${v.htlcAmountMsat} | ${v.feeMsat} | ${v.vMsat} | ${v.vMsat / 1000n} | \`${hex(v.preimage)}\` | \`${hex(v.paymentHash)}\` |`
	);
}
w();
w(`Cumulative voucher value: ${cumulative} msat <= budget ${BUDGET_MSAT} msat.`);
w();
w('`P_1` is `per_commitment_secret_S[n0]` per the Variant-A `H_1` binding;');
w('`P_2`/`P_3` are the documented constants above (Appendix C style).');
w();
w('Sub-satoshi remainders (BOLT 3): `v_2` carries a 250 msat remainder. The');
w('voucher output is floored to 546 sat and the 250 msat stays with the party');
w("that offered the HTLC — `S` — i.e. it is accounted in `S`'s `to_remote`");
w('balance on `C_2`/`C_3`, not dropped to fees.');
w();

w('## A.3 Commitment transactions `C_0..C_3`');
w();
w('Each `C_i^R` is built at commitment number `n_R + i` with');
w("`r_per_commitment_points[n_R + i]`, `S`'s balance reduced by `Σ_{k<=i} v_k`,");
w('and the funder (`S`) paying the BOLT 3 commitment fee');
w('(`(1124 + 172·i) · 2500 / 1000` weight units at the frozen feerate) plus the');
w('two 330 sat anchors. Signature forms: `compact` is the 64-byte form carried');
w('in `ff_settlement.commitment_sig` / `htlc_sigs` (and BOLT 2 wire messages);');
w('`DER` is the same signature DER-encoded with the sighash byte appended, as');
w('it appears in the final witness stack.');
w();

for (const c of commits) {
	w(`### A.3.${c.i} \`C_${c.i}\` — commitment number ${c.commitmentNumber}${c.i === 0 ? ' (pre-epoch base state)' : `, vouchers 1..${c.i}`}`);
	w();
	w('| Field | Value |');
	w('|---|---|');
	w(`| commitment number (R) | ${c.commitmentNumber} |`);
	w(`| \`per_commitment_point_R[${c.commitmentNumber}]\` | \`${hex(c.rPerCommitmentPoint)}\` |`);
	w(`| obscured commitment number | \`0x${c.obscured.toString(16).padStart(12, '0')}\` |`);
	w(`| commitment fee (paid by S) | ${c.commitFeeSat} sat |`);
	w(`| txid | \`${c.txid}\` |`);
	w();
	w('Derived keys on this commitment (holder = `R`):');
	w();
	w('| Key | Value |');
	w('|---|---|');
	w(`| revocation pubkey | \`${hex(c.keys.revocationPubkey)}\` |`);
	w(`| R delayed pubkey (\`to_local\`) | \`${hex(c.keys.rDelayedPubkey)}\` |`);
	w(`| R HTLC pubkey | \`${hex(c.keys.rHtlcPubkey)}\` |`);
	w(`| S HTLC pubkey | \`${hex(c.keys.sHtlcPubkey)}\` |`);
	w(`| \`to_remote\` key (static, = S payment basepoint) | \`${hex(c.keys.toRemotePubkey)}\` |`);
	w();
	w('Outputs (BOLT 3 order):');
	w();
	w('| # | Output | Amount (sat) | scriptPubKey |');
	w('|---|---|---|---|');
	for (const r of c.outputRows) {
		w(`| ${r.index} | ${r.kind} | ${r.amountSat} | \`${r.spk}\` |`);
	}
	w();
	w('Transaction (unsigned funding input, as signed by both parties):');
	w();
	w('```');
	w(c.txHex);
	w('```');
	w();
	w(`\`S\` commitment signature (\`ff_settlement.commitment_sig\`${c.i === 0 ? ' — informational for C_0; settlement packages start at seq 1' : ''}):`);
	w();
	w(`- compact: \`${hex(c.sCommitSig)}\``);
	w(`- DER + \`SIGHASH_ALL\`: \`${hex(toDerWithSighash(c.sCommitSig, 0x01))}\``);
	w();
	if (c.vouchersOnCommit.length > 0) {
		w(`\`S\` HTLC signatures (\`ff_settlement.htlc_sigs\`, ${c.vouchersOnCommit.length} sig${c.vouchersOnCommit.length > 1 ? 's' : ''}, BOLT 3 output order,`);
		w('`SIGHASH_SINGLE|ANYONECANPAY` over the HTLC-success transaction, anchor');
		w('rules: zero fee, input `nSequence = 1`):');
		w();
		for (const vc of c.vouchersOnCommit) {
			w(`#### htlc_sig for voucher ${vc.seq} (output ${vc.outputIndex}, ${vc.amountSat} sat)`);
			w();
			w('| Field | Value |');
			w('|---|---|');
			w(`| HTLC witness script (received HTLC, \`cltv_expiry\` ${T_EXP}) | \`${hex(vc.witnessScript)}\` |`);
			w(`| HTLC-success tx (unsigned) | \`${vc.htlcSuccessTxHex}\` |`);
			w(`| HTLC-success txid | \`${vc.htlcSuccessTxid}\` |`);
			w(`| sighash (\`SINGLE\\|ANYONECANPAY\` = \`0x83\`) | \`${hex(vc.sighashSingleAcp)}\` |`);
			w(`| \`S\` sig (compact) | \`${hex(vc.sSig)}\` |`);
			w(`| \`S\` sig (DER + \`0x83\`) | \`${hex(toDerWithSighash(vc.sSig, 0x83))}\` |`);
			w();
		}
	}
}

w('## A.4 Verification performed by the generator');
w();
w('All of the following are hard assertions in the generator (it refuses to');
w('emit vectors if any fails):');
w();
w('1. Fixture keys re-derive the BOLT 3 Appendix C funding pubkeys, payment');
w('   basepoints, and funding witness script.');
w('2. For every `C_i`: `R`, holding only the epoch parameters and settlement');
w('   history, rebuilds the commitment from its own (mirror) channel state');
w("   byte-identically to `S`'s construction (beignet `buildLocalCommitment`");
w('   vs `buildRemoteCommitment`).');
w("3. `S`'s commitment signature verifies via beignet's");
w('   `verifyRemoteCommitmentSig` AND via an independent strict (low-S) ECDSA');
w("   check against the BIP 143 sighash of the funding input.");
w("4. `S`'s htlc_sigs verify via beignet's `verifyRemoteHtlcSignatures` AND");
w('   via independent strict ECDSA checks against the');
w('   `SIGHASH_SINGLE|ANYONECANPAY` sighash of each reconstructed HTLC-success');
w('   transaction.');
w('5. Every voucher clears the dust floor; cumulative value stays within');
w('   `budget_msat`; `i <= K`; `S` stays above `channel_reserve`.');
w('6. `H_1 = SHA256(per_commitment_secret_S[n0])` and');
w('   `P_1·G = per_commitment_point_S[n0]` (FFOR §7.2 Variant-A binding).');
w('7. Each commitment tx hex round-trips through the transaction decoder to');
w('   the same txid.');
w();
w('Additionally (out-of-band, not a generator assertion): the `C_0..C_3` hex');
w('and the HTLC-success transactions were decoded with Bitcoin Core 29.1');
w('`decoderawtransaction`, which reports the same txids, prevouts, values,');
w('sequences, and locktimes as listed above.');
w();
w('## A.5 How to regenerate');
w();
w('```sh');
w('cd <beignet repo>   # sibling of the specs repo, master branch');
w('npx ts-node -P ../specs/tools/tsconfig.json \\');
w('  ../specs/tools/generate-ffor-vectors.ts > ../specs/ffor-test-vectors.md');
w('```');
w();
w('The generator ([tools/generate-ffor-vectors.ts](tools/generate-ffor-vectors.ts))');
w('imports beignet from source (`../beignet/src/lightning/...`) and writes this');
w('entire file to stdout. Output is deterministic: running it twice yields');
w('byte-identical results.');
w();
w('## A.6 Deviations / spec feedback');
w();
w('1. **`commitment_sig` size (§9.1):** the `ff_settlement` field table says');
w('   64 bytes (compact), matching BOLT 2 wire signatures. These vectors give');
w('   both the 64-byte compact form and the DER+sighash form used in witnesses,');
w('   since delegated verification and fraud proofs need to re-encode anyway.');
w('   The spec could state explicitly that `commitment_sig`/`htlc_sigs` use the');
w('   BOLT 2 64-byte compact encoding.');
w('2. **Voucher dust floor with anchors (§8):** §8 defines the floor as');
w('   `dust_limit + HTLC-success fee at the frozen feerate`. Under');
w('   `option_anchors_zero_fee_htlc_tx` the second-level fee is zero, so the');
w('   floor is exactly `dust_limit`. The spec text is correct but worth an');
w('   explicit note; the scripted 250,000 msat payment 2 trims at these');
w('   parameters and was bumped to 550,000 msat (see A.2).');
w('3. **Sub-satoshi remainders (§8):** "`S`\'s `to_local` is reduced by `Σ v_k`"');
w('   is exact in msat, but on-chain the voucher output is floored to whole');
w('   satoshis and BOLT 3 keeps the truncated remainder with the *offerer*');
w("   (`S`) — visible here as `v_2`'s 250 msat staying in `S`'s balance");
w('   (`to_remote` on `C_2`/`C_3` is 1 sat higher than a naive floor-everything');
w('   calculation). Deterministic reconstruction must implement this rule; the');
w('   spec should reference it.');
w('4. **`htlc_sigs` ordering (§9.1):** "BOLT 3 output order" is *not* voucher');
w('   sequence order — on `C_2`/`C_3`, voucher 2 (546 sat) sorts before');
w('   voucher 1 (994 sat). The vectors exercise this; implementations must map');
w('   sigs by output index, not by `seq`.');
w('5. **beignet fidelity:** no deviations were required — beignet\'s builder');
w('   expresses the full construction (anchors + static_remotekey, frozen');
w('   feerate, far-future `cltv_expiry = 800000`, explicit commitment numbers,');
w('   BOLT 3 trimming/ordering/remainders) without modification.');
w();
w('---');
w();
w('*Generated by `tools/generate-ffor-vectors.ts` against beignet master using');
w('its real BOLT 3 commitment-builder and signer.*');

process.stdout.write(out.join('\n') + '\n');
