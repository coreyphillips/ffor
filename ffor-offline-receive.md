# FFOR: Fast-Forward Offline Receive

**Non-custodial offline Lightning payments via delegated settlement and unilateral pre-revoked state handoff**

- Status: Draft v0.4 (2026-07-02) — hardened by computed test vectors (Appendix A) and
  a working M1–M3 prototype (beignet `feat/ffor`, on-chain enforcement
  bitcoind-validated); wire details below reflect what the prototype actually
  implements
- Author: Corey Phillips (with Claude)
- Target: standalone extension bLIP; prototype target beignet ↔ beignet
- License: MIT

---

## 1. Abstract

FFOR lets a Lightning node (the **recipient**, `R`) receive payments that *fully settle
for the payer* while `R` is offline, without giving custody of the funds to anyone.

Before going offline, `R` delegates a bounded settlement authority to one of its direct
channel peers (the **settlement peer**, `S`). When a payment arrives, `S` settles it
upstream immediately — the payer's HTLC clears end-to-end within seconds, exactly like an
online payment — and *simultaneously* credits `R` inside their shared channel by issuing
a **fast-forward update**: a unilateral, strictly-recipient-favoring commitment update
that `S` signs alone, made safe by `S` first revoking its own current commitment. The
credit takes the form of a **voucher**: a long-dated HTLC output on `R`'s commitment
transaction, claimable by `R` on return (cooperatively via `update_fulfill_htlc`, or
unilaterally on-chain with pre-signed HTLC-success transactions), and reverting to `S` at
a distant expiry if `R` never returns.

`S` is a *role*, not a special node class: any peer that implements this spec, holds
sufficient local balance in the shared channel (i.e. `R`'s inbound liquidity), and stays
online can serve. An "LSP" is just the economically obvious candidate.

The protocol requires no consensus changes and no changes to nodes other than `R`, `S`,
and (optionally) `R`'s tower. Payers, routing nodes, and the rest of the network see a
perfectly ordinary payment.

---

## 2. Motivation and problem statement

In Lightning, *payment complete* means the payment preimage has propagated back to the
payer. This yields a hard constraint:

> **If the recipient generates the preimage, no payment to it can complete while it is
> offline.** An offline node takes no actions and reveals nothing. Therefore any scheme
> in which the payer's payment *clears immediately* requires the preimage to be known to
> some online party — in practice, the recipient's channel peer. The moment that peer
> releases the preimage it has claimed the inbound HTLC and holds the money. The entire
> design question reduces to: *can the peer's obligation to the recipient be made
> enforceable, atomically with its upstream claim?*

Existing approaches occupy two corners of the design space:

1. **Wake-based hold** (hold invoice + push notification): the peer holds the HTLC and
   wakes the recipient. Trustless and fast — but only handles *dormant* recipients, not
   offline ones, and burns route CLTV budget while held.
2. **Async payments** ([BOLT PR #1149](https://github.com/lightning/bolts/pull/1149),
   [Optech topic](https://bitcoinops.org/en/topics/async-payments/)): the *sender's* LSP
   holds the payment and retries when the recipient signals it is online. Fully
   trustless, preserves recipient-generated preimages — but the payment does not clear
   for the payer, and sender-side capital is parked for the duration.

FFOR is the third corner: the payment **clears instantly** and the recipient's claim is
secured by channel mechanics rather than trust. Its lineage is ZmnSCPxj's *fast
forwards* ([2019 thread](https://lists.linuxfoundation.org/pipermail/lightning-dev/2019-April/001986.html),
[2021 channel-in-channel construction](https://lists.linuxfoundation.org/pipermail/lightning-dev/2021-October/003265.html))
and Lloyd Fournier's observation that fast forwards permit receiving without keys online
([Optech #152](https://bitcoinmagazine.com/technical/bitcoin-optech-lightning-node-payments)).
FFOR specifies the missing end-to-end protocol: delegation, per-payment settlement
packages, the voucher output, tower mediation, escape transactions, and reconciliation.

### 2.1 Non-goals

- Offline *senders* (async payments handle that side).
- MPP to an offline recipient (v1 is single-part; §13.1).
- A general credit line: exposure is bounded by a pre-provisioned budget and expiry.
- Replacing async payments — FFOR degrades gracefully *to* hold-based flows when its
  budget is exhausted (§11.4).

---

## 3. Roles and terminology

| Term | Meaning |
|---|---|
| `R` | Recipient. Goes offline; owns the invoices; is credited via vouchers. |
| `S` | Settlement peer. Any direct channel peer of `R` implementing this spec. Stays online, settles delegated payments upstream, issues fast-forward updates. |
| `T` | Tower/mailbox (Variant B only). An always-online agent chosen by `R`. Holds preimages hostage against valid settlement packages; stores packages; watches for revoked broadcasts. Holds **no funds** and no channel keys (one scoped exception, §9.4). |
| epoch | One contiguous offline window governed by one delegation. At most one active per channel. |
| voucher | The per-payment credit: a received-HTLC output on `R`'s commitment with `cltv_expiry = T_exp`. |
| settlement package | The signed bundle `S` produces per payment: new commitment signature, HTLC signatures, (first package) revocation secret, (Variant A) preimage. |
| escape | A pre-signed `S`-side commitment allowing `S` to exit unilaterally if `R` never returns (§10). |
| `n0` | `S`'s commitment number at epoch start. |
| `n_R` | `R`'s commitment number at epoch start. |
| `T_exp` | Absolute block height at which all vouchers (and escapes) revert to `S`. |
| `D` | Absolute block height after which `S` stops accepting delegated payments (`D + margin < T_exp`). |

Notation: `C_i^R` is `R`'s commitment transaction after `i` fast-forward updates
(commitment number `n_R + i`); `C_{n0}^S` is `S`'s commitment at epoch start.

**On "LSP":** nothing in this spec distinguishes an LSP from a peer. The requirements on
`S` are: (a) feature support, (b) uptime for the epoch, (c) local balance ≥ budget in the
shared channel, (d) willingness to have that balance progressively converted to vouchers.
Since `R` is offline, the `S`↔`R` channel is unusable for routing during the epoch
anyway, so (d) has near-zero opportunity cost — the fee (§7.1) compensates uptime and
capital lockup. Two beignet nodes can serve each other symmetrically in alternating
epochs.

---

## 4. Trust model overview

| | Variant A (self-contained) | Variant B (tower-mediated) | Variant C (PTLC, future) |
|---|---|---|---|
| Preimage origin | `S` | `T` (released against verified package) | adaptor-composed `S`+`T` |
| Payment clears for payer | instantly | instantly | instantly |
| `S` broadcasts stale state | penalized (state revoked by first settlement; evidence reaches payer) | penalized (tower holds revocation from package 1) | penalized |
| `S` settles upstream but withholds the credit | **possible**; produces automatic cryptographic fraud proof (§12.2) | **impossible** without `S`+`T` collusion | impossible without collusion; collusion also cryptographically evidenced |
| `R` requirements while offline | none (mailbox recommended) | tower provisioned before epoch | tower |
| Residual trust | `S`'s fear of provable fraud + penalty | `R`'s own tower (standard watchtower assumption) | minimal |

Variant A suits high-trust pairs (your own second node, a bonded/reputable peer).
Variant B is the recommended default and is the configuration this spec centers.
Both share all wire messages; they differ only in who generates payment hashes and when
preimages are released.

---

## 5. Prerequisites

- The channel MUST use `option_static_remotekey` and `option_anchors` (v1 targets
  ECDSA anchor commitments; simple-taproot channels: see §13.4).
- Both nodes MUST support quiescence (`option_quiesce` / as used by splicing): epoch
  setup and reconciliation both begin from a quiescent channel with **no pending HTLCs**
  and no in-flight `update_fee`.
- Feature bit: `option_ff_receive`, bits **560/561** (provisional, experimental range),
  advertised in `init` and `node_announcement`.
- The commitment feerate is **frozen** for the duration of the epoch at the last signed
  value (`update_fee` is impossible with `R` offline). Anchor outputs make this safe:
  fees are trivial at signing time and attached via CPFP at broadcast time.

---

## 6. Protocol overview

```
R online                        R OFFLINE                          R returns
────────────────┬──────────────────────────────────────────┬────────────────────
                │                                          │
  quiescence    │   payer_i ──HTLC(H_i)──▶ ... ──▶ S       │  reestablish (+ ff TLV)
  ff_init      ─┼─▶                          │             │  ff_settlement replay ×j
  ff_accept    ◀┼─                           ├─ package_i ─┼─▶ (or fetch from T)
  ff_invoices  ─┼─▶                          │  ▼          │  ff_reconcile      ─▶
  ff_escape_sigs┼─▶ (optional)               │  T verifies │  ff_reconcile_ack ◀─
  ff_begin     ─┼─▶                          │  releases t_i  ff_revoke_batch   ─▶
                │                            ▼             │  ff_end (×2)
                │              S settles upstream instantly│  update_fulfill ×j
                │              payer sees SUCCESS          │  → vouchers become balance
                │              C_i^R gains voucher_i       │  (splice / resume normal ops)
```

Lifecycle: **SETUP → EPOCH → (settlement × j) → RECONCILE → OPERATIONAL**, with two
abnormal exits: `R` never returns (escape, §10) or `S` misbehaves (penalty/fraud proof,
§12).

The core trick, restated precisely: a channel update that only *increases* the
counterparty's claim can be made unilaterally if the updater first revokes its own
current commitment, because the updater can no longer profit from broadcasting anything.
After fast-forward #1, `S` has **no broadcastable commitment at all** (its only signed
state is revoked) and remains in that condition until `R` returns and countersigns — or
until `S` uses a pre-signed escape. `R`'s side is unaffected: each `C_i^R` it inherits
is strictly better for it than the last, and `R` reveals no secrets until reconciliation.

---

## 7. Epoch establishment

All new messages use odd types in the custom range (ignorable by non-implementing
peers). All multi-byte integers are big-endian. Each message begins
`[32: channel_id][32: epoch_id]` (omitted from the field tables below). `epoch_id` is
32 random bytes generated by `R`; both sides MUST enforce per-channel uniqueness across
all epochs *including aborted setups*. Messages marked ✍ carry a `signature` field: a
node-key signature over the SHA256 of `[message type ‖ body]` excluding the signature
itself. The signature is always the **final 64 bytes of the body**; the TLV stream
therefore sits *before* it (unusual for LN messages, deliberate here): unknown odd TLVs
are permitted in that stream and are covered by the digest. These signatures exist for
**non-repudiation** (fraud proofs, §12.2), since Noise transport authenticates but does
not produce third-party-verifiable evidence.

### 7.1 `ff_init` (type 55001, R→S) ✍

| Field | Size | Description |
|---|---|---|
| `variant` | u8 | 1 = A (self-contained), 2 = B (tower) |
| `budget_msat` | u64 | max cumulative voucher value this epoch |
| `max_payments` (`K`) | u16 | max number of delegated payments (≤ open HTLC slot budget, §8) |
| `min_payment_msat` | u64 | below this, `S` MUST reject/fall back (≥ voucher dust floor, §8) |
| `settlement_deadline` (`D`) | u32 | absolute height; no new delegated settlements after |
| `voucher_expiry` (`T_exp`) | u32 | absolute height; all vouchers/escapes revert to `S` after. MUST satisfy `T_exp ≥ D + reconcile_margin` (recommended margin ≥ 1008) |
| `fee_base_msat` | u32 | `S`'s per-payment skim, base |
| `fee_proportional_millionths` | u32 | `S`'s skim, proportional |
| `escape_granularity_msat` (`G`) | u64 | 0 = no escape; else escape step size (§10) |
| `r_per_commitment_points` | u16 + K×33 | `R`'s per-commitment points for commitment numbers `n_R+1 … n_R+K`, pre-shared so `S` can build `C_i^R` alone |
| TLV 1: `payment_hashes` | K×32 | Variant B only: hashes generated by `R`'s tower |
| TLV 3: `tower_node_id` | 33 | Variant B only |
| TLV 5: `tower_uri` | var | Variant B only: how `S` reaches `T` |
| `signature` | 64 | `R`'s node-key sig (proves `R` requested these terms) |

Pre-sharing `R`'s per-commitment *points* is safe: points are routinely disclosed one
step ahead in normal operation, and disclosure of a point reveals nothing about its
secret. `R` MUST NOT reuse these indexes for any other purpose.

In Variant B (`variant == 2`), TLVs 1, 3, and 5 are all REQUIRED; in Variant A they
MUST be absent. Fee terms are proposed by `R`; `S` accepts by responding or rejects
with `ff_error`. `S` MAY advertise standing terms out-of-band (§11.3) which `R` simply
echoes.

### 7.2 `ff_accept` (type 55003, S→R) ✍

| Field | Size | Description |
|---|---|---|
| `s_commitment_number` (`n0`) | u64 | explicit, to anchor evidence |
| TLV 1: `payment_hashes` | K×32 | Variant A only: `S`-generated. **`H_1` MUST equal `SHA256(per_commitment_secret_S[n0])`** (§12.1) |
| TLV 7: `s_htlc_id_base` | u64 | the HTLC id `S` assigns to voucher `seq 1`; voucher `seq i` gets id `base + i − 1`. Required — `R` cannot otherwise observe `S`'s offer counter, and reconciliation ends with `j` live HTLCs both sides must address by id. |
| `signature` | 64 | `S`'s node-key sig (proves `S` accepted budget/fee terms and hash set) |

Requirements:
- `S` MUST verify `budget_msat ≤ spendable local balance − channel_reserve − escape
  rounding slack (G)` and that `K` vouchers fit the commitment weight/slot budget (§8).
- In Variant A, `R` cannot verify the `H_1` binding at setup (it would require the
  secret); it is verified *ex post* at settlement 1 by checking
  `preimage·G == per_commitment_point_S[n0]`. A false binding is detectable, attributable
  (both messages are signed), and grounds to blacklist `S` — see §12.1.

### 7.3 `ff_invoices` (type 55005, R→S)

| Field | Size | Description |
|---|---|---|
| `num_invoices` | u16 | = K |
| `invoices` | var | length-prefixed BOLT 11 strings |

Each invoice: **amountless** (payer supplies the amount — `R` cannot pre-sign unknown
amounts), payment hash `H_i`, expiry ≥ wall-clock estimate of `T_exp`, a route hint
`S → R`, `min_final_cltv_expiry` as usual (it binds `S`'s upstream acceptance, not the
voucher), signed by `R`'s node key. These are single-use and **strictly ordered**: settlement
`seq i` carries exactly `H_i` (§9.1), and the §7.2 `H_1` binding requires the first
settled payment to be hash 1 — so `S` MUST serve invoice `i+1` only after `i` is
consumed, MUST NOT settle the same hash twice, and MUST fail upstream any delegated
hash arriving out of order.

Distribution: v1 leaves payer-side distribution out of scope — `S` MAY serve the next
unused invoice via LNURL-pay-style endpoint, BOLT 12 message relay, or any out-of-band
channel on `R`'s behalf. (BOLT 12 static-invoice integration: §13.2.)

*Privacy note:* `S` cannot decrypt the final onion hop (it is encrypted to `R`'s node
key), so `payment_secret` is unenforced for delegated payments. This is acceptable:
each hash is single-use and pre-committed, so the probing attack `payment_secret`
prevents does not apply. `S` recognizes a delegated payment purely by matching
`update_add_htlc.payment_hash` against the epoch's hash set; the undeliverable inner
onion is discarded.

### 7.4 `ff_escape_sigs` (type 55009, R→S) — optional, iff `G > 0`

The escape set is **deterministic** given the epoch parameters (§10), so no request
message is needed:

| Field | Size | Description |
|---|---|---|
| `num_escapes` (`J`) | u16 | `= ceil(budget_msat / G)` |
| `escape_sigs` | J×64 | `R`'s signature on escape commitment `E_j` for `j = 1…J` |
| `escape_htlc_sigs` | J×64 | optional trailing field, MUST be **omitted** in v1 — the aggregate voucher needs no second-level transaction (its CLTV and revocation-delay are applied directly in-script; Appendix B). Decoders MUST tolerate its absence and ignore it if present. |

All `E_j` live at `S`'s commitment number `n0 + 1` (whose per-commitment point `R`
already holds from the last `revoke_and_ack`). They are mutually exclusive alternatives;
at most one may ever be broadcast, and all are killed at reconciliation by revoking index
`n0 + 1` (§9.3, §10).

### 7.5 `ff_begin` (type 55011, R→S)

| Field | Size | Description |
|---|---|---|
| `epoch_start_height` | u32 | for audit; MUST be within a few blocks of current tip |

Sent from the quiescent state after all setup messages are exchanged and (Variant B)
after `R` confirms its tower is provisioned (§9.4). On send/receipt the channel enters
**FF_EPOCH**: all normal `update_*` / `commitment_signed` traffic is forbidden; only
fast-forward settlement and reestablish/reconciliation messages are valid. `R` MAY now
disconnect. `R` MAY also remain online; an epoch with zero settlements is closed
cooperatively with `ff_end` at any time.

Both sides MUST persist the full epoch state (parameters, hashes, points, escape sigs,
invoice set) durably before `ff_begin`. `R` MUST also have an on-chain sweep
destination provisioned before going offline — every unilateral remedy in §11–§12
needs one.

Setup lifetime and quiescence exit:
- Nothing before `ff_begin` is durable except epoch_id-uniqueness tracking: a
  disconnect during FF_SETUP aborts the setup entirely, and a pre-`ff_begin` `ff_error`
  aborts it cleanly. Both events, like the completion of `ff_end`, **terminate the
  quiescence session** and return the channel to normal operation (BOLT quiescence
  otherwise ends only on reconnect or a splice — this spec adds these exits).
- The epoch is *live* only once both sides have processed `ff_begin`. If `R` crashes
  after persisting FF_EPOCH but before `ff_begin` reaches `S`, the sides disagree; the
  reestablish TLV (§11.1) resolves it: an `S` that reports no epoch means setup never
  completed, and `R` MUST discard its persisted epoch as aborted (safe — `S` never
  accepted a delegated payment).

---

## 8. The voucher commitment `C_i^R`

`C_i^R` is a standard BOLT 3 commitment transaction for `R` at commitment number
`n_R + i`, built by `S` alone, defined **deterministically** so that `R` and `T` can
reconstruct it byte-for-byte from the epoch parameters plus the settlement history:

- Base state: the last co-signed pre-epoch state (balances, no HTLCs — quiescence
  guarantees this), at the frozen feerate.
- Per-commitment point: `r_per_commitment_points[i]`.
- Vouchers `1…i`: each voucher `k` is a **received HTLC** (from `R`'s perspective,
  offered by `S`) with:
  - `amount_msat = v_k = htlc_amount_k − fee(htlc_amount_k)` where
    `fee(a) = fee_base_msat + a · fee_proportional_millionths / 10^6`
  - `payment_hash = H_k`
  - `cltv_expiry = T_exp` (uniform for the epoch)
- `S`'s `to_local` is reduced by `Σ v_k` (plus per-HTLC commitment weight fee, borne by
  the funder per BOLT 3 — deterministic at the frozen feerate). Millisatoshi rounding is
  BOLT 3's: each voucher output is floored to whole satoshis and the sub-satoshi
  remainder stays with the offerer's (`S`'s) `to_local` — normative, since `R` and `T`
  must reconstruct `C_i^R` byte-exactly.
- Output ordering, dust trimming, anchors: exactly per BOLT 3. Note that BOLT 3 output
  order is **not** voucher sequence order (vouchers sort by amount/scriptpubkey like any
  output); anything keyed "per voucher" on the wire maps by commitment output index, not
  by `seq`.

Constraints `S` MUST enforce before accepting delegated payment `i`:

- `htlc_amount_i ≥ min_payment_msat` and `v_i` above the voucher dust floor
  (`dust_limit + HTLC-success fee at the frozen feerate`; under
  `option_anchors_zero_fee_htlc_tx` the second term is zero, so the floor is exactly
  `dust_limit`) — a trimmed voucher would be uncollectible on-chain. The floor
  guarantees only that the output *exists*, not that it is economically enforceable: a
  near-floor voucher cannot pay for its own second-level claim plus CSV sweep, making
  it collectible only cooperatively. `R` SHOULD size `min_payment_msat` against
  expected on-chain enforcement cost at realistic feerates, not against the trim floor.
- `Σ_{k≤i} v_k ≤ budget_msat`; `i ≤ K ≤ min(max_accepted_htlcs of both sides)` —
  vouchers are `S`-offered and `R`-accepted, so both limits bind — and within
  `max_htlc_value_in_flight` semantics (vouchers occupy real HTLC slots and weight).
- `S`'s post-update balance ≥ `channel_reserve`.
- Current height `< D` and `< upstream cltv_expiry − S`'s safety delta.

On failure of any check, `S` MUST NOT settle: it either fails the upstream HTLC
(`temporary_node_failure`) or falls back to hold-and-wake if separately supported
(§11.4). Failure construction is standard BOLT 4 with `S` as the erring node, using
`S`'s own hop shared secret — `S` decrypted its own onion layer normally; only the
*next* onion (addressed to `R`) is opaque to it.

Byte-accurate test vectors for this construction (`C_0…C_3`, three settlements,
computed and independently verified against a real BOLT 3 implementation) are in the
companion file `ffor-test-vectors.md` (Appendix A), with a reproducible generator under
`tools/`.

**Why an HTLC and not a balance increase?** Three reasons. (1) *Expiry*: the timeout
branch returns the funds to `S` at `T_exp` if `R` never comes back — without it, `S`'s
funds would be hostage to a vanished peer forever. (2) *Machinery reuse*: signatures,
second-level transactions, on-chain resolution, and reconciliation-time conversion via
`update_fulfill_htlc` are all stock BOLT 2/3/5 — a beignet prototype touches no
commitment-format code. (3) *Crash-ordering safety*: the hash-lock means a package that
leaks before the upstream claim completes does not by itself let `R` take value `S`
never received (§9.2 ordering makes this window `S`-safe in both variants).

---

## 9. Settlement

### 9.1 `ff_settlement` (type 55013, S→R and S→T) ✍ — the settlement package

| Field | Size | Description |
|---|---|---|
| `seq` (`i`) | u16 | 1-based, strictly sequential |
| `payment_hash` | 32 | MUST equal `H_i` |
| `htlc_amount_msat` | u64 | as received upstream |
| `voucher_amount_msat` | u64 | `v_i`; MUST equal `htlc_amount − fee(htlc_amount)` |
| `r_commitment_number` | u64 | `n_R + i` |
| `commitment_sig` | 64 | `S`'s signature on `C_i^R` (BOLT 2 compact 64-byte encoding, as in `commitment_signed`) |
| `num_htlc_sigs` | u16 | = i |
| `htlc_sigs` | i×64 | `S`'s signatures (compact encoding) for the HTLC-success spend of **every** voucher output on `C_i^R`, in BOLT 3 commitment **output-index order** — not voucher `seq` order (§8) — (`SIGHASH_SINGLE|ANYONECANPAY`, anchor rules) |
| TLV 1: `revocation_secret_n0` | 32 | **REQUIRED in `seq == 1`, both variants**: `per_commitment_secret_S[n0]`. This is the *pre-revocation*: from this moment `S` has no broadcastable state. |
| TLV 3: `preimage` | 32 | Variant A only: `P_i` |
| TLV 5: `upstream_scid` | 8 | optional, audit |
| `signature` | 64 | `S`'s node-key sig over the package (the fraud-proof anchor: `S` provably committed to crediting `v_i` against `H_i`) |

Every package re-signs the *entire* voucher set, so possession of package `i` alone (plus
epoch parameters) suffices to broadcast `C_i^R` and claim all `i` vouchers — `R` does not
need packages `1…i−1` to enforce, only to audit.

### 9.2 Settlement procedure

On `update_add_htlc` from any upstream peer with `payment_hash ∈ {H_1…H_K}` (matched on
the HTLC itself; the inner onion is undecryptable and discarded), after the upstream
HTLC is irrevocably committed and all §8 checks pass:

**Variant A** (`S` knows `P_i`):
1. `S` durably persists the package, delivers it to `R`'s mailbox if one was provided
   (SHOULD — note no normative mailbox transport is defined in v0.x; reconciliation
   replay is the only in-protocol delivery path, and the mailbox interface is deferred
   to Appendix C), then
2. settles upstream with `update_fulfill_htlc(P_i)`.

**Variant B** (`T` knows `t_i`):
1. `S` durably persists the package and sends it to `T`.
2. `T` runs the verification checklist (§9.4). On success `T` durably stores the package
   **before** replying `ff_release {seq, preimage t_i}` (transport between `S` and `T`
   is out of scope: HTTPS, onion message, or a direct Noise connection all work).
3. `S` settles upstream with `t_i`.

The order makes both parties safe: `S` acquires the preimage exactly when the package is
committed at `T`, and possession of the preimage lets `S` enforce its upstream claim
on-chain even if the upstream peer force-closes mid-settle. Conversely `R`'s credit is
in `T`'s custody (data, not funds) before the money moves. `S` MUST treat packages as
idempotent by `seq` for crash-replay, and MUST process delegated payments strictly
serially.

`payment:received`-equivalent proof for the payer is unchanged: preimage + `R`-signed
invoice. (Amount attestation is weak, as with any amountless invoice — §13.3.)

### 9.3 What `S` can no longer do

After settlement 1, `S`'s only ever-signed commitment (`C_{n0}^S`) is revoked and `S`
holds no successor (that would need `R`'s signature). Consequences, by design:

- `S` MUST NOT broadcast anything except a pre-signed escape (§10).
- `S` cannot force-close to collect voucher timeouts before reconciliation; the escape
  path is its only unilateral exit.
- Subsequent settlements reveal no further commitment secrets — index `n0` was the only
  live state. (In Variant A, `P_1 = per_commitment_secret_S[n0]` makes the upstream
  claim of payment 1 *itself* the act of revocation — see §12.1. `P_{2…K}` are ordinary
  random preimages; nothing remains to revoke.)

**Classification rule (normative — and easy to get wrong):** after the pre-revocation,
`S`'s bookkeeping still calls index `n0` its *current* commitment. A node MUST treat
any counterparty commitment **whose revocation secret it holds** as revoked, regardless
of commitment-number comparisons. Standard BOLT 5 implementations that decide
revoked-vs-current by index alone will misclassify this breach as a current-state close
and never penalize it. (Empirically hit by the reference implementation's resolver;
fixed by consulting the secret store in both the number-match and equal-number
disambiguation branches.)

### 9.4 Tower requirements (Variant B)

Provisioning (by `R`, before `ff_init`; transport out of scope): epoch parameters,
channel static parameters (funding outpoint, both funding pubkeys, both parties'
basepoints, `dust_limit`, `to_self_delay`, frozen feerate), `R`'s pre-shared
per-commitment points, the hash list with preimages `t_1…t_K` (generated by `T` or by `R`
and handed to `T`), and `S`'s `per_commitment_point[n0]`.

Verification checklist before releasing `t_i` — `T` MUST verify:
1. `seq == last_released + 1`; `payment_hash == H_seq`; height `< D`.
2. `voucher_amount == htlc_amount − fee(htlc_amount)`; `htlc_amount ≥ min_payment_msat`;
   cumulative `Σ v ≤ budget_msat`.
3. Deterministic reconstruction of `C_i^R` (§8) succeeds; `commitment_sig` verifies
   against `S`'s funding pubkey; every `htlc_sig` verifies against `S`'s `htlc_pubkey`
   derived at `r_per_commitment_points[i]`.
4. If `seq == 1`: `revocation_secret_n0 · G == per_commitment_point_S[n0]`.
5. Package stored durably. Only then release `t_i`.

Ongoing duties:
- Serve stored packages and preimages to `R` on authenticated request (signature from
  `R`'s node key or a delegated session key).
- Watch the chain for `C_{n0}^S` and for any escape `E_j`; alert `R` out-of-band.
- **Penalty capability** for the one revocable state, `C_{n0}^S`: the justice
  transaction requires the revocation private key, which combines `S`'s revealed secret
  (from package 1) with `R`'s `revocation_basepoint_secret`. `R` therefore either (a)
  shares that scoped basepoint secret with `T` together with a mandated sweep address —
  a malicious `T` could redirect *only* penalty funds, and *only* if `S` also broadcast a
  revoked state (a double-failure), the standard watchtower compromise — or (b) accepts
  alert-only towers and relies on returning within `to_self_delay` of any breach.
  Document the choice per deployment.

`T` never holds funds and (option b) never holds key material. `R` running its own
tower reduces Variant B trust to "R keeps one keyless-or-scoped-key box online" — which
is precisely the watchtower assumption Lightning already makes, now also covering
receipt.

---

## 10. Escape: `S`'s unilateral exit (optional, `G > 0`)

If `R` never returns, `S` must not be locked forever. At setup, `R` pre-signs `J =
ceil(budget/G)` alternative commitments `E_1…E_J`, all at `S`'s commitment number
`n0 + 1`:

- `E_j` = the pre-epoch state, minus `j·G` msat from `S`'s `to_local`, plus **one
  aggregate voucher output of `j·G`** paying `R`.
- The aggregate voucher is **bare-sig, not hash-locked**: spendable by `R`'s sig alone
  (a returning `R` may have none of the packages, so its claim must need only its keys),
  by `S` after `T_exp` (CLTV timeout branch, revocation-delayed), or by the revocation
  path (standard, so the state remains penalizable if later revoked). Exact script,
  witnesses, weights, and the deterministic construction of each `E_j` are normative in
  **Appendix B**.
- Amounts are known at setup (they are `j·G`, not payment-dependent), which is what
  makes pre-signing possible at all. `G` MUST be an integer multiple of 1000 msat and
  ≥ the voucher dust floor (§8), so every aggregate voucher is whole-satoshi and
  untrimmed.

Rules:
- `S` MAY broadcast exactly one `E_j` only if `current height > D + escape_delay`
  (recommended `escape_delay ≥ 2016`) **and** reconciliation has not begun. It MUST
  choose `j = ceil(owed/G)` — rounding **up**, so `S` bears the rounding cost (≤ G) and
  gains nothing from escaping; broadcasting `j < ceil(owed/G)` under-credits `R` and is
  provable fraud bounded by `owed − j·G` (packages at `T` prove `owed`; the chain proves
  `j·G`).
- At reconciliation, all escapes are neutralized at once: `S` reveals
  `per_commitment_secret_S[n0+1]` (§11.1), making every `E_j` penalizable. `S`'s first
  real post-epoch commitment is therefore at `n0 + 2`.
- After `T_exp`, `S` claims the aggregate voucher's timeout branch; `R`'s main balance
  output sits on-chain claimable by `R` whenever it eventually appears. Net result of a
  vanished `R`: `S` recovers everything it is owed (± rounding in `R`'s favor), `R`'s
  funds await it on-chain. Nobody's funds are burned.

With `G = 0` (no escapes), `S` accepts the hostage risk explicitly — reasonable between
own nodes, or with small budgets/short epochs.

---

## 11. Return and reconciliation

### 11.1 Message flow

On reconnect, `channel_reestablish` carries TLV **55001**
`{epoch_id: 32, last_seq: u16, state: u8}` from each side (`state`: 0 = setup, 1 =
epoch, 2 = reconciling, 3 = closed), and — from `S`, iff escape signatures were
exchanged — TLV **55003** `s_catchup_per_commitment_point` (33 bytes): `S`'s
per-commitment point for `n0 + 2`, which `R` otherwise could not obtain before signing
the catch-up commitment in step 2. Mismatch rules: an `S` reporting no epoch means
setup never completed and `R` MUST discard (§7.5); conversely, if `R` reports no epoch
while `S` has `last_seq > 0`, `S` MUST retain the epoch and respond `ff_error` — `S`
holds voucher obligations and MUST NOT forget them; `S` MAY discard only at
`last_seq == 0`. `S`'s `last_seq` is **authoritative** for the replay count, and `S`
MUST send its `channel_reestablish` before any replayed packages (replay ordering
relies on transport FIFO). Then, from quiescence (automatic — no other updates are
legal in FF_EPOCH):

1. **Replay**: `S` re-sends `ff_settlement` for `seq 1…j`. `R` independently fetches
   packages/preimages from `T` (Variant B) or its mailbox and cross-checks; any
   discrepancy between `S`'s replay and `T`'s store is itself signed evidence (§12.2).
   `R` treats duplicate replays idempotently by byte-comparison; a replayed package
   that *differs* from a stored one with the same `seq` MUST be rejected (two signed
   contradictory packages are themselves fraud evidence, §12.2).
   `R` validates every package (same checklist as `T`, §9.4) and adopts `C_j^R`.
2. **`ff_reconcile`** (type 55015, R→S): `R` signs `S`'s catch-up commitment
   `C^S_{new}` at number `n0 + 2` (or `n0 + 1` when no escapes were signed), mirroring
   `C_j^R` exactly (same j vouchers, now offered-HTLCs from `S`'s perspective, HTLC ids
   per §7.2 `s_htlc_id_base`):
   `{new_commitment_number: u64, commitment_sig: 64, num_htlc_sigs: u16, htlc_sigs:
   j×64, r_next_per_commitment_point: 33}`.
3. **`ff_reconcile_ack`** (type 55017, S→R) — fixed fields first, then the TLV stream
   (standard LN layout):
   `{s_next_per_commitment_point: 33}`, then
   `TLV 1 revocation_secret_n0: 32 (iff j == 0 — otherwise it went out in package 1)`,
   `TLV 3 revocation_secret_n0plus1: 32 (iff escapes were signed)`.
   `R` MUST verify each secret against its stored points. All escapes are now toxic to
   `S`; `T` can stand down at end of epoch.
4. **`ff_revoke_batch`** (type 55019, R→S):
   `{count: u16, secrets: count×32}` — `R`'s per-commitment secrets for its skipped
   indexes `n_R … n_R + j − 1` (its pre-epoch state and every superseded `C_k^R`,
   `k < j`). Sequential indexes are not mutually derivable in shachain, hence the
   explicit list; `S` verifies each against `R`'s points and inserts into its shachain
   store normally.
5. **`ff_end`** (type 55021): `S` initiates upon successfully processing
   `ff_revoke_batch`; `R` echoes. Epoch closed; channel returns to OPERATIONAL with
   `j` live HTLCs, feerate unfrozen.
6. **Conversion**: `R` sends standard `update_fulfill_htlc` for each voucher (preimages
   from packages / `T`), through the normal commitment dance — the credits become plain
   channel balance with zero new machinery. If `S` stalls here and `T_exp` approaches,
   `R` force-closes `C_j^R` and claims every voucher on-chain via its pre-signed
   HTLC-success transactions (that is what the `htlc_sigs` in package `j` are for),
   with anchor CPFP as usual. **Enforcement never requires the reconcile handshake**:
   adopting `C_j^R` needs only the validated packages, so `R` MAY force-close directly
   from FF_EPOCH — e.g. when `S` refuses reconciliation entirely (§12.1) or on an
   `ff_error` protocol violation after `ff_begin`. Implementation note: attaching
   CPFP/fee inputs to an HTLC-success transaction changes its txid; downstream
   spent-output tracking must match by the preserved `SIGHASH_SINGLE|ANYONECANPAY`
   input 0 (outpoint + witness), never by txid.

`ff_error` (type 55023, body `[u16: len][len: data]` after the standard header, BOLT 1
error style) aborts setup (before `ff_begin`, ending the quiescence session, §7.5) or
signals protocol violation; during EPOCH/RECONCILE the channel falls back to on-chain
enforcement rather than aborting.

### 11.2 Edge cases

- **Reconnect mid-settlement**: `S` MUST complete or upstream-fail any in-flight
  delegated HTLC before entering step 1; reconciliation always starts from a settled
  package history.
- **Zero-settlement epoch**: plain `ff_end` with no reconcile is permitted regardless
  of `G`. With escapes outstanding this is still safe: normal operation reuses index
  `n0 + 1`, so the escapes die automatically the next time that index is revoked in
  the ordinary flow, and until then a broadcast escape only *overpays* `R` (at `j·G`
  against zero owed) at `S`'s own expense. Implementations MAY instead run the
  escape-killing reconcile (step 2 at `n0 + 2`, step 3 revealing both secrets)
  immediately.
- **Mid-reconcile disconnect**: on the next reconnect `S` simply re-replays from
  `seq 1`; `R`'s byte-comparison idempotency (§11.1 step 1) makes this safe. Crash
  windows around `R`'s adoption of `C_j^R` and the `ff_reconcile` send are handled the
  same way — reconciliation restarts from replay; no step before `ff_revoke_batch`
  reveals anything `R` cannot safely re-send.
- **`R` returns after `D` but before `T_exp`**: reconciliation proceeds normally; `S`
  MUST NOT have escaped yet (escape requires `D + escape_delay`).
- **`R` returns after `S` escaped**: `R` claims the aggregate voucher on-chain with its
  key; remaining balance per the escape commitment; audit vs packages for rounding
  fraud.
- **Non-delegated HTLCs arriving for `R` during the epoch** (someone routes to `R`
  outside the delegated set): `S` MUST fail them upstream (`unknown_next_peer`) or hold
  briefly and attempt wake, if separately supported.
- **Duplicate/unknown hash**: fail upstream; never settle a consumed hash again.

### 11.3 Liquidity interplay

- **Provisioning is everything.** All offline-receive capacity must exist in the
  channel *before* the epoch: splicing and lease purchases need both signatures, so
  neither can run while `R` is offline. The natural pairing with bLIP-51 liquidity ads:
  `R` leases inbound (`S`'s local balance) sized to expected offline volume, then opens
  the epoch. An FFOR budget is, economically, a *use* for a liquidity lease while the
  buyer sleeps.
- **Advertising**: `S` SHOULD advertise standing FFOR terms alongside its lease rates —
  proposed odd TLV in the liquidity-ads extension carrying
  `{ff_fee_base_msat, ff_fee_ppm, max_budget_msat, max_epoch_blocks, variants}` —
  letting `R` price uptime+delegation the same way it prices inbound capacity today.
- **On return**: vouchers convert to in-channel balance (no on-chain footprint), after
  which `R` can splice-out revenue, `S` can splice-in to replenish sell-side inventory,
  and the next epoch can begin. Note the pleasant asymmetry with hold-based schemes:
  FFOR consumes no route CLTV, jams no third-party channels, and parks no sender
  capital — the only locked resource is `S`'s balance in a channel that `R`'s absence
  idles anyway.
- **Leased-channel composition**: if the channel carries an active bLIP-51 lease with
  `S` as lessor, the lease's CLTV-locked `to_local` encumbrance applies to `S`'s
  outputs as usual; vouchers *reduce* `S`'s `to_local`, which is consistent with the
  lease's purpose (the liquidity is being delivered to `R`). Implementations MUST
  ensure the escape commitments also carry the lease encumbrance on `S`'s outputs.

### 11.4 Fallback ladder

Budget, slots, or deadline exhausted → `S` degrades per payment, in order of
preference: (1) hold + wake attempt (dormant `R`), (2) cooperate with sender-side async
payments (hold upstream), (3) fail with `temporary_node_failure`. FFOR, wake-based
hold, and async payments compose into one coherent receiver-offline story; FFOR is the
only rung on which the payer's payment actually completes.

---

## 12. Security analysis

Attack surface, by actor:

### 12.1 `S` misbehavior

| Attack | Outcome |
|---|---|
| Broadcast pre-epoch state `C_{n0}^S` after any settlement | Revoked by package 1: penalized (tower or returned `R` takes everything). In Variant A the *upstream claim of payment 1 is itself the revocation* — `P_1 = per_commitment_secret_S[n0]`, so the payer and every upstream node hold the revocation evidence the moment the payment completes. A revocation secret is harmless to them (useless without `R`'s keys) but fatal to `S` if it ever cheats: `R` can even recover it from the payer's receipt out-of-band. A false `H_1` binding is detected at settlement 1 (`P_1·G ≠` point), is attributable via the signed `ff_accept`, and downgrades only this evidence channel — tower/penalty paths are unaffected. |
| Broadcast an escape early or with `j` too small | Escape ≠ revoked (unless reconciliation happened — then penalized). Early: `R` still gets ≥ owed (ceil rounding), `S` gains nothing and pays the rounding cost. Undersized: provable fraud bounded by `owed − j·G` (signed packages at `T` vs the chain). |
| **Settle upstream, withhold the credit** (never deliver package, never broadcast) | **Variant B: impossible** — the preimage physically does not reach `S` until `T` durably holds the verified package; `R` recovers everything from `T` even if `S` vanishes. **Variant A: possible** — this is the variant's honest limitation. `R`'s loss is bounded by the epoch budget; the fraud is automatically evidenced (payer holds `R`-signed invoice + preimage; `S` signed `ff_accept` over the hash set; for payment 1 the preimage is also `S`'s own revocation secret). "Cheating is provable and bounded" rather than "impossible": use Variant A only where that suffices. |
| Inflate `htlc_amount` / skim beyond fee | Package amounts are verified by `T` before release (B) and audited by `R` on return (A); signed packages make any inconsistency attributable. |
| Refuse reconciliation / stall conversion | `R` force-closes `C_j^R` before `T_exp` and claims all vouchers via pre-signed HTLC-success txs. This is the standard unilateral-close cost, not a loss. |

### 12.2 Fraud-proof inventory

Every dishonest path above leaves third-party-verifiable evidence, by construction:
`R`-signed `ff_init` + invoices (delegation happened, terms), `S`-signed `ff_accept`
(terms + hash set + `n0`), `S`-signed packages (per-payment credit obligations), payer
receipts (settlement happened), the chain (what `S` actually did). This spec does not
define an adjudication venue — the proofs' immediate value is objective blacklisting,
reputation systems, and bonded-`S` arrangements, and they are what keeps rational-`S`
deviation unprofitable even in Variant A.

### 12.3 `R` / `T` / third-party misbehavior

- `R` broadcasts a stale `C_k^R` (`k < j`) or its pre-epoch state: it only shortchanges
  itself (`S`'s vouchers `k+1…j` simply never existed on that state and `S` keeps those
  amounts; every broadcastable `R` state is one `S` signed). No `S` exposure.
- `R` claims a voucher on-chain and *also* disputes off-chain: impossible — claims are
  hash/sig-bound to states `S` signed.
- `T` alone: holds no funds, no channel keys (except the scoped §9.4(a) option); worst
  case it withholds preimages/packages from `R` — `R`'s recourse is that `T` is `R`'s
  *chosen agent*, typically `R`'s own box; `S`'s packages replayed at reconciliation are
  an independent copy.
- `S`+`T` collusion (Variant B): reduces to Variant A's withholding case — bounded,
  evidenced. `R` chose both its counterparty and its tower; requiring *two* chosen
  parties to conspire is the standard watchtower-grade assumption.
- Payer/upstream: sees a normal payment; learns one revocation secret (payment 1,
  Variant A) that is useless without `R`'s keys. Jamming *this* mechanism is
  unattractive: delegated HTLCs settle instantly, so there is nothing to jam — a strict
  improvement over hold-invoice-based offline receive, which hands griefers long-lived
  route locks.
- DoS on `S`/`T`: rate-limit invoice serving; packages are cheap (~`32·i + few hundred`
  bytes); `K` bounds everything.

### 12.4 What is genuinely weaker than online receive

Stated plainly: (1) Variant A's bounded withholding exposure; (2) `payment_secret`
unenforced (mitigated by single-use hashes); (3) amount attestation is amountless-grade
(§13.3); (4) `R` must return before `T_exp` or its claims rest on `S`'s honesty /
escape rounding; (5) `S` learns `R`'s offline schedule and all payment amounts (it
learns the latter as last hop today anyway); (6) vouchers below the economic
enforcement threshold (§8) are collectible only from a cooperative `S`.

---

## 13. Limitations and open problems

### 13.1 MPP
`S` cannot read `total_msat` in the final onion (undecryptable), so it cannot know when
a multipart set completes. v1: delegated payments MUST be single-part; `S` fails
surplus parts carrying an already-settled hash. Possible v2: delegation-time rule
("accumulate parts on `H_i` for up to `t` seconds, settle when sum ≥ payer-signaled
total via TLV in the *outer* onion") — needs sender cooperation, deferred.

### 13.2 Invoice distribution / BOLT 12
Amountless pre-signed BOLT 11 invoices are the v1 vehicle because BOLT 12 invoices
commit to amount and payer identity and thus cannot be pre-signed. The async-payments
work (static invoices held by an always-online node,
[BOLT PR #1149](https://github.com/lightning/bolts/pull/1149)) is solving exactly the
distribution half of this problem; the natural convergence is `S` serving `R`'s static
invoice material while FFOR supplies the settlement half. Track and align.

### 13.3 Amount-binding in receipts
An amountless invoice + preimage proves *a* payment, not its size. Signed settlement
packages (which state `htlc_amount_msat`) partially repair this — the payer can demand
`S`'s package signature as an amount attestation. PTLCs repair it properly.

### 13.4 Simple-taproot channels
MuSig2 funding does not block fast-forwards — `S` contributes its partial signature on
`C_i^R` unilaterally; `R` completes the aggregate on return. It *does* require `R`'s
verification nonces for `K` future commitments to be pre-shared, which a deterministic
verification-nonce derivation (as beignet already implements for reestablish:
`HMAC(per_commitment_seed, tag‖height)`) makes straightforward, and it complicates the
tower's checklist (partial-sig verification) and the penalty path (taproot revocation
key-path tweaks). Deferred to a v2 appendix; v1 is ECDSA-anchor only.

### 13.5 PTLC upgrade (Variant C)
With PTLCs, replace hashes with points and compose: the upstream payment point requires
adaptor shares from both `S` and `T`, so `S`'s completed upstream adaptor signature
*is* the release event, cryptographically inseparable from the package commitment —
withholding stops being a trust question even against `S`+`T` collusion (the collusion
itself yields a publishable adaptor transcript). Also restores proof-of-payment
uniqueness and amount binding. All FFOR structure (vouchers, escapes, reconciliation)
carries over unchanged; only §9's release mechanics upgrade. This aligns with the
PTLC-based async-payments direction Corallo has advocated
([Optech topic](https://bitcoinops.org/en/topics/async-payments/)).

### 13.6 Multiple settlement peers
One epoch per channel; `R` MAY run concurrent epochs on different channels with
disjoint hash sets (each invoice's route hint pins its `S`). Cross-`S` budget
aggregation and payer-side choice are out of scope.

---

## 14. Message and TLV registry (provisional)

| Type | Name | Dir | Signed |
|---|---|---|---|
| 55001 | `ff_init` | R→S | ✍ |
| 55003 | `ff_accept` | S→R | ✍ |
| 55005 | `ff_invoices` | R→S | (invoices individually signed) |
| 55009 | `ff_escape_sigs` | R→S | |
| 55011 | `ff_begin` | R→S | |
| 55013 | `ff_settlement` | S→R, S→T | ✍ |
| 55015 | `ff_reconcile` | R→S | |
| 55017 | `ff_reconcile_ack` | S→R | |
| 55019 | `ff_revoke_batch` | R→S | |
| 55021 | `ff_end` | both | |
| 55023 | `ff_error` | both | |
| — | `ff_release` | T→S | transport-defined |

`channel_reestablish` TLVs: 55001 (epoch state), 55003 (`S`'s catch-up per-commitment
point, iff escapes; §11.1). `ff_accept` TLV 7: `s_htlc_id_base` (§7.2). Feature bits
560/561 (`option_ff_receive`). Liquidity-ads extension TLV for advertised terms: TBD.
All numbers provisional pending bLIP assignment.

Appendices: (A) canonical `C_i^R` construction test vectors — see companion file
`ffor-test-vectors.md`; (B) escape commitment and aggregate voucher script + weights —
below; (C) tower provisioning/authentication wire format — TBD; (D) taproot variant —
TBD.

---

## 15. Prototype plan (beignet ↔ beignet)

Everything below reuses existing beignet machinery: quiescence (splicing), hold
invoices + wake (M2 async payments), commitment building, pre-signed HTLC-success
handling, shachain stores, liquidity ads (M3), and the regtest/bitcoind harness.

1. **M1 — Epoch setup**: messages 55001–55011, FF_SETUP/FF_EPOCH channel states,
   parameter validation, persistence. Gate: epoch established, `R` disconnects, both
   sides restart and recover epoch state.
2. **M2 — Variant A settlement + reconciliation**: package build/verify, deterministic
   `C_i^R`, upstream settle, reestablish TLV, replay, reconcile, revoke batch, voucher
   fulfillment. Gate: payer→`S`→(offline `R`) settles for payer; `R` returns; balances
   correct; full suite green.
3. **M3 — On-chain enforcement**: `R` force-closes `C_j^R` post-return and sweeps all
   vouchers via pre-signed HTLC-success (bitcoind-validated); penalty of `C_{n0}^S`
   from package-1 secret (bitcoind-validated); ChainMonitor/output-resolver
   classification for voucher outputs.
4. **M4 — Tower (Variant B)**: standalone minimal tower (outside beignet core),
   checklist verification, release flow, package serving, breach watch. Gate:
   withholding-`S` chaos test — `R` recovers everything from `T` with `S` gone.
5. **M5 — Escapes**: deterministic escape set, pre-signing, escape broadcast + timeout
   claim + post-reconcile penalty of a stale escape (bitcoind-validated).
6. **M6 — Liquidity integration + chaos**: lease-then-epoch flow, advertised terms TLV,
   splice-on-return; crash matrix at every arrow in §6's diagram; multi-payment epochs
   at `K` and budget boundaries.

---

## 16. Prior art and references

- ZmnSCPxj, *Fast Forwards* — [lightning-dev, April 2019](https://lists.linuxfoundation.org/pipermail/lightning-dev/2019-April/001986.html);
  *Fast Forwards By Channel-in-Channel Construction* — [lightning-dev, October 2021](https://lists.linuxfoundation.org/pipermail/lightning-dev/2021-October/003265.html)
- Lloyd Fournier's offline-receive observation on fast forwards —
  [Bitcoin Optech #152](https://bitcoinmagazine.com/technical/bitcoin-optech-lightning-node-payments);
  popular summary: [Protos](https://protos.com/bitcoin-lightning-dev-fix-existential-problem-offline-crypto-payments/)
- Async payments: Matt Corallo's brainstorm and successors —
  [Bitcoin Optech topic](https://bitcoinops.org/en/topics/async-payments/);
  [BOLT 12 async payments, lightning/bolts #1149](https://github.com/lightning/bolts/pull/1149);
  [proof-of-payment wishlist thread](https://www.mail-archive.com/lightning-dev@lists.linuxfoundation.org/msg03075.html);
  trampoline-hold deployments: [eclair #2424](https://github.com/ACINQ/eclair/issues/2424),
  [Breez Lightning Rod](https://medium.com/breez-technology/introducing-lightning-rod-2e0a40d3e44a)
- bLIP-51 liquidity ads (budget provisioning); BOLTs 2/3/5 (all reused machinery)

FFOR's delta over fast-forwards as previously discussed: the complete delegation and
settlement protocol around the core update (packages, tower gating of preimage release,
the revocation-secret-as-first-preimage evidence binding, uniform-expiry vouchers,
pre-signed granular escapes, and batch reconciliation), such that the payer-side payment
*completes* while the recipient is offline — the property neither hold-based nor
async-payment designs provide.

---

## Appendix B: escape commitments and the aggregate voucher (normative)

### B.1 Deterministic construction of `E_j`

Each escape `E_j` (`j = 1…J`, `J = ceil(budget_msat / G)`) is a standard BOLT 3
commitment transaction **for `S`** at commitment number `n0 + 1` (using `S`'s
per-commitment point for that index, which `R` holds from the last pre-epoch
`revoke_and_ack`), derived from the pre-epoch quiescent state as follows:

1. `S`'s `to_local_msat` is reduced by `j·G`. (The §7.2 budget check —
   `budget ≤ spendable − reserve − G` — guarantees `S` stays at or above
   `channel_reserve` even at `j = J`, where `j·G` may exceed `budget` by up to `G`.)
2. One **aggregate voucher output** of `j·G` msat is added, with the P2WSH witness
   script of §B.2. Because `G` is a multiple of 1000 msat (§10), the output value is
   whole-satoshi with no sub-satoshi remainder; because `G ≥` the voucher dust floor
   (§8), it is never trimmed.
3. The funder pays the commitment-fee delta for the added output (+172 WU, §B.4) at the
   frozen epoch feerate, per BOLT 3.
4. Output ordering, anchors, dust handling, and the obscured commitment-number encoding
   in `nLockTime`/`nSequence` follow BOLT 3 unchanged.
5. If the channel carries a bLIP-51 lease with `S` as lessor, `S`'s `to_local` retains
   its lease CLTV encumbrance on every `E_j` (§11.3). The aggregate voucher (an `R`
   output) is never lease-encumbered.

`R`'s `escape_sigs[j−1]` (§7.4) is its ordinary funding-key ECDSA `SIGHASH_ALL`
signature on `E_j`. Both sides MUST derive the set independently and byte-identically;
`S` MUST verify every signature before `ff_begin`, and MUST refuse the epoch otherwise.

There are **no second-level transactions**: unlike a BOLT 3 offered HTLC, whose timeout
path is a 2-of-2 routed through a pre-signed HTLC-timeout transaction so the CSV
revocation-delay can ride on top of the CLTV, the aggregate voucher applies both
timelocks directly in-script on `S`'s single-sig branch (§B.2). The `escape_htlc_sigs`
field stays empty in v1.

### B.2 Aggregate voucher witness script

P2WSH. `revocationpubkey` is the standard BOLT 3 revocation key for `S`'s commitment
`n0 + 1`; `local_delayedpubkey` is `S`'s delayed-payment key at that per-commitment
point (matching `to_local` semantics); `payment_basepoint(R)` is `R`'s **static**
payment basepoint, untweaked.

```
OP_DUP OP_HASH160 <RIPEMD160(SHA256(revocationpubkey))> OP_EQUAL
OP_IF
    # Path 1 — revocation: R (or its tower) penalizes a revoked escape
    OP_CHECKSIG
OP_ELSE
    OP_NOTIF
        # Path 2 — S refund after voucher expiry, revocation-delayed
        <T_exp> OP_CHECKLOCKTIMEVERIFY OP_DROP
        <to_self_delay> OP_CHECKSEQUENCEVERIFY OP_DROP
        <local_delayedpubkey> OP_CHECKSIG
    OP_ELSE
        # Path 3 — R claim: bare sig, 1-block CSV (anchor pinning rule)
        OP_1 OP_CHECKSEQUENCEVERIFY OP_DROP
        <payment_basepoint(R)> OP_CHECKSIG
    OP_ENDIF
OP_ENDIF
```

Witness stacks (top element last):

| Path | Witness | Tx requirements |
|---|---|---|
| 1 revocation | `<rev_sig> <revocationpubkey>` | none |
| 2 `S` refund | `<S_sig> <>` | `nLockTime ≥ T_exp`, input `nSequence = to_self_delay` |
| 3 `R` claim | `<R_sig> <0x01>` | input `nSequence ≥ 1` |

*Rationale.* The leading `OP_DUP OP_HASH160 … OP_EQUAL` revocation gate is the BOLT 3
offered-HTLC pattern verbatim. The `OP_NOTIF` selector takes exactly `<>` or `<0x01>`,
satisfying the segwit v0 `MINIMALIF` standardness rule (as does the outer `OP_IF`, which
consumes `OP_EQUAL`'s output). Path 3 deliberately mirrors the anchors `to_remote`
output (static key + `1 OP_CSV`): a returning `R` that has lost *all* epoch data can
locate and claim the aggregate voucher from its seed and the funding outpoint alone — no
packages, no per-commitment points, no tower. Path 2 keeps a revoked escape penalizable:
after reconciliation reveals the `n0 + 1` secret, a cheating `S` broadcasting any `E_j`
must still wait `to_self_delay` blocks before sweeping, the standard justice window.

### B.3 Script size

115 bytes, itemized (with `T_exp` as a 3-byte scriptnum — any height up to 8,388,607 —
and `to_self_delay` as a 2-byte scriptnum, its full BOLT 2 range):

| Fragment | Bytes |
|---|---|
| `OP_DUP OP_HASH160 <20> OP_EQUAL` | 24 |
| `OP_IF OP_CHECKSIG OP_ELSE OP_NOTIF` | 4 |
| `<T_exp> OP_CLTV OP_DROP` | 6 |
| `<to_self_delay> OP_CSV OP_DROP` | 5 |
| `<33> OP_CHECKSIG` (path 2 key) | 35 |
| `OP_ELSE OP_1 OP_CSV OP_DROP` | 4 |
| `<33> OP_CHECKSIG` (path 3 key) | 35 |
| `OP_ENDIF OP_ENDIF` | 2 |
| **Total** | **115** |

### B.4 Weights

Commitment-side: the aggregate voucher adds one P2WSH output = `8 + 1 + 34 = 43` bytes
= **172 WU** to `E_j` versus the pre-epoch commitment (fee delta borne by the funder at
the frozen feerate, §B.1 step 3).

Spend-side (worst-case 72-byte DER+sighash signatures; witness serialization includes
the count byte and per-item length prefixes; script push = `1 + 115`):

| Path | Witness WU | Marginal input WU (input 164 + witness) | 1-in/1-out sweep to P2WPKH, total WU (vB) |
|---|---|---|---|
| 3 `R` claim | 192 | 356 | 522 (130.5) |
| 2 `S` refund | 191 | 355 | 521 (130.25) |
| 1 revocation | 224 | 388 | 554 (138.5) |

(Sweep total = 328 WU non-witness for a minimal 1-in/1-out tx — version, counts, a
41-byte input, a 31-byte P2WPKH output, locktime — plus 2 WU marker/flag plus the
witness. The revocation row is the *marginal* cost per escape-voucher input inside a
larger justice transaction; a real penalty sweep amortizes overhead across all of
`E_j`'s outputs.)

### B.5 Consistency requirements

- `S` MUST NOT broadcast any `E_j` except under the §10 conditions (height
  `> D + escape_delay`, reconciliation not begun), and MUST use `j = ceil(owed/G)`.
- `R` and `T` treat *any* `E_j` on-chain after reconciliation as a revoked-state breach
  (path 1), and any `E_j` before reconciliation as an escape to be audited against the
  package history (§12.1).
- Implementations MUST reject `ff_init` where `G > 0` and `G` violates §10's
  multiple-of-1000/dust-floor constraints, or where `J·G − budget ≥ G` (malformed
  granularity).
