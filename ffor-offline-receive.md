# FFOR: Fast-Forward Offline Receive

**Non-custodial offline Lightning payments via delegated settlement and unilateral pre-revoked state handoff**

- Status: Draft v0.9.1 (2026-09-04), hardened by computed test vectors (Appendix A) and
  a **complete M1-M7 prototype** (beignet `feat/ffor`: on-chain enforcement, the
  Variant B tower and its durable store, the full escape lifecycle, bLIP-51 lease
  integration, and a 21-case crash matrix, all gates bitcoind-validated; Appendix B's
  script and weight tables confirmed exact on regtest); wire details below reflect what
  the prototype actually implements, with Appendix C the one exception (see its status
  note)
- **v0.8.1 is an errata release.** It corrects §8's millisatoshi rounding rule to
  BOLT 3's (the previous rule made byte-exact reconstruction fail by one satoshi;
  Appendix A has been regenerated), forbids the §7.2 `H_1` binding in Variant D
  (where it would have handed `R` a free voucher), bounds the escape window against
  `T_exp`, demotes `S`'s reported `last_seq` from authoritative to a lower bound, keeps
  §9.4's role-separation and durability rules alive under §9.5.5, chunks `ff_invoices`,
  domain-separates the signed digest, and removes several dead constructions. See
  §17 for the full list.
- **v0.8.2 defines the amount model** (issue #21). One formula now produces the invoice
  amount, the voucher amount and the amount `S` expects upstream: the payee amount is
  `d_k`, `S`'s compensation is the ordinary forwarding fee of the `S`→`R` hop, published
  to the payer in the route hint or blinded `payment_relay`, and the voucher pays
  exactly `d_k`. Fixed-amount profiles put every `d_k` on the wire under both node-key
  signatures (the mutual binding of each pair to one transcript is #22's), the tower
  verifies a voucher against that precommitted amount rather than against `S`'s report
  of what arrived, and the checks are equalities. Amountless
  operation remains for Variants A and B with an explicitly weaker attestation. See
  §7.6 and §17.2. Appendix A's inputs are restated in the new terms; every commitment,
  txid and signature is byte-identical to v0.8.1.
- **v0.9 specifies the signed lifecycle and the legal Variant D transcript** (issues
  #22 and #23). `ff_begin` and `ff_end` are gone. §7.5 defines a state machine,
  `NEGOTIATING → VOUCHERS_COMMITTED → ACTIVATING → ACTIVE → DRAINING → CLOSED` with
  `ABORTED`, each transition authorized, signed over a chained transcript hash, and
  durable before it is acknowledged: `ff_activate` / `ff_activate_ack` (mutually signed
  activation hash `H_act`), `ff_abort`, `ff_close` / `ff_close_ack`. `ff_accept` now
  commits to `ff_init` (TLV 11). §9.5.1 gives Variant D's one legal BOLT 2 sequence:
  every voucher `update_add_htlc`, both `commitment_signed` and both `revoke_and_ack`
  complete **before** either side sends `stfu`, activation happens under quiescence as
  an FFOR state transition and not a channel update, and the durable `ACTIVE` freeze
  outlives the quiescence that BOLT 2 ends on disconnect. See §17.3.
- **v0.9.1 adds the D-R receipt-witness profile** (issue #24): §9.6 and Appendix F.
  Witnesses `R` chooses on the payment path store an encrypted, signed preimage record
  before they let the payer's success propagate, authorized under per-epoch keys with
  `R`'s node id nowhere, so `R`'s recovery set gains N agents that hold information
  and no money. The claim is stated in full in §9.6.1 with its limits: bounded
  return, every witness learns the preimage, path enforcement only against an honest
  `S`. D1-WR is recorded as deferred (§13.8). §9.7 specifies the BOLT 12 issuer
  for unknown payers, using BOLT 12's own rule that a path-terminal node signs the
  invoice, with exact-slot selection, durable single issuance and refusals that
  reveal nothing about the book (issue #25). See §17.4.
- **New in v0.8: FFOR without a server.** §5.1 removes the *watching* role with a single
  channel-open parameter. §9.5 (**Variant D**) removes the *mediating* role by
  pre-signing the entire voucher book at setup, so `S` sends no message to anyone for the
  whole epoch and `R`'s on-chain claim needs only a preimage, which the payer necessarily
  holds. §12.5 states the bound the two cannot cross, and why no script, covenant or
  taproot construction crosses it either. §13.7 records an invoice-reuse theft vector that
  **no** variant currently closes, confirmed against the reference implementation.
  §5.1's `to_self_delay` direction is confirmed against BOLT 2. Variant D itself is
  unprototyped (M8, §15.2)
- Author: Corey Phillips
- Target: standalone extension bLIP; prototype target beignet ↔ beignet
- License: MIT

---

## 1. Abstract

FFOR lets a Lightning node (the **recipient**, `R`) receive payments that *fully settle
for the payer* while `R` is offline, without giving custody of the funds to anyone.

Before going offline, `R` delegates a bounded settlement authority to one of its direct
channel peers (the **settlement peer**, `S`). When a payment arrives, `S` settles it
upstream immediately (the payer's HTLC clears end-to-end within seconds, exactly like an
online payment) and *simultaneously* credits `R` inside their shared channel by issuing
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
> some online party, in practice the recipient's channel peer. The moment that peer
> releases the preimage it has claimed the inbound HTLC and holds the money. The entire
> design question reduces to: *can the peer's obligation to the recipient be made
> enforceable, atomically with its upstream claim?*

Existing approaches occupy two corners of the design space:

1. **Wake-based hold** (hold invoice + push notification): the peer holds the HTLC and
   wakes the recipient. Trustless and fast, but only handles *dormant* recipients, not
   offline ones, and burns route CLTV budget while held.
2. **Async payments** ([BOLT PR #1149](https://github.com/lightning/bolts/pull/1149),
   [Optech topic](https://bitcoinops.org/en/topics/async-payments/)): the *sender's* LSP
   holds the payment and retries when the recipient signals it is online. Fully
   trustless, preserves recipient-generated preimages, but the payment does not clear
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
- Replacing async payments: FFOR degrades gracefully *to* hold-based flows when its
  budget is exhausted (§11.4).

---

## 3. Roles and terminology

| Term | Meaning |
|---|---|
| `R` | Recipient. Goes offline; owns the invoices; is credited via vouchers. |
| `S` | Settlement peer. Any direct channel peer of `R` implementing this spec. Stays online, settles delegated payments upstream, issues fast-forward updates. |
| `T` | Tower/mailbox. An always-online agent chosen by `R`, used by Variant B and optionally by Variant D (§9.5.5). Holds preimages hostage against valid settlement packages; stores packages; watches for revoked broadcasts. Holds **no funds** and no channel keys (one scoped exception, §9.4). |
| epoch | One contiguous offline window governed by one delegation. At most one active per channel. |
| voucher | The per-payment credit: a received-HTLC output on `R`'s commitment with `cltv_expiry = T_exp`. |
| settlement package | The signed bundle `S` produces per payment: new commitment signature, HTLC signatures, (first package) revocation secret, (Variant A) preimage. |
| escape | A pre-signed `S`-side commitment allowing `S` to exit unilaterally if `R` never returns (§10). |
| `n0` | `S`'s commitment number at epoch start. |
| `n_R` | `R`'s commitment number at epoch start. |
| `T_exp` | Absolute block height at which all vouchers (and escapes) revert to `S`. |
| `D` | Absolute block height after which `S` stops accepting delegated payments (`D + margin < T_exp`). |
| `d_k` | The payee amount for hash `H_k`: what `R` is owed. In the fixed-amount profile it is the invoice amount and the voucher amount (§7.6). |
| `fee_S(a)` | `S`'s forwarding fee for the `S`→`R` hop on a payee amount `a`, BOLT 7's formula (§7.6). Paid by the incoming HTLC on top of `a`, never deducted from the voucher. |
| `H_act` | The activation hash: the mutually signed digest that names one epoch's terms, voucher book and commitment state (§7.5). Every later signed message and every tower or witness record binds to it. |
| `ACTIVE` | The FFOR channel state in which delegated settlement is permitted and ordinary updates are not (§7.5). Durable on both sides; survives disconnect and restart, unlike BOLT 2 quiescence. |

Notation: `C_i^R` is `R`'s commitment transaction after `i` fast-forward updates
(commitment number `n_R + i`); `C_{n0}^S` is `S`'s commitment at epoch start.

**On "LSP":** nothing in this spec distinguishes an LSP from a peer. The requirements on
`S` are: (a) feature support, (b) uptime for the epoch, (c) local balance ≥ budget in the
shared channel, (d) willingness to have that balance progressively converted to vouchers.
Since `R` is offline, the `S`↔`R` channel is unusable for routing during the epoch
anyway, so (d) has near-zero opportunity cost; the fee (§7.1) compensates uptime and
capital lockup. Two beignet nodes can serve each other symmetrically in alternating
epochs.

---

## 4. Trust model overview

| | Variant A (self-contained) | Variant B (tower-mediated) | Variant D (pre-signed book, §9.5) | Variant C (PTLC, future) |
|---|---|---|---|---|
| Preimage origin | `S` | `T` (released against verified package) | `S` (or `T`, §9.5.2) | adaptor-composed `S`+`T` |
| Payment clears for payer | instantly | instantly | instantly | instantly |
| Voucher minted | per payment, by `S`'s signature | per payment, by `S`'s signature | **all `K` at setup**, one stock channel update | per payment |
| `S` broadcasts stale state | penalized (state revoked by first settlement; evidence reaches payer) | penalized (tower holds revocation from package 1) | penalized (pre-epoch state revoked by the setup update) | penalized |
| `S` settles upstream but withholds the credit | **possible**; produces automatic cryptographic fraud proof (§12.2) | **impossible** without `S`+`T` collusion | possible, but `R`'s claim needs **only the preimage**, which the payer necessarily holds (§9.5) | impossible without collusion; collusion also cryptographically evidenced |
| `R` fabricates credit | impossible (`S` signed every voucher) | impossible | impossible while `S` generates the preimages; **possible** if `R`'s tower holds them (§9.5.2) | impossible |
| `R` requirements while offline | none (mailbox recommended) | tower provisioned before epoch | **none** | tower |
| Residual trust | `S`'s fear of provable fraud + penalty | `R`'s own tower (standard watchtower assumption) | 1-of-N availability over `{S, payers, any mailbox}` | minimal |

Variant A suits high-trust pairs (your own second node, a bonded/reputable peer).
Variant B is the recommended default where an always-online agent of `R` is acceptable,
and is the configuration this spec centers. **Variant D is the recommended default where
it is not**: it requires no tower, no mailbox, and no per-payment message of any kind,
at the cost of moving `R`'s recourse from a chosen agent to the payers themselves.
A, B and D share all setup messages and differ only in who generates payment hashes,
when preimages are released, and whether vouchers are minted during the epoch or at
setup.

**D-R** (§9.6) is Variant D plus receipt witnesses `R` chooses on the payment path,
each storing an encrypted preimage record before it lets the payer's success propagate.
It moves `R`'s recovery set from "`S` and strangers" to "`S`, strangers, and N agents of
`R`'s that hold information and no money", and it is the profile this specification
recommends for a wallet that wants a standard-payer offline receive with trustless
funds safety and one-of-N receipt recovery. It does not change either "impossible" cell
above.

The row that matters most is the pair `S settles upstream but withholds the credit` and
`R fabricates credit`: **no variant sets both to "impossible" without an always-online
third party**, and that is a theorem, not an omission. §12.5 gives the argument and
shows why no script, covenant, or taproot construction changes it.

---

## 5. Prerequisites

- The channel MUST use `option_static_remotekey` and `option_anchors` (v1 targets
  ECDSA anchor commitments; simple-taproot channels: see §13.4). `option_anchors` here
  means the current BOLT 2/3 channel type with zero-fee second-level HTLC transactions,
  formerly spelled `option_anchors_zero_fee_htlc_tx`. The superseded
  `option_anchor_outputs` type is not supported, and the spec's dust and weight
  arithmetic assumes it is absent.
- Both nodes MUST support quiescence (`option_quiesce` / as used by splicing).
  Activation happens under quiescence (§7.5), which in Variants A and B is entered
  from a channel with **no pending HTLCs** and no in-flight `update_fee`, and in
  Variant D from a channel whose only HTLCs are the `K` committed vouchers (§9.5.1).
  The activation acknowledgement terminates the quiescence session, inside BOLT 2's
  60-second bound for a quiescent channel with pending HTLCs. Reconciliation in A and
  B runs on a channel that is synchronized by construction (§11.1); Variant D's drain
  is ordinary traffic and needs no quiescence at all.
- Feature bit: `option_ff_receive`, bits **560/561** (provisional, experimental range),
  advertised in `init` and `node_announcement`.
- The commitment feerate is **frozen** for the duration of the epoch at the last signed
  value (`update_fee` is impossible with `R` offline). Anchor outputs make this safe:
  fees are trivial at signing time and attached via CPFP at broadcast time.

### 5.1 `to_self_delay` (RECOMMENDED; REQUIRED for watchtower-free operation)

`R` SHOULD negotiate, at channel open, a `to_self_delay` on `S`'s outputs satisfying

```
to_self_delay_S  >  (T_exp − epoch_start) + safety_margin
```

for the longest epoch it ever intends to run on that channel.

This is the single change that removes the *watching* role from FFOR entirely. Per
BOLT 2, `to_self_delay` is chosen by each node and applies to **the other node's**
`to_local` outputs, so `R` sets `S`'s delay unilaterally at open. With the inequality in
force, `S`'s only revocable state (`C_{n0}^S`, revoked at settlement 1 in Variants A/B
and at the setup update in Variant D) puts `S`'s funds behind a CSV that **outlives `R`'s
entire offline window**. If `S` ever broadcasts it, `R` returns, observes the breach, and
penalizes at leisure. **Nobody has to be watching the chain on `R`'s behalf.** `R`'s
`to_remote` is unaffected (`option_static_remotekey`), and the escape refund path
(Appendix B.2, Path 2) already carries `T_exp` CLTV plus `to_self_delay` CSV, so it
composes without change.

Caveats, in order of importance:

- `to_self_delay` is fixed at channel open and cannot be renegotiated. An FFOR channel
  MUST therefore be opened with its intended maximum epoch length already in mind;
  retrofitting requires a new channel.
- `to_self_delay` is a BOLT 2 `u16`, so the inequality caps a watchtower-free epoch at
  under 65535 blocks (roughly 455 days) even against an `S` that accepts the maximum.
  Real `max_to_self_delay` policies are far tighter, so `R` SHOULD treat the value `S`
  will actually accept as the binding constraint on `T_exp − epoch_start`, and fall back
  to a watching tower when it cannot get one long enough.
- The cost lands on `S`: a slow **unilateral** exit outside epochs. Cooperative close is
  unaffected, and during an epoch `S` already has no unilateral exit except the escape
  (§9.3), so the marginal cost is small. `S`'s `max_to_self_delay` policy must accept the
  value; an FFOR-aware `S` SHOULD.
- `R` MUST still return before `T_exp`, which it must anyway (§12.4 item 4). The margin
  should cover reorg depth plus the time `R` needs to notice and act after reconnecting.

Deployments that prefer a short `to_self_delay` may instead keep a watching tower. §9.4's
chain-watch duty, penalty capability, scoped `revocation_basepoint_secret` sharing,
node-embedded breach-watch, and role-separation rule exist **only** for that case and are
all dead code under §5.1.

---

## 6. Protocol overview

```
R online                        R OFFLINE                          R returns
────────────────┬──────────────────────────────────────────┬────────────────────
                │                                          │
  quiescence    │   payer_i ──HTLC(H_i)──▶ ... ──▶ S       │  reestablish (+ ff TLV)
  ff_init      ─┼─▶                          │             │  ff_close          ─▶
  ff_accept    ◀┼─                           ├─ package_i ─┼─▶ ff_settlement replay ×j
  ff_invoices  ─┼─▶  (D: voucher round)      │  ▼          │  (A/B) ff_reconcile ─▶
  ff_escape_sigs┼─▶ (optional)               │  T verifies │  (A/B) ff_reconcile_ack ◀─
  stfu ×2, then│                             │  releases t_i  (A/B) ff_revoke_batch ─▶
  ff_activate  ─┼─▶  ff_activate_ack ◀─      ▼             │  ff_close_ack     ◀─
                │              S settles upstream instantly│  update_fulfill / fail ×K
                │              payer sees SUCCESS          │  → vouchers become balance
                │              C_i^R gains voucher_i       │  (splice / resume normal ops)
```

Lifecycle: **NEGOTIATING → VOUCHERS_COMMITTED → ACTIVATING → ACTIVE → (settlement × j)
→ DRAINING → CLOSED** (§7.5), with `ABORTED` reachable from every state before `ACTIVE`
and two abnormal exits after it: `R` never returns (escape, §10, or HTLC timeout in
Variant D) or `S` misbehaves (penalty/fraud proof, §12).

The core trick, restated precisely: a channel update that only *increases* the
counterparty's claim can be made unilaterally if the updater first revokes its own
current commitment, because the updater can no longer profit from broadcasting anything.
After fast-forward #1, the only commitment `S` has ever signed is revoked, and `S` holds
no successor, so with `G = 0` it has **nothing broadcastable at all** until `R` returns
and countersigns. With `G > 0` the pre-signed escapes at `n0 + 1` are the one exception:
they are `R`-signed states `S` can complete and broadcast whenever it likes, so §10's
timing rule is protocol policy rather than something script enforces, and §9.3 states
the condition in that form. `R`'s side is unaffected either way: each `C_i^R` it
inherits is strictly better for it than the last, and `R` reveals no secrets until
reconciliation.

---

## 7. Epoch establishment

All new messages use odd types in the custom range (ignorable by non-implementing
peers). All multi-byte integers are big-endian. Each message begins
`[32: channel_id][32: epoch_id]` (omitted from the field tables below). `epoch_id` is
32 random bytes generated by `R`; both sides MUST enforce per-channel uniqueness across
all epochs *including aborted setups* (an `ff_init` that `S` refuses has consumed its
`epoch_id`; `R` picks a fresh one to retry). Messages marked ✍ carry a `signature` field: a
node-key signature over

```
SHA256("ffor/msg" ‖ message_type ‖ body_excluding_the_signature)
```

where `"ffor/msg"` is the 8 ASCII bytes, `message_type` is the 2-byte big-endian
type, and `body_excluding_the_signature` is every byte after the type: the
`[32: channel_id][32: epoch_id]` header, the fixed fields, and the TLV stream. The
digest is signed **directly** (one SHA256, not BOLT 7's double hash), as a 64-byte
compact ECDSA signature with low-S. The TLV stream has no length prefix: it extends
from the end of the last fixed field to the final 64 bytes, uses BOLT 1's BigSize type
and length encoding, and MAY be empty. The tag is normative and is part of what a verifier reconstructs: these
signatures are the whole of §12.2's non-repudiation layer, they are made with the same
node key that signs BOLT 7 gossip and any other node-key surface an implementation
exposes, and domain separation removes the cross-protocol question rather than
requiring an argument about it. §9.4's fetch digest already works this way. The
signature is always the **final 64 bytes of the body**; the TLV stream
therefore sits *before* it (unusual for LN messages, deliberate here): unknown odd TLVs
are permitted in that stream and are covered by the digest. These signatures exist for
**non-repudiation** (fraud proofs, §12.2), since Noise transport authenticates but does
not produce third-party-verifiable evidence.

Signed messages also chain. Each carries, in a fixed field, the transcript hash of what
came before it (§7.5 defines the chain: `T_init`, `T_setup`, `H_act`), so a signature
over a later message is also a commitment to every earlier one, and a §12.2 proof about
any step needs only that step's signed message plus the public digests. "The wire
bytes" of a message, wherever a digest is defined over them, means the complete
message as sent: type, `channel_id`, `epoch_id`, every fixed field, the TLV stream,
and the signature.

### 7.1 `ff_init` (type 55001, R→S) ✍

| Field | Size | Description |
|---|---|---|
| `variant` | u8 | 1 = A (self-contained), 2 = B (tower), 3 = C (PTLC, reserved, §13.5), 4 = D (pre-signed voucher book, §9.5) |
| `budget_msat` | u64 | max cumulative voucher value this epoch. Fixed-amount profile: MUST equal `Σ d_k` (TLV 9) |
| `max_payments` (`K`) | u16 | max number of delegated payments (≤ open HTLC slot budget, §8) |
| `min_payment_msat` | u64 | floor on any voucher amount `v_k` (≥ voucher dust floor, §8). Amountless profile: `S` MUST reject/fall back below it. Fixed-amount profile: every `d_k` MUST be ≥ it, checked at setup |
| `settlement_deadline` (`D`) | u32 | absolute height; no new delegated settlements after |
| `voucher_expiry` (`T_exp`) | u32 | absolute height; all vouchers/escapes revert to `S` after. MUST satisfy `T_exp ≥ D + reconcile_margin` (recommended margin ≥ 1008), and when `G > 0` also `T_exp ≤ D + escape_delay` (§10) |
| `fee_base_msat` | u32 | `S`'s forwarding fee for the `S`→`R` hop, base. This is the fee the payer sees in the invoice route hint or blinded `payment_relay` and adds on top of the payee amount (§7.6); nothing is deducted from the voucher |
| `fee_proportional_millionths` | u32 | same fee, proportional part, in millionths of the payee amount |
| `escape_granularity_msat` (`G`) | u64 | 0 = no escape; else escape step size (§10). MUST be 0 in Variant D, which resolves a vanished `R` through its vouchers' ordinary HTLC-timeout paths and has no escape ladder (§9.5.1) |
| `r_per_commitment_points` | u16 + count×33 | Variants A and B: `count = K`, `R`'s per-commitment points for commitment numbers `n_R+1 … n_R+K`, pre-shared so `S` can build `C_i^R` alone. Variant D: `count` MUST be 0; `S` never builds a commitment for `R` alone, and the one point the voucher round needs it already holds from `R`'s last `revoke_and_ack` |
| TLV 1: `payment_hashes` | K×32 | Variant B only: hashes generated by `R`'s tower |
| TLV 3: `tower_node_id` | 33 | Variant B only |
| TLV 5: `tower_uri` | var | Variant B only: how `S` reaches `T` |
| TLV 9: `voucher_amounts_msat` | K×u64 | fixed-amount profile: `d_1…d_K`, one per hash, in hash-set index order. REQUIRED in Variant D. In Variants A and B its presence selects the fixed-amount profile and its absence the amountless profile (§7.6) |
| TLV 13: `witness_peers` | u16 + count×33 | D-R (§9.6.3): node ids of the peers from which delegated HTLCs may arrive; `S` MUST fail a delegated HTLC arriving from any other peer. Absent: no restriction |
| `signature` | 64 | `R`'s node-key sig (proves `R` requested these terms, including every `d_k`) |

Pre-sharing `R`'s per-commitment *points* is safe: points are routinely disclosed one
step ahead in normal operation, and disclosure of a point reveals nothing about its
secret. `R` MUST NOT reuse these indexes for any other purpose.

TLV rules, by variant: in Variant B (`variant == 2`) TLVs 1, 3 and 5 are all REQUIRED;
in Variants A and D (`variant == 1`, `variant == 4`) all three MUST be absent, because
in those variants `S` generates the hashes and there is no tower to name. `S` MUST
reject an `ff_init` that violates this with `ff_error`. Fee terms are proposed by `R`;
`S` accepts by responding or rejects with `ff_error`. `S` MAY advertise standing terms
out-of-band (§11.3) which `R` simply echoes.

TLV 9 is REQUIRED under `variant == 4` and OPTIONAL under `variant == 1` or
`variant == 2`. When present it MUST carry exactly `K` amounts, each
`≥ min_payment_msat`, each passing the §8 per-voucher checks and the §7.6 bounds at
setup, and summing to exactly `budget_msat`; `S` MUST reject any other TLV 9 with
`ff_error`. The fee fields are `S`'s forwarding fee for the `S`→`R` hop (§7.6), and
`R` publishes them verbatim in every invoice route hint or blinded path it signs for
the epoch. In Variant B the hash set arrives in this message (TLV 1) and TLV 9 pairs
with it by index; in Variants A and D the hashes arrive in `ff_accept` TLV 1 and pair
with this message's TLV 9 by the same index.

### 7.2 `ff_accept` (type 55003, S→R) ✍

| Field | Size | Description |
|---|---|---|
| `s_commitment_number` (`n0`) | u64 | explicit, to anchor evidence |
| TLV 1: `payment_hashes` | K×32 | Variants A and D: `S`-generated. In **Variant A only**, **`H_1` MUST equal `SHA256(per_commitment_secret_S[n0])`** (§12.1). In **Variant D** that binding MUST NOT be used (see below) |
| TLV 7: `s_htlc_id_base` | u64 | the HTLC id `S` assigns to voucher `seq 1`; voucher `seq i` gets id `base + i − 1`. Required: `R` cannot otherwise observe `S`'s offer counter, and reconciliation ends with `j` live HTLCs both sides must address by id. |
| TLV 9: `voucher_amounts_msat` | K×u64 | REQUIRED iff `ff_init` carried TLV 9, and MUST be byte-identical to it, so the amount list is under `S`'s signature as well as `R`'s (§7.6) |
| TLV 11: `init_hash` | 32 | REQUIRED. `T_init = SHA256("ffor/tr/init" ‖ ff_init wire bytes)` (§7.5). `S`'s signature over this message is therefore a signature over `R`'s entire `ff_init`, hashes, amounts and all |
| `signature` | 64 | `S`'s node-key sig (proves `S` accepted budget/fee terms, hash set and, when present, the amount list, and commits to the `ff_init` it answers) |

Requirements:
- `S` MUST verify `budget_msat ≤ spendable local balance − channel_reserve − escape
  rounding slack (G)` and that `K` vouchers fit the commitment weight/slot budget (§8).
  In the fixed-amount profile `S` MUST also run every §8 per-voucher check and the
  §7.6 bounds on each `d_k` now, at setup, because in Variant D every voucher is
  committed before any payment exists and in Variants A and B a slot that would be
  refused at payment time should never be offered to a payer.
- `R` MUST reject an `ff_accept` whose TLV 9 is absent or differs from the one it
  sent, or whose TLV 11 is absent or is not the digest of the `ff_init` it sent. After
  `ff_accept`, `S`'s signature covers both messages (through TLV 11) and `R`'s covers
  `ff_init`; `R`'s signature over the pair arrives with `ff_activate`, which signs
  `T_setup` (§7.5). From activation on, every `(H_k, d_k)` pair is therefore under both
  node-key signatures, and no later message may change it.
- In Variant A, `R` cannot verify the `H_1` binding at setup (it would require the
  secret); it is verified *ex post* at settlement 1 by checking
  `preimage·G == per_commitment_point_S[n0]`. A false binding is detectable, attributable
  (both messages are signed), and grounds to blacklist `S`; see §12.1.
- **In Variant D the `H_1` binding is forbidden, not merely unused.** Variant D's setup
  (§9.5.1 step 2) is a stock BOLT 2 commitment round with `revoke_and_ack` in both
  directions, so `S` hands `per_commitment_secret_S[n0]` to `R` at setup by
  construction. Binding `H_1` to it would give `R` voucher 1's preimage before any
  payment exists, which is exactly the fabrication §9.5.2 forbids and §4/§12.5 record as
  impossible. `S` MUST generate `t_1` as an independent random preimage (or as the
  chain head of §9.5.4), and `R` MUST reject an `ff_accept` under `variant == 4` whose
  `H_1` equals `SHA256` of any secret `S` has revealed **so far**, and MUST re-run the
  check against `per_commitment_secret_S[n0]` when the voucher round's
  `revoke_and_ack` reveals it (§9.5.1 step 4), aborting with reason 3 on a match;
  at `ff_accept` that secret is not yet known to `R`, so the check there is bounded to
  the secrets already held. Nothing is lost: Variant D
  revokes `n0` through the setup `revoke_and_ack` itself, so the evidence channel the
  binding exists to create is already present without it.

### 7.3 `ff_invoices` (type 55005, R→S)

| Field | Size | Description |
|---|---|---|
| `first_index` | u16 | 0-based index of the first invoice in this chunk |
| `total_invoices` | u16 | total across all chunks; identical in every chunk |
| `num_invoices` | u16 | count carried by *this* chunk |
| `invoices` | var | length-prefixed BOLT 11 strings |

**`ff_invoices` is OPTIONAL.** `S` recognises a delegated payment from the hash set
alone (§9.2, §9.5.1) and MUST accept delegated payments whether or not it ever received
the invoices. The message exists only so that `S` can serve invoices to payers on `R`'s
behalf, which is the one distribution configuration §13.7 warns against, and `R`
SHOULD NOT send it unless `S` is deliberately the distributor. Setup completes without
it.

**Chunking (REQUIRED when sent).** A BOLT 8 peer message is capped at 65535 bytes, and a
pre-signed invoice with a route hint runs 300 to 400 bytes, so a single message
overflows around `K = 180`, well below the `K = 483` §8 permits, and nowhere near
§9.5.4's `M(M+1)/2` sets. `ff_invoices` is therefore repeatable: `R` sends as many
chunks as it needs, each self-describing via `first_index`, and `S` MUST treat them as
order-independent and idempotent (a chunk re-sent after a reconnect is applied by
index, not appended). If `R` sends it, setup completes only when `S` holds all
`total_invoices`; a missing chunk at `ff_activate` is grounds for `ff_abort`. Each chunk MUST fit the
peer-message limit.

Common to every variant: payment hash `H_i`, an `expiry` no later than a conservative
wall-clock estimate of `D` (§7.5, "Deadlines"), a route hint `S → R` carrying `S`'s node id, the channel's `short_channel_id` or alias,
`fee_base_msat` and `fee_proportional_millionths` exactly as in `ff_init`, and `S`'s
`cltv_expiry_delta`; `min_final_cltv_expiry` as usual (it binds `S`'s upstream
acceptance, not the voucher); signed by `R`'s node key. Invoices are single-use in every
variant: `S` MUST NOT settle the same hash twice.

**Amount, by profile (§7.6).** In the fixed-amount profile (always in Variant D,
optional in A and B) each invoice is for **exactly `d_k`**, the amount `ff_init` TLV 9
names for its hash. The invoice does not include `S`'s fee: the payer adds `fee_S(d_k)`
when it builds the route, exactly as for any last hop, because the route hint carries
`S`'s fee terms. `R` MUST NOT sign an invoice for `H_k` at any amount other than `d_k`,
and `S` MUST settle only a payment whose `amt_to_forward` equals `d_k`. In the
amountless profile (Variants A and B only) invoices carry no amount, the payer supplies
one, and the voucher pays whatever `S`'s hop payload says to forward, an amount only
`S` attests. Fixed amounts are what make amount attestation exact (§13.3).

**Ordering, by variant.** In Variants A and B the set is **strictly ordered**:
settlement `seq i` carries exactly `H_i` (§9.1), and the §7.2 `H_1` binding requires the
first settled payment to be hash 1, so `S` MUST serve invoice `i+1` only after `i` is
consumed and MUST fail upstream any delegated hash arriving out of order. This makes
`R`-distributed invoices impractical in A and B beyond a single known payer (two payers
holding invoices `1` and `2` must pay in that order), which is one more reason the
strong profiles are Variant D's. Variant D imposes no such order: each voucher is
independently committed and independently settled, so any unconsumed `H_k` may be paid
at any time. The one exception is §9.5.4's hash chain, whose levels are ordered by
construction.

**Distribution.** Who hands the invoice to the payer decides how much of §13.7's reuse
vector exists. Three configurations, in decreasing order of safety:

| Distributor | Reuse requires | Serves unknown payers |
|---|---|---|
| `R` itself, before going offline, one invoice per known payer and order | a payer who received an invoice to initiate a second attempt on it, or to pass it on | no |
| an online distributor that is not `S` (a tower, a receipt witness, or the issuer of issue #25), issuing each slot once | the same, plus the distributor's own Sybil resistance (it cannot tell `S` from a payer) | yes |
| `S` (`ff_invoices` sent) | nothing: `S` holds both the invoices and, after the first settlement, the preimage | yes |

The first two are operational mitigations, not cryptographic closure (§13.7.1). The
third is the attack capability itself and MUST NOT be used with an `S` that `R` does
not otherwise trust with the budget. (BOLT 12 static-invoice integration: §13.2;
unknown-payer issuance: issue #25.)

*Privacy note:* `S` cannot decrypt the final onion hop (it is encrypted to `R`'s node
key), so `payment_secret` is unenforced for delegated payments. This is acceptable:
each hash is single-use and pre-committed, so the probing attack `payment_secret`
prevents does not apply. `S` recognizes a delegated payment purely by matching
`update_add_htlc.payment_hash` against the epoch's hash set; the undeliverable inner
onion is discarded.

### 7.4 `ff_escape_sigs` (type 55009, R→S): optional, iff `G > 0`

The escape set is **deterministic** given the epoch parameters (§10), so no request
message is needed:

| Field | Size | Description |
|---|---|---|
| `num_escapes` (`J`) | u16 | MUST equal `ceil(budget_msat / G)`; `S` rejects any other value with `ff_error` |
| `escape_sigs` | J×64 | `R`'s signature on escape commitment `E_j` for `j = 1…J` |

There are no HTLC signatures here. The aggregate voucher needs no second-level
transaction, because its CLTV and revocation delay are applied directly in-script
(Appendix B.1, B.2).

All `E_j` live at `S`'s commitment number `n0 + 1` (whose per-commitment point `R`
already holds from the last `revoke_and_ack`). They are mutually exclusive alternatives;
at most one may ever be broadcast, and all are killed at reconciliation by revoking index
`n0 + 1` (§9.3, §10).

**Size bound.** The message is `[32: channel_id][32: epoch_id][2: J][J×64]`, so a
BOLT 8 peer message holds at most `J = 1022`. `J = ceil(budget_msat / G)` over two
`u64` fields, so nothing else constrains it: implementations MUST reject an `ff_init`
with `G > 0` whose implied `J` exceeds 1022, at `ff_init` time rather than at
serialization time. Sane deployments sit far below this, since `J` is also the number of
alternative commitments both sides must build and verify before `ff_activate`.

### 7.5 Activation, abort and close: the signed lifecycle (normative)

`ff_begin` and `ff_end` are gone. An epoch has one lifecycle, the same in every variant,
in which every transition is sent by one named party, signed over a transcript hash
that chains to everything before it, and made durable by the receiver before it is
acknowledged. Nothing that matters is ever implied by a disconnect, a timeout, or the
state of BOLT 2 quiescence.

#### 7.5.1 States

| State | Meaning |
|---|---|
| `NEGOTIATING` | `ff_init` sent or received. Nothing is committed. |
| `VOUCHERS_COMMITTED` | Every receiver claim the variant needs before activation exists on both sides. Variant D: the `K` voucher HTLCs are irrevocably committed in **both** commitment views (§9.5.1). Variants A and B: `ff_invoices` (if any) and `ff_escape_sigs` (if `G > 0`) have been exchanged and verified, and in B the tower has acknowledged its provisioning. |
| `ACTIVATING` | `ff_activate` sent (`R`) or received (`S`). Channel is BOLT 2 quiescent. |
| `ACTIVE` | `ff_activate_ack` persisted: by `S` before sending it, by `R` on receipt. Delegated settlement is permitted; ordinary updates are not. Durable on both sides. |
| `DRAINING` | `ff_close_ack` persisted: by `S` before sending it, by `R` on receipt. No new delegated settlement; accepted HTLCs are being fulfilled, failed or expired. |
| `CLOSED` | Every voucher is irrevocably resolved on both commitments (Variant D) or every reconciled voucher has been converted (A, B). Ordinary channel operation resumes. |
| `ABORTED` | Setup ended before `ACTIVE`. Reachable from `NEGOTIATING`, `VOUCHERS_COMMITTED` and `ACTIVATING` only. |

The reachable transitions are `NEGOTIATING → VOUCHERS_COMMITTED → ACTIVATING → ACTIVE →
DRAINING → CLOSED` and `{NEGOTIATING, VOUCHERS_COMMITTED, ACTIVATING} → ABORTED`.
There is no transition out of `ACTIVE` except to `DRAINING`, and none out of
`DRAINING` except to `CLOSED`; a peer that wants out of an active epoch closes it, it
cannot abort it. On-chain enforcement is available from `ACTIVE` and `DRAINING` at any
time and is not a state of this machine: it is what a party does when the machine stalls.

#### 7.5.2 Transcript hashes

```
T_init   = SHA256("ffor/tr/init"   ‖ ff_init wire bytes)
T_setup  = SHA256("ffor/tr/setup"  ‖ T_init ‖ ff_accept wire bytes)
H_book   = SHA256("ffor/book"      ‖ book)                          (§7.5.3)
H_commit = SHA256("ffor/commit"    ‖ n_R^act ‖ txid(C^R at n_R^act)
                                   ‖ n_S^act ‖ txid(C^S at n_S^act))
H_act    = SHA256("ffor/activate"  ‖ T_setup ‖ H_book ‖ H_commit ‖ epoch_start_height)
```

Tags are the ASCII bytes shown, without a terminator. Commitment numbers are `u64`
big-endian, `epoch_start_height` is `u32` big-endian, and txids are in internal byte
order, that is, the byte reverse of the hex every block explorer and `bitcoin-cli`
display. `n_R^act` and `n_S^act` are each side's **current** commitment number at the
moment of activation, that is, after Variant D's voucher round and after any pending
update has been acknowledged (quiescence guarantees this). In Variant D both
commitments carry the `K` vouchers; in A and B they are the frozen pre-epoch base state
(`n_R`, `n0`). `H_commit` is what makes activation a commitment to a specific pair of
transactions rather than to a description of them: two implementations that disagree
on a single output byte disagree on `H_act` and cannot activate.

#### 7.5.3 The voucher book (canonical, not transmitted)

Both sides compute the book from `ff_init` and `ff_accept` alone. It is the canonical
signed entry for every slot that issue #23 asks for; it travels only as `H_book`.

```
entry_k = [2: k][32: H_k][8: d_k][4: T_exp][4: D][8: s_htlc_id_k]
book    = [32: epoch_id][1: variant][1: profile][2: K] ‖ entry_1 ‖ … ‖ entry_K
```

`k` is 1-based and entries are in hash-set index order. `profile` is 1 for the
fixed-amount profile (TLV 9 present) and 0 for amountless, in which case `d_k` is 0.
`s_htlc_id_k = s_htlc_id_base + k − 1` (`ff_accept` TLV 7). `T_exp` and `D` are
`ff_init`'s. The book therefore binds, per slot: identity, hash, amount, voucher
expiry, admission deadline and HTLC id, under the epoch, variant and profile. It is
covered by `H_act`, and so by both signatures.

Requirements on the book, all checked at `ff_accept` and rechecked at `ff_activate`:
`Σ d_k = budget_msat` in the fixed-amount profile; every `d_k` passes §7.6's bounds and
§8's per-voucher checks; `K ≤ R`'s `max_accepted_htlcs`, `K ≤ 483`,
`Σ d_k ≤ R`'s `max_htlc_value_in_flight_msat`; the funder's obligations of §7.6 hold;
and in Variant D `G = 0`.

#### 7.5.4 Messages

All five are signed (✍, §7). Each begins with the standard `[32: channel_id]
[32: epoch_id]` header, then the fields below, then the TLV stream, then the signature.

**`ff_activate` (type 55045, R→S) ✍**

| Field | Size | Description |
|---|---|---|
| `setup_hash` | 32 | `T_setup` |
| `book_hash` | 32 | `H_book` |
| `commit_hash` | 32 | `H_commit` |
| `epoch_start_height` | u32 | current tip as `R` sees it; `S` MUST reject if not within 6 blocks of its own |
| `signature` | 64 | `R`'s node-key sig |

`S` MUST recompute `T_setup`, `H_book` and `H_commit` from its own state and reject the
message with `ff_abort` if any differs. On acceptance `S` computes `H_act`, persists
`ACTIVE` together with `H_act` and the book, and only then sends:

**`ff_activate_ack` (type 55047, S→R) ✍**

| Field | Size | Description |
|---|---|---|
| `activation_hash` | 32 | `H_act` |
| `signature` | 64 | `S`'s node-key sig |

`R` MUST verify `activation_hash` against its own `H_act`, persist `ACTIVE` with it,
and only then treat the epoch as live. **Receipt of `ff_activate_ack` terminates the
BOLT 2 quiescence session** on both sides (a dependent protocol must name its
terminating states; this is one). Together the two messages are the mutually signed
activation transcript: `R`'s signature over the three hashes and `S`'s over their
digest.

**`ff_abort` (type 55049, either direction) ✍**

| Field | Size | Description |
|---|---|---|
| `transcript_hash` | 32 | `T_setup` if `ff_accept` was exchanged, else `T_init` |
| `reason` | u16 | 0 = operator, 1 = timeout, 2 = terms refused, 3 = book mismatch, 4 = commit mismatch, 5 = voucher round failed, 6 = disconnect, 7 = protocol error |
| `data` | u16 + var | free text or evidence |
| `signature` | 64 | sender's node-key sig |

Permitted only before `ACTIVE`. Both sides persist `ABORTED` for the `epoch_id`
(uniqueness tracking, §7) and, if the channel is quiescent, **`ff_abort` terminates the
quiescence session**. In Variant D, an abort after the voucher round leaves `K` real
HTLCs on the channel; §9.5.1 says how they are removed.

**`ff_close` (type 55051, R→S) ✍**

| Field | Size | Description |
|---|---|---|
| `activation_hash` | 32 | `H_act` |
| `signature` | 64 | `R`'s node-key sig |

Permitted in `ACTIVE`. It is the admission stop: on receipt `S` MUST NOT settle any
delegated payment it has not already begun to settle, MUST complete or fail upstream
every delegated HTLC that was irrevocably committed upstream before it processed
`ff_close`, and in Variants A and B MUST then run the reconciliation replay and
handshake of §11.1 (steps 1 to 4). Only then does it send:

**`ff_close_ack` (type 55053, S→R) ✍**

| Field | Size | Description |
|---|---|---|
| `activation_hash` | 32 | `H_act` |
| `num_slots` | u16 | `K` |
| `settled` | ceil(K/8) | bitmap, LSB-first: slot `k` is bit `(k−1) mod 8` of byte `floor((k−1)/8)`, bit 0 the least significant; set iff `S` settled slot `k` upstream (Variants A and B: iff `k ≤ j`). A slot in `SETTLING` (§9.5.1) when `S` processes `ff_close` counts as settled: `S` has already committed to reveal `t_k`, and its preimage MUST be included |
| TLV 1: `preimages` | n × (2 + 32) | **REQUIRED in Variant D** for every set bit: `[2: k][32: t_k]`, in `k` order. Absent in A (preimages travelled in the packages) and B (`R` fetches them from `T`, §11.1 step 6) |
| `signature` | 64 | `S`'s node-key sig |

`S` persists `DRAINING` before sending it; `R` persists `DRAINING` on receipt.
`ff_close_ack` is the last FFOR message of a cooperative epoch and `S`'s signed
statement of which slots were paid. A bit `S` sets without the preimage (Variant D) is
a protocol error. A bit `S` clears for a slot whose preimage `R` later holds from a
witness or a payer is §12.2 evidence, and does not prevent `R` from fulfilling that
slot (§7.5.6).

#### 7.5.5 Transition rules

For every transition: who sends it, what it signs, what MUST be durable before the
acknowledgement leaves, what is allowed on the channel afterwards, and what happens on
replay, disconnect and restart.

| Transition | Sender | Signs | Durable before ack | Channel traffic afterwards |
|---|---|---|---|---|
| `NEGOTIATING → VOUCHERS_COMMITTED` | both (variant-specific, §9.5.1 / §7.3, §7.4, §9.4) | the stock BOLT 2 round (D) or the FFOR setup messages (A, B) | the stock channel state (D); the escape set and tower ack (A, B) | ordinary updates still legal until `stfu` |
| `VOUCHERS_COMMITTED → ACTIVATING` | `R` (`stfu` then `ff_activate`) | `T_setup`, `H_book`, `H_commit` | nothing new on `R` (it may re-send) | none: quiescent |
| `ACTIVATING → ACTIVE` | `S` (`ff_activate_ack`) | `H_act` | `S`: `ACTIVE` + `H_act` + book, before sending. `R`: same, on receipt, before exposing any invoice | delegated settlement (§9.2, §9.5.1) only. No `update_*`, `commitment_signed`, `update_fee`, `stfu`, splice or close negotiation from either side |
| `{NEGOTIATING, VOUCHERS_COMMITTED, ACTIVATING} → ABORTED` | either (`ff_abort`), or implicit on disconnect or timeout, except the acknowledgement-loss window below: an `R` in `ACTIVATING` whose `S` reestablishes `ACTIVE` with a matching `H_act` completes `ACTIVATING → ACTIVE` instead | `T_setup` or `T_init` | `ABORTED` for the `epoch_id` | ordinary; in D the vouchers are failed per §9.5.1 |
| `ACTIVE → DRAINING` | `R` (`ff_close`), acknowledged by `S` (`ff_close_ack`) | `H_act`, then `H_act` + bitmap (+ preimages) | `S`: `DRAINING` + bitmap before sending. `R`: `DRAINING` + ack on receipt | only `update_fulfill_htlc` / `update_fail_htlc` for the vouchers, and the `commitment_signed` / `revoke_and_ack` they need (D); the §11.1 step 6 conversions (A, B). No new `update_add_htlc`, `update_fee`, `stfu` or splice from either side |
| `DRAINING → CLOSED` | implicit: the last voucher irrevocably resolved on both commitments | nothing | `CLOSED` | ordinary |

"Durable" in the table means the complete epoch record, not a flag: parameters,
hash set, amounts, `R`'s pre-shared points, escape signatures and invoice set where
present, the book, the transcript hashes, and (from `ACTIVE`) `H_act`, written so that
a restart with the peer offline can serve every later transition from disk alone. `R`
MUST also have an on-chain sweep destination provisioned before it goes offline; every
unilateral remedy in §11 and §12 needs one.

Replay and idempotency. Every message above MUST be accepted again without effect if
its content is byte-identical to one already processed in the same epoch, and MUST be
rejected as a protocol error if it differs from one already processed for the same
transition (two signed contradictory transitions are §12.2 evidence). `S` MUST
retransmit `ff_activate_ack` whenever `R` reestablishes reporting a state before
`ACTIVE` while `S` is `ACTIVE`, and `ff_close_ack` whenever `R` reports `ACTIVE` while
`S` is `DRAINING` or `CLOSED`. `R` MUST retransmit `ff_close` whenever `S` reports
`ACTIVE` while `R` has sent `ff_close`. There is no retransmission of `ff_activate`
across a reconnect: a disconnect before `ACTIVE` aborts (below), so an `S` that
reestablishes reporting `VOUCHERS_COMMITTED` or `ACTIVATING` has aborted, and an `R`
in `ACTIVATING` proceeds only if `S` reports `ACTIVE` with a matching `H_act` (in
which case `S` retransmits the ack). Within one connection `ff_activate` needs no
retransmission, since the transport is reliable.

Disconnect and restart. Before `ACTIVE`, **a disconnect aborts the setup** on both
sides (reason 6), because BOLT 2 ends quiescence on disconnect and nothing before
`ACTIVE` is worth resuming; a Variant D voucher round survives as ordinary channel
state and is unwound per §9.5.1. The one window that is preserved is
**acknowledgement loss**: `S` persists `ACTIVE` before its `ff_activate_ack` leaves, so
if the connection drops with `S` in `ACTIVE` and `R` still in `ACTIVATING`, `S` MUST
NOT abort (it never aborts from `ACTIVE`), MUST report `ACTIVE` with `H_act` on
reestablish and retransmit the ack, and `R` MUST complete `ACTIVATING → ACTIVE` on
receiving it with a matching `H_act`. An `R` in `ACTIVATING` whose `S` reports
anything else aborts (reason 6). An `R` MUST therefore keep its `ACTIVATING` record
across a disconnect until the reestablish answers, which is the only pre-`ACTIVE`
state a disconnect does not erase. From `ACTIVE` on, the state is durable and a
disconnect changes nothing: `channel_reestablish` carries TLV 55001 (§11.1) with the
state and `H_act`, the two sides compare, and the retransmission rules above resolve
every crash window. The BOLT 2 `next_commitment_number` / `next_revocation_number`
rules apply **unchanged** in Variant D at every state, since it never advances a
commitment number out of band; the §11.1 carve-out is for A and B only. Two `ACTIVE`
peers reporting different `H_act` values have a protocol error: `R` enforces on-chain
(its vouchers are real regardless) and `S` stops settling.

Timeouts. `S` SHOULD abort a setup that has not reached `ACTIVE` within 60 seconds of
`stfu` (reason 1). BOLT 2 independently requires both nodes to disconnect after 60
seconds of quiescence with pending HTLCs, which in Variant D the vouchers are; an
implementation that lets that disconnect fire records the abort as reason 6, and
either reason is conforming. There is no timeout in `ACTIVE`: the epoch ends by `ff_close`, by `T_exp`
(after which `S` resolves unclaimed vouchers on-chain), or by enforcement.

Towers and witnesses. Any tower (§9.4, §9.5.5) or receipt witness (issue #24) that
`R` provisions for the epoch MUST be given `H_act` and MUST acknowledge it, and `R`
MUST NOT expose an invoice until every such acknowledgement is in hand. A tower or
witness MUST refuse a settlement package or receipt record that does not name the
`H_act` it acknowledged. At `ff_close_ack` the active-settlement state of every tower or
witness is closed explicitly by `R` (a signed `H_act` plus the bitmap is sufficient
notice); retention for audit and recovery MAY extend beyond that, but service of new
releases MUST NOT.

#### 7.5.6 Invoice exposure, deadlines and simultaneity

`R` MUST NOT expose an invoice for any slot until all of the following hold: the slot's
voucher is irrevocably committed (`VOUCHERS_COMMITTED`); `S` has durably accepted the
final terms (`ff_accept` received and `T_setup` fixed); `R` holds `S`'s signed
`ff_activate_ack` and has persisted `ACTIVE`; and every provisioned tower or witness has
acknowledged `H_act`. An invoice exposed earlier is an invoice an honest `S` will not
settle and a witness will not record.

Deadlines, all in one place:

- `D ≤ T_exp − claim_margin`, with `claim_margin ≥ reconcile_margin` (§7.1, recommended
  `≥ 1008` blocks; `T_exp − D = 1008` exactly is therefore conforming): `R` needs time after admission stops to return, drain, or enforce.
- Every invoice `expiry` MUST be no later than a conservative wall-clock estimate of
  height `D`. "Conservative" means erring early: an implementation MUST assume no more
  than 8 minutes per remaining block and SHOULD subtract a further margin. An
  unconsumed invoice therefore never outlives the voucher backing it.
- `S` MUST NOT begin a delegated settlement once **any** of these holds: its tip is at
  or past `D`; the upstream HTLC's `cltv_expiry` is within `S`'s safety delta of the
  tip (§8); it has processed `ff_close`; it is not `ACTIVE`. `S` MUST stop early enough
  that every upstream and receiver-claim margin survives, and MAY stop before `D` for
  that reason.
- A delegated HTLC that was irrevocably committed upstream before `S` observed the
  stopping condition is settled or failed on its merits and appears in the
  `ff_close_ack` bitmap; one committed after is failed upstream. The bitmap is final.
- A payment arriving before `ACTIVE`, or after admission closed, is failed upstream
  (§8's failure encoding; `invalid_onion_blinding` under a blinded path).

Simultaneity is resolved by `S`'s processing order, which is serial (§9.2): whichever
of "delegated HTLC irrevocably committed", "`ff_close` processed", "tip reached `D`"
`S` observes first wins, and `S` MUST persist that observation before acting on it so a
crash cannot reorder them. `R` MUST tolerate either outcome: a slot may be settled up
to the instant `S` processed `ff_close`, and `R` learns which from the signed bitmap.

Draining, Variant D (§9.5.1 gives the mechanics): after `ff_close_ack`, `R` fulfils
every slot for which it holds a preimage (from the ack, a witness, or a payer) and
fails every slot the ack marks unsettled for which it holds none. `R` MUST NOT fail a
slot for which it holds a preimage, whatever the bitmap says, and MUST NOT fail a slot
the ack marks settled. A slot `R` can neither fulfil nor fail stays pending until
`T_exp`, when `S` resolves it on-chain. `CLOSED` is reached when no voucher remains in
either commitment. Draining, Variants A and B: §11.1 step 6.

---

### 7.6 Amounts and fees (normative)

Three amounts exist for every delegated payment, and earlier drafts conflated at least
two of them. They are defined here once and used by these names everywhere else.

| Symbol | Meaning | Who fixes it |
|---|---|---|
| `d_k` | the **payee amount**: what `R` is owed for hash `H_k`. The invoice amount and the voucher amount | `R`, in `ff_init` TLV 9 (fixed-amount profile); the payer, in the amountless profile |
| `fee_S(d_k)` | `S`'s **forwarding fee** for the `S`→`R` hop | the `ff_init` fee fields, signed by both sides |
| `gross_into_S(d_k)` | what the payer's HTLC must deliver to `S`: `d_k + fee_S(d_k)` | derived |
| `upstream_route_amount` | what the payer sends from its own node: `gross_into_S` plus the fees of every hop before `S` | the payer; invisible to this protocol |

```
fee_S(a)         = fee_base_msat + floor(a * fee_proportional_millionths / 1000000)
gross_into_S(a)  = a + fee_S(a)
```

`fee_S` is BOLT 7's forwarding fee formula with integer division, evaluated on the
**payee amount**, never on the incoming HTLC amount. `S`'s compensation is therefore the
ordinary fee of the last hop, published to the payer in the invoice's route hint
(BOLT 11 `r` field) or in the blinded path's `payment_relay` (BOLT 4), and the payer
adds it when it builds the route exactly as it would for any last hop. Nothing is
deducted from the voucher. This is the only fee `S` earns per payment: an
implementation MUST NOT also skim the voucher, and MUST NOT charge the fee twice by
placing it both in the route hint and in the invoice amount.

**What `S` reads.** `S` decrypts its own onion hop payload as any forwarding node does,
and never needs the final hop payload, which is encrypted to `R` (§7.3). How it learns
the amount the payer intends `R` to receive depends on the invoice type:

- Under a BOLT 11 invoice the `S`→`R` hop is a plaintext route hint (`r` field) and
  `S`'s payload carries `amt_to_forward` in the clear.
- Under a BOLT 12 invoice the `S`→`R` hop is inside a blinded path. `S`'s payload
  carries `encrypted_recipient_data` with `payment_relay`, not a plaintext amount, and
  `S` MUST derive `amt_to_forward` from the incoming `amount_msat` by BOLT 4's inverse
  formula: `amt_to_forward = ((amount_msat − fee_base_msat) · 10^6 + 10^6 +
  fee_proportional_millionths − 1) / (10^6 + fee_proportional_millionths)`, integer
  division, with the `ff_init` fee terms as the relay values. For a payer that
  delivers exactly `gross_into_S(d_k)` this yields `d_k` exactly (the ceiling absorbs
  the floor in `fee_S`); the payer, however, prices the path from the aggregated
  `blinded_payinfo`, whose BOLT 4 construction rounds up at every step, so it can
  deliver a few millisatoshi more (see "Blinded paths" below for the bound).

In both cases `S` compares the derived `amt_to_forward` with `amount_msat`.

**Fixed-amount profile** (`ff_init` TLV 9 present; always in Variant D). Before
settling a delegated payment on `H_k`, `S` MUST verify, in addition to §8:

1. `amt_to_forward == d_k` under a plaintext route hint: equality, not `≥`. Under a
   blinded path, `d_k ≤ amt_to_forward ≤ d_k + rounding_slack(d_k)`, the slack being
   the bound on BOLT 4's aggregation rounding given below, and nothing more. A payer
   that overpays the payee amount beyond that is failed, not partially credited: the
   voucher for `H_k` pays exactly `d_k`, and a surplus would be value the invoice
   represented as `R`'s credit that `R` cannot claim. A payer that underpays is failed
   as BOLT 4 requires of a final node. BOLT 4 lets a final node reject any amount
   above what it expected; `S` exercises that choice on `R`'s behalf for the one
   amount `R` signed for, and a conforming payer paying a fixed-amount invoice never
   triggers it. Surplus inside the slack is fee rounding and belongs to `S`.
2. `amount_msat − amt_to_forward ≥ fee_S(d_k)`. Any excess over `fee_S(d_k)` is fee
   overpayment the payer chose and belongs to `S`, exactly as for any forwarding
   node. It is never `R`'s credit and no message represents it as such. Under a
   blinded path a conforming payer satisfies this by construction of the inverse
   formula.

Failure encoding follows BOLT 4 for the hop type. Under a plaintext route hint `S`
fails as the erring forwarding node (§8): `temporary_node_failure` for check 1,
`fee_insufficient` reporting the `ff_init` fee terms as the outgoing channel's setting
for check 2. Under a blinded path `S` MUST return `invalid_onion_blinding` for every
failure, as BOLT 4 requires of a blinded hop, and MUST NOT leak which check failed.

The voucher then pays `v_k = d_k`. `R` MUST NOT sign an invoice for `H_k` at any amount
other than `d_k`. `T` (§9.4) MUST verify `voucher_amount_msat == d_k` against the
amounts in its provisioning bundle, never against the `htlc_amount_msat` `S` reports,
and `R` on return MUST verify the same. A package whose voucher amount differs from
`d_k` by any amount, including one millisatoshi, MUST be refused as invalid.

**Amountless profile** (Variants A and B only, TLV 9 absent). Invoices carry no amount.
`S` MUST verify `amt_to_forward ≥ min_payment_msat`, the §8 dust floor on
`amt_to_forward`, the cumulative budget, and
`amount_msat − amt_to_forward ≥ fee_S(amt_to_forward)`, and then mints a voucher of
`v_k = amt_to_forward`. The package's `htlc_amount_msat` and `voucher_amount_msat` are
then **`S`'s own report**: `T` and `R` can check that the two are consistent with
`fee_S` but cannot check either against what actually arrived, because neither observes
the upstream HTLC. An `S` that reports a smaller `amt_to_forward` than the payer sent
keeps the difference, and the only evidence is the payer's receipt, which in this
profile states no amount either (§12.1, §13.3). The amountless profile therefore proves
`S`'s **promise**, not what **arrived**. A deployment that wants the stronger guarantee
MUST use fixed amounts; §12.4 lists this as a weakness of the amountless profile only.

**Rounding.** `fee_S` uses integer division. A payer that rounds the proportional part
up, as most do, overpays the fee by less than one millisatoshi and passes check 2. The
payee amount `d_k` is a millisatoshi quantity; its commitment output is
`floor(d_k / 1000)` satoshis per §8, the sub-satoshi remainder raises the commitment
fee, and `R`'s in-channel credit at reconciliation is the full `d_k`. On-chain
enforcement therefore recovers `floor(d_k / 1000)` satoshis, and an `R` sizing slots
SHOULD choose whole-satoshi `d_k` where the difference matters.

**Bounds.** `fee_base_msat` and `fee_proportional_millionths` are `u32`, so `fee_S` is
never negative and `gross_into_S(d) ≥ d`, with equality exactly when `fee_base_msat`
is 0 and `d · fee_proportional_millionths < 10^6` (the proportional part floors to 0). Implementations
MUST evaluate `d * fee_proportional_millionths` without overflow: in 128-bit arithmetic,
or after checking `d ≤ floor((2^64 − 1) / fee_proportional_millionths)`. At setup, `S`
and `R` MUST reject with `ff_error` any `d_k` for which that product or
`gross_into_S(d_k)` exceeds `2^64 − 1`, any `d_k` below the channel's
`htlc_minimum_msat`, any set whose sum exceeds `max_htlc_value_in_flight_msat` or
whose count exceeds `max_accepted_htlcs`, and any `d_k` whose output would trim (§8).
In the fixed-amount profile these are setup-time rejections, never payment-time ones.

**Reserve, weight and the fee-spike buffer.** The fixed-amount profile commits `Σ d_k`
at setup (Variant D) or bounds it by `budget_msat` (A and B). Two obligations are
distinct and combine only when `S` is the funder (BOLT 3 charges the base commitment
fee and both anchors to the funder, whoever that is):

- `S`, as the party whose balance the vouchers come out of, MUST hold
  `budget_msat + S's channel_reserve` spendable.
- The **funder**, whichever side that is, MUST additionally hold above its own reserve
  the commitment fee for the base transaction plus `K` HTLC outputs (172 weight units
  each), evaluated at **twice the frozen `feerate_per_kw`**, plus both anchors (a fixed
  330 sat each, which do not scale with the feerate): `fee(2 · feerate, K) + 660 sat`. This is
  BOLT 2's fee-spike buffer, made mandatory rather than recommended: the vouchers
  stay live for the whole epoch and past `T_exp`, `update_fee` cannot run while `R` is
  offline, and a funder that reserved only the frozen fee could be unable to add the
  first HTLC after reconciliation, or to afford a force-close, if fees doubled in the
  meantime. When `R` is the funder this is the check §8 already requires against the
  funder identity recorded at setup, with the buffer added.

Both are checked at `ff_accept` in the fixed-amount profile, since Variant D adds every
voucher before any payment.

**Blinded paths.** A BOLT 11 invoice carries plaintext route hints and cannot carry
blinded-path fields; blinded paths are a BOLT 12 invoice feature. There the payer
sees one aggregated `blinded_payinfo` for the whole blinded portion, computed by the
path's creator from the per-hop `payment_relay` values with BOLT 4's formulas, which
round **up** at every step. `S`'s own `payment_relay` carries exactly `fee_base_msat`
and `fee_proportional_millionths` from `ff_init`; receipt-witness hops (a separate
profile) add their own relay values the same way, and none of them changes `d_k`.

The rounding is why check 1 has a slack under blinded paths. With `N` blinded hops up
to and including `S`: each of the `N − 1` aggregation steps adds less than 1 msat of
base fee and less than 1 ppm of proportional fee; the payer's own rounding of the
proportional fee adds less than 1 msat; and each hop's ceiling in the inverse formula
adds less than 1 msat to what it forwards. The inverse formula passes an excess
through at most undiminished, so the amount reaching `S`'s derivation exceeds `d_k` by
less than `2·N + ceil(N · d_k / 10^6)` msat. This version fixes

```
N = 8
rounding_slack(d) = 2·N + 1 + ceil(N · d / 1000000) = 17 + ceil(d / 125000)  msat
```

and `R` MUST NOT sign an invoice whose blinded path has more than `N` hops before and
including `S`. The slack is sub-satoshi below `d = 125` sat and below one part in
`125,000` of `d` above it; it is `S`'s, as fee rounding is for any blinded hop, and an
`R` that prices to the millisatoshi MAY fold the expected rounding into `d_k`.

**MPP.** This version forbids MPP for delegated payments (§13.1). If a later version
enables it, `total_msat` across parts MUST equal `d_k` and check 1 applies to the sum,
not to each part.

**Attestation.** After a fixed-amount settlement, four parties can each prove a
different thing. The payer holds `R`'s signed invoice for `d_k` and the preimage: proof
that `R`'s signed request for exactly `d_k` was paid. Whether that is also proof that
`R` holds an *enforceable* claim for `d_k` depends on the variant: yes in Variant D,
where the voucher and its HTLC-success signature exist from setup; yes in Variant B,
where `T` held the verified package before the preimage left it; in Variant A only once
the package for that settlement has reached `R` or its mailbox, since `R`'s on-chain
claim needs `S`'s signature on `C_i^R` (§13.3). `S` holds the signed `ff_init` and
`ff_accept`: proof that `R` requested and `S` accepted `(H_k, d_k)` (subject to the
pairing caveat in §7.2). `T` (Variant B) or `R` (on return) holds the package: proof
of `S`'s promise to credit `d_k`. Nobody except `S` and the payer holds proof of what
arrived at `S`, and the fixed-amount profile is designed so that nobody needs it.

Arithmetic vectors for `fee_S` and `gross_into_S`, including the rounding, dust and
overflow boundaries, are in Appendix A.5 (`ffor-test-vectors.md`).

---

## 8. The voucher commitment `C_i^R`

`C_i^R` is a standard BOLT 3 commitment transaction for `R` at commitment number
`n_R + i`, built by `S` alone, defined **deterministically** so that `R` and `T` can
reconstruct it byte-for-byte from the epoch parameters plus the settlement history:

- Base state: the last co-signed pre-epoch state (balances, no HTLCs; quiescence
  guarantees this), at the frozen feerate.
- Per-commitment point: `r_per_commitment_points[i]`.
- Vouchers `1…i`: each voucher `k` is a **received HTLC** (from `R`'s perspective,
  offered by `S`) with:
  - `amount_msat = v_k`, the voucher amount of §7.6: `d_k` in the fixed-amount
    profile, or `S`'s hop-payload `amt_to_forward` in the amountless profile. `S`'s
    fee is paid by the incoming HTLC on top of `v_k` and never appears here
  - `payment_hash = H_k`
  - `cltv_expiry = T_exp` (uniform for the epoch)
- `S`'s `to_local` is reduced by `Σ v_k` (plus per-HTLC commitment weight fee, borne by
  the funder per BOLT 3, deterministic at the frozen feerate). Millisatoshi rounding is
  BOLT 3's, and BOLT 3's rule is **floor everything, keep nothing back**: the offerer's
  balance is reduced by the *full millisatoshi* `v_k`, each voucher output is
  `floor(v_k / 1000)` satoshis, and `to_local` / `to_remote` are likewise floored from
  their millisatoshi balances. The truncated sub-satoshi remainders are not returned to
  the offerer; they raise the commitment transaction's on-chain fee above the BOLT 3
  base fee. This is normative, since `R` and `T` must reconstruct `C_i^R` byte-exactly,
  and it is the single easiest place to diverge by one satoshi and reject an otherwise
  valid `commitment_sig`.
- Output ordering, dust trimming, anchors: exactly per BOLT 3. Note that BOLT 3 output
  order is **not** voucher sequence order (vouchers sort by amount/scriptpubkey like any
  output); anything keyed "per voucher" on the wire maps by commitment output index, not
  by `seq`.

Constraints `S` MUST enforce before accepting delegated payment `i`:

- `v_i ≥ min_payment_msat`, the incoming HTLC pays `fee_S(v_i)` on top of `v_i`
  (§7.6), and `v_i` is above the voucher dust floor, which is exactly `dust_limit`: §5 mandates `option_anchors`, whose second-level HTLC
  transactions are zero-fee, so the fee term BOLT 3's trim rule would otherwise add is
  always zero for a channel this spec permits. A trimmed voucher would be
  uncollectible on-chain. The floor
  guarantees only that the output *exists*, not that it is economically enforceable: a
  near-floor voucher cannot pay for its own second-level claim plus CSV sweep, making
  it collectible only cooperatively. `R` SHOULD size `min_payment_msat` against
  expected on-chain enforcement cost at realistic feerates, not against the trim floor.
- `Σ_{k≤i} v_k ≤ budget_msat`; `i ≤ K`, where `K ≤ R`'s `max_accepted_htlcs` and
  `K ≤ 483`. Vouchers are always `S`-offered, and per BOLT 2 `max_accepted_htlcs` bounds
  what the *remote* node may offer, so it is `R`'s value that binds them (both during
  the epoch and after reconciliation, when the same HTLCs appear on `S`'s commitment
  still offered by `S`). `S`'s own `max_accepted_htlcs` constrains what `R` offers `S`
  and does not apply. Vouchers must also stay within `max_htlc_value_in_flight`
  semantics, since they occupy real HTLC slots and weight.
- `S`'s post-update balance ≥ `S`'s `channel_reserve`, and, **when `R` is the
  funder**, `R`'s post-update balance ≥ `R`'s `channel_reserve` after the per-voucher
  commitment weight fee and the §7.6 fee-spike buffer are charged to it. When `S` is
  the funder `R`'s balance is unconstrained (it may be zero, as for any acceptor that
  has not yet received), exactly as BOLT 2 constrains only the party that pays fees.
  When `R` is the funder this is not a formality: each voucher adds 172 WU of
  commitment fee to `R`'s side, so `R`'s balance falls as its credit rises, and `R` is
  offline and cannot object. `S` MUST run the check against the funder identity
  recorded at setup, not against itself.
- Current height `< D` and `< upstream cltv_expiry − S`'s safety delta.

On failure of any check, `S` MUST NOT settle: it either fails the upstream HTLC
(`temporary_node_failure`) or falls back to hold-and-wake if separately supported
(§11.4). Failure construction is standard BOLT 4 with `S` as the erring node, using
`S`'s own hop shared secret: `S` decrypted its own onion layer normally; only the
*next* onion (addressed to `R`) is opaque to it.

Byte-accurate test vectors for this construction (`C_0…C_3`, three settlements,
computed and independently verified against a real BOLT 3 implementation) are in the
companion file `ffor-test-vectors.md` (Appendix A), with a reproducible generator under
`tools/`.

**Why an HTLC and not a balance increase?** Three reasons. (1) *Expiry*: the timeout
branch returns the funds to `S` at `T_exp` if `R` never comes back; without it, `S`'s
funds would be hostage to a vanished peer forever. (2) *Machinery reuse*: signatures,
second-level transactions, on-chain resolution, and reconciliation-time conversion via
`update_fulfill_htlc` are all stock BOLT 2/3/5; a beignet prototype touches no
commitment-format code. (3) *Crash-ordering safety*: the hash-lock means a package that
leaks before the upstream claim completes does not by itself let `R` take value `S`
never received (§9.2 ordering makes this window `S`-safe in Variants A and B).

---

## 9. Settlement

### 9.1 `ff_settlement`, the settlement package (type 55013, S→R and S→T) ✍

| Field | Size | Description |
|---|---|---|
| `seq` (`i`) | u16 | 1-based, strictly sequential |
| `payment_hash` | 32 | MUST equal `H_i` |
| `htlc_amount_msat` | u64 | the incoming `update_add_htlc.amount_msat`, as `S` reports it; no other party can verify it (§7.6) |
| `voucher_amount_msat` | u64 | `v_i`. Fixed-amount profile: MUST equal `d_i`. Amountless profile: MUST equal `S`'s hop-payload `amt_to_forward`. In both, `htlc_amount_msat − voucher_amount_msat ≥ fee_S(voucher_amount_msat)` (§7.6) |
| `r_commitment_number` | u64 | `n_R + i` |
| `commitment_sig` | 64 | `S`'s signature on `C_i^R` (BOLT 2 compact 64-byte encoding, as in `commitment_signed`) |
| `num_htlc_sigs` | u16 | = i |
| `htlc_sigs` | i×64 | `S`'s signatures (compact encoding) for the HTLC-success spend of **every** voucher output on `C_i^R`, in BOLT 3 commitment **output-index order** (not voucher `seq` order, §8), using `SIGHASH_SINGLE|ANYONECANPAY` and anchor rules |
| TLV 1: `revocation_secret_n0` | 32 | **REQUIRED in `seq == 1`, Variants A and B**: `per_commitment_secret_S[n0]`. This is the *pre-revocation*: from this moment `S` has no broadcastable state. |
| TLV 3: `preimage` | 32 | Variant A only: `P_i` |
| TLV 5: `upstream_scid` | 8 | optional, audit |
| `signature` | 64 | `S`'s node-key sig over the package (the fraud-proof anchor: `S` provably committed to crediting `v_i` against `H_i`) |

Every package re-signs the *entire* voucher set, so possession of package `i` alone (plus
epoch parameters) suffices to broadcast `C_i^R` and claim all `i` vouchers; `R` does not
need packages `1…i−1` to enforce, only to audit.

### 9.2 Settlement procedure

On `update_add_htlc` from any upstream peer with `payment_hash ∈ {H_1…H_K}` (matched on
the HTLC itself; the inner onion is undecryptable and discarded), after the upstream
HTLC is irrevocably committed and all §8 checks pass:

**Variant A** (`S` knows `P_i`):
1. `S` durably persists the package, delivers it to `R`'s mailbox if one was provided
   (SHOULD, though no normative mailbox transport is defined in v0.x; reconciliation
   replay is the only in-protocol delivery path, and the mailbox interface is deferred
   to Appendix C), then
2. settles upstream with `update_fulfill_htlc(P_i)`.

**Variant B** (`T` knows `t_i`):
1. `S` durably persists the package and sends it to `T`.
2. `T` runs the verification checklist (§9.4). On success `T` durably stores the package
   **before** replying `ff_tower_release_resp {seq, preimage t_i}` (transport in
   Appendix C).
3. `S` settles upstream with `t_i`.

The order makes both parties safe: `S` acquires the preimage exactly when the package is
committed at `T`, and possession of the preimage lets `S` enforce its upstream claim
on-chain even if the upstream peer force-closes mid-settle. Conversely `R`'s credit is
in `T`'s custody (data, not funds) before the money moves. `S` MUST treat packages as
idempotent by `seq` for crash-replay, and MUST process delegated payments strictly
serially.

`payment:received`-equivalent proof for the payer is unchanged: preimage + `R`-signed
invoice. In the fixed-amount profile that receipt states `d_k` and is exact; in the
amountless profile it attests no amount (§13.3).

### 9.3 What `S` can no longer do

After settlement 1, `S`'s only ever-signed commitment (`C_{n0}^S`) is revoked and `S`
holds no successor (that would need `R`'s signature). Consequences, by design:

- `S` MUST NOT broadcast anything except a pre-signed escape (§10).
- `S` cannot force-close to collect voucher timeouts before reconciliation; the escape
  path is its only unilateral exit.
- Subsequent settlements reveal no further commitment secrets; index `n0` was the only
  live state. (In Variant A, `P_1 = per_commitment_secret_S[n0]` makes the upstream
  claim of payment 1 *itself* the act of revocation; see §12.1. `P_{2…K}` are ordinary
  random preimages; nothing remains to revoke.)

**Classification rule (normative, and easy to get wrong):** after the pre-revocation,
`S`'s bookkeeping still calls index `n0` its *current* commitment. A node MUST treat
any counterparty commitment **whose revocation secret it holds** as revoked, regardless
of commitment-number comparisons. Standard BOLT 5 implementations that decide
revoked-vs-current by index alone will misclassify this breach as a current-state close
and never penalize it. (Empirically hit by the reference implementation's resolver;
fixed by consulting the secret store in both the number-match and equal-number
disambiguation branches.)

### 9.4 Tower requirements (Variant B)

Provisioning (by `R`, before `ff_init`; transport in Appendix C): epoch parameters,
channel static parameters (funding outpoint, both funding pubkeys, **`S`'s node id**
(the packages carry `S`'s node-key signature, unverifiable without it), **`R`'s node
id** (Appendix C.2 gates every operation on it, and the §9.4 role-separation rule tests
it, and `T` cannot learn it any other way before the epoch exists), both parties'
basepoints, `dust_limit`, `to_self_delay`, frozen feerate, **channel type, both
channel configs** (reserve / max-in-flight / HTLC-slot limits; the §8 checks need
them), **`R`'s channel role** (opener vs acceptor fixes the commitment layout), the
**pre-epoch balances and both commitment numbers** (deterministic `C_i^R`
reconstruction starts from them), the **funder identity and both sides'
`to_self_delay`**, and, when escapes are in use, **`S`'s
`per_commitment_point[n0 + 1]`** (escape recognition needs the aggregate-voucher
script, §10/§B.2)), `R`'s pre-shared per-commitment points, the hash list with
preimages `t_1…t_K`, the voucher amounts `d_1…d_K` when the epoch uses the
fixed-amount profile (§7.6), and `S`'s `per_commitment_point[n0]`. The hash set
travels `T → R` during provisioning and `R` commits it on the wire in `ff_init` TLV 1;
if `R` generates the preimages instead, it hands them to `T` here; either way `T`
holds all preimages and `R` is the one that binds the hashes into the epoch.

Verification checklist before releasing `t_i`. `T` MUST verify:
1. `seq == last_released + 1`; `payment_hash == H_seq`; height `< D`.
2. Fixed-amount profile: `voucher_amount == d_seq` from the provisioning bundle,
   refusing any difference including one millisatoshi. Amountless profile:
   `voucher_amount ≥ min_payment_msat`. Both:
   `htlc_amount − voucher_amount ≥ fee_S(voucher_amount)` and cumulative
   `Σ v ≤ budget_msat`. `T` MUST NOT derive the expected voucher amount from
   `htlc_amount`, which is `S`'s unverifiable report (§7.6).
3. Deterministic reconstruction of `C_i^R` (§8) succeeds; `commitment_sig` verifies
   against `S`'s funding pubkey; every `htlc_sig` verifies against `S`'s `htlc_pubkey`
   derived at `r_per_commitment_points[i]`.
4. If `seq == 1`: `revocation_secret_n0 · G == per_commitment_point_S[n0]`.
5. Package stored durably. Only then release `t_i`. "Durably" means the store commit is
   **fsync-backed before the preimage is returned**, power-loss durable, not merely
   written to an OS buffer, since a preimage released against a package that a crash
   then loses is exactly the §9.4 loss.

Restart contract (normative: a durable tower must survive process restart with `R`
offline the whole time, so it cannot rely on `R` re-supplying anything):
- `T` MUST persist the **full provisioning bundle**: preimages `t_1…t_K`, channel
  static parameters (§9.4 list), both sides' basepoints/configs, `S`'s per-commitment
  points at `n0` and (if escapes) `n0 + 1`, and any option-(a) scoped revocation secret
  + sweep script, not merely the settlement record. `R` is offline across the restart
  and cannot re-provision, so a tower that persisted only `last_released` + the packages
  would come back unable to verify new packages or release their preimages.
- On restart `T` MUST rehydrate **every** persisted epoch (a tower serves many) and,
  with no `R` involvement, continue to: (a) serve released preimages idempotently by
  `seq`; (b) **reject a differing package for an already-released `seq`** (the two
  signed copies are §12.2 evidence); and (c) verify and release the *next* `seq`, which
  requires the rehydrated provisioning, not just the record.

Release semantics: `ff_tower_release_resp` MUST be **idempotent by `seq`** (an `S` that crashes
after the tower stored-and-released but before fulfilling upstream re-requests the same
`seq` and gets the same `t_i`). On rejection or non-response, `S` MUST fail the payment
upstream: it has no preimage and no other safe move.

Ongoing duties:
- Serve stored packages and preimages to `R` on authenticated request: signature from
  `R`'s node key (or a delegated session key) over
  `SHA256("ffor/tower/fetch" ‖ epoch_id ‖ nonce)`, where `nonce` is 32 bytes chosen by
  the requester. `T` MUST reject a nonce it has already accepted for that epoch. The
  nonce is not the access control: Appendix C.1's transport is BOLT 8, which is
  authenticated and ordered, so a third party cannot replay `R`'s request at all, and
  C.2 gates the operation on the Noise-authenticated peer identity. The signature and
  its nonce exist so the request is non-repudiable evidence (§12.2) and cannot be
  re-presented as a second, distinct request. (Digest provisional pending bLIP review.)
- Watch the chain for `C_{n0}^S` and for any escape `E_j`; alert `R` out-of-band.
  Implementation note: gate breach detection on the **funding outpoint** first, then
  the held revocation secret; the tower sees unrelated spends and must not
  pattern-match on commitment shape alone.
- **Penalty capability** for the one revocable state, `C_{n0}^S`: the justice
  transaction requires the revocation private key, which combines `S`'s revealed secret
  (from package 1) with `R`'s `revocation_basepoint_secret`. `R` therefore either (a)
  shares that scoped basepoint secret with `T` together with a mandated sweep address,
  a malicious `T` could redirect *only* penalty funds, and *only* if `S` also broadcast a
  revoked state (a double-failure), the standard watchtower compromise, or (b) accepts
  alert-only towers and relies on returning within `to_self_delay` of any breach.
  Document the choice per deployment. Under option (a) the justice transaction MUST
  exclude `R`'s own `to_remote` output: the scoped key grants no claim over it, only
  `R` can spend it, and including it would burn fees for nothing: "only penalty
  funds" means exactly the revocable outputs. An unprovisioned tower (no scoped key /
  sweep script) MUST degrade to alert-only rather than refuse service.

`T` never holds funds and (option b) never holds key material. `R` running its own
tower reduces Variant B trust to "R keeps one keyless-or-scoped-key box online", which
is precisely the watchtower assumption Lightning already makes, now also covering
receipt.

**Role-separation (normative).** `T` MUST NOT be the same node as `S` for the epoch it
serves: a node that is both the settlement peer and the tower can settle upstream and
withhold the credit *alone*, which voids Variant B's entire guarantee (theft would no
longer require two parties to collude; it collapses to Variant A). A tower
implementation MUST therefore reject a provisioning whose `s_node_id` equals its own
node id; it SHOULD likewise reject one whose `r_node_id` equals its own (a node is
offline exactly when it is `R`, so it cannot be its own tower). This matters most for a
**node-embedded tower** (an ordinary Lightning node that also offers tower service): it
must serve only epochs where it is neither `S` nor `R`.

**Node-embedded tower breach-watch (normative for that deployment).** Where `T` runs
inside a full node, the "chain feed is out of scope" caveat tightens: such a `T` MUST
watch each provisioned epoch's **funding outpoint** on its own chain feed, and on a
spend route the full spending transaction to the breach classifier (§12.1); on a
revoked `C_{n0}^S` it MAY (option a) broadcast the justice transaction via its node's
broadcaster and MUST at least alert (option b). It MUST re-arm these funding-outpoint
watches on restart from the durable provisioning (the §9.4 restart contract), since `R`
is offline and cannot re-request them.

---

### 9.5 Variant D: the pre-signed voucher book

Variants A and B mint vouchers **during** the epoch: `S` signs a fresh commitment per
payment and must then deliver it. Delivery is the whole problem, and the tower exists to
force it. Variant D removes the problem instead of mediating it, by committing the entire
voucher set **at setup**, in one ordinary channel update, and settling payments purely by
preimage revelation.

**`S` sends nothing to anyone during the epoch.** There is no settlement package, no
`seq`, no unilateral fast-forward update, no pre-revocation, no tower call, and no
channel message to `R`.

#### 9.5.1 Construction: the one legal BOLT 2 sequence

BOLT 2 forbids sending an update message after one's own `stfu`, and forbids sending
`stfu` while any of one's own HTLC additions, removals or fee updates are pending. The
voucher book is therefore built **before** quiescence, as ordinary channel traffic, and
activated **under** quiescence as an FFOR state transition. Ordinary operation is legal
throughout steps 1 to 5; nothing in them is FFOR-specific except what the messages
carry.

1. **Synchronize.** Both sides reach a state with no pending updates in either
   direction and no in-flight `update_fee`. (This is a precondition, not quiescence:
   `stfu` has not been sent.)
2. **Negotiate the book.** `R` sends `ff_init` (`variant = 4`, TLV 9 with `d_1…d_K`,
   `G = 0`, no tower TLVs). `S` generates `t_1…t_K` and answers `ff_accept` with the
   hashes (TLV 1), the echoed amounts (TLV 9), `s_htlc_id_base` (TLV 7) and `T_init`
   (TLV 11). Both compute `T_setup` and the book (§7.5.3), and both MUST verify every
   book requirement now, before anything is added to the channel. **`R` MUST NOT learn
   any `t_k`** (§9.5.2). `s_htlc_id_base` MUST equal `S`'s next offered HTLC id at this
   moment; an `R` that sees a different id on the first add aborts.
3. **Add the vouchers.** `S` sends `K` ordinary `update_add_htlc` messages, one per slot
   in `k` order, each with `id = s_htlc_id_k`, `amount_msat = d_k`,
   `payment_hash = H_k`, `cltv_expiry = T_exp`, and a valid 1366-byte onion packet
   (below). `R` recognises a voucher by `(id, amount_msat, payment_hash, cltv_expiry)`
   matching the book exactly and MUST treat it as a voucher: it parks the HTLC, and
   MUST NOT fulfil it, fail it, or process its onion as a payment. Any add in this
   window that does not match the book exactly, or a book slot that does not arrive,
   is a failed voucher round: `R` fails the mismatching add with `update_fail_htlc`
   (`temporary_node_failure`) and sends `ff_abort` (reason 5) once the channel is
   synchronized again.
4. **Commit both views.** `S` sends `commitment_signed` covering all `K` additions
   (its `htlc_signature` list is the pre-signed HTLC-success material `R` needs for
   every voucher, §9.5.3); `R` sends `revoke_and_ack`; `R` sends `commitment_signed`;
   `S` sends `revoke_and_ack`. Implementations MAY split the additions across several
   `commitment_signed` rounds; what matters is the end state. The round ends when every
   voucher is **irrevocably committed in both commitment views**: present in `R`'s
   current commitment and in `S`'s, and the previous commitments on both sides revoked.
   BOLT 2's ordinary rules govern retransmission if a disconnect interrupts this step;
   the vouchers are stock HTLCs and need nothing from FFOR to survive it.
5. **Verify.** Each side rebuilds both current commitment transactions, checks the
   voucher outputs (count, amounts, scripts, `cltv_expiry`, BOLT 3 ordering, no
   trimming), verifies the peer's `htlc_signature` for every voucher's second-stage
   transaction, and computes `H_commit` (§7.5.2) from the two txids and commitment
   numbers. This is `VOUCHERS_COMMITTED`.
6. **Quiesce and activate.** `R` sends `stfu` (legal: nothing of `R`'s is pending;
   `S`'s adds are complete and acknowledged); `S` replies `stfu`. Under quiescence `R`
   sends `ff_activate` and `S` answers `ff_activate_ack` (§7.5.4). No update message of
   any kind is sent between either side's `stfu` and the acknowledgement. The
   acknowledgement terminates quiescence and both sides are `ACTIVE`; `R` may now
   expose invoices (§7.5.6) and disconnect.

**Voucher onion.** `S` constructs each voucher's onion as a single-hop BOLT 4 packet to
`R` with a fresh random ephemeral key, associated data `payment_hash = H_k` as for any
payment onion, and a final payload carrying exactly TLVs 2, 4 and 8:
`{amt_to_forward = d_k, outgoing_cltv_value = T_exp, payment_data = {payment_secret =
SHA256("ffor/voucher-secret" ‖ epoch_id ‖ [2: k]), total_msat = d_k}}`, no
`short_channel_id` and no other type. It exists so that
a stock onion decoder sees a well-formed packet; `R` identifies vouchers from the book
and never acts on the payload. An `R` that does decode it MUST find exactly these values
or treat the add as mismatching.

**Bounds on `K`.** `K ≤ R`'s `max_accepted_htlcs` (vouchers are `S`-offered, so `R`'s
limit binds), `K ≤ 483`, `Σ d_k ≤ R`'s `max_htlc_value_in_flight_msat`, every `d_k ≥`
the channel's `htlc_minimum_msat` and above the §8 dust floor, `S`'s reserve, `R`'s
reserve only when `R` is the funder (§8: an `R` that did not fund may hold zero), and
the funder's fee-spike obligation of §7.6, all satisfied with all `K` outputs present.
All of these are checked at step 2; a book that fails any of them is refused with
`ff_abort` (reason 2 or 3) and never reaches step 3.

**Abort after the voucher round.** If setup aborts at or after step 4 (disconnect,
timeout, `ff_abort`, or an `ff_activate` that `S` rejects), the vouchers are real
HTLCs that only `R` can remove. `R` MUST send `update_fail_htlc` for every voucher as
soon as the channel is synchronized after the abort, and `S` MUST NOT settle any
delegated payment (it is not `ACTIVE`). If `R` never reconnects, `S`'s remedy is the
same as for an `R` that never returns: force-close after `T_exp` and take the vouchers
through HTLC-timeout. **`S`'s liquidity commitment therefore begins at step 3, not at
activation**, and an `S` that wants to bound the setup window SHOULD abort promptly
(reason 1) and MAY refuse further `ff_init` from an `R` that abandons voucher rounds.

**HTLC id continuity.** The vouchers occupy `S`'s offered ids `s_htlc_id_base …
s_htlc_id_base + K − 1`. They are removed in `DRAINING` by `R`'s fulfil or fail, after
which `S`'s next offered id continues from `s_htlc_id_base + K`. `R`'s offered counter is
never touched. `channel_reestablish` after any disconnect uses the ordinary
`next_commitment_number` / `next_revocation_number` values; Variant D needs no
carve-out.

`budget_msat = Σ d_k`. Note the capital difference from Variants A/B: `S`'s `to_local` is
reduced by the **full budget for the whole epoch**, whether or not payments arrive, rather
than converting progressively. Since the `S`↔`R` channel is unusable for routing during
the epoch anyway (§3), the opportunity cost is close to what `S` already accepted.

**Settlement.** On `update_add_htlc` with `payment_hash = H_k`, once the upstream HTLC is
irrevocably committed, `S` is `ACTIVE`, no stopping condition of §7.5.6 holds, and the
§8 checks pass (the §7.6 amount checks, `amt_to_forward == d_k` within the blinded-path
slack and `amount_msat − d_k ≥ fee_S(d_k)`; upstream CLTV margin; and `H_k` not already
settled), `S` marks slot `k` settled durably and fulfils upstream with `t_k`. That is the
entire settlement procedure. `S` MUST keep per-slot state `UNUSED → SETTLING → SETTLED`
durable across restart: a slot in `SETTLING` after a crash is resolved by the upstream
channel's own reestablish (the fulfil either went out or it did not), never by settling
again on a second HTLC.

**Close and drain.** `R` reconnects, sends `ff_close`, receives `ff_close_ack` with the
bitmap and the preimages of every settled slot, and drains per §7.5.6: `update_fulfill_htlc`
for every slot it holds a preimage for, `update_fail_htlc` for every slot the bitmap
marks unsettled. One `commitment_signed` / `revoke_and_ack` round in each direction
SHOULD suffice; more are legal. When no voucher remains in either commitment the epoch
is `CLOSED` and ordinary operation resumes. §11's `ff_reconcile` / `ff_reconcile_ack` /
`ff_revoke_batch` flow is not used.

**Force-close, both views.** From `R`'s commitment, a voucher is a received HTLC: `R`
claims it with `t_k` through the HTLC-success transaction `S` signed at step 4, then
its CSV sweep; `S` takes an unclaimed one after `T_exp` by spending the output directly
with the timeout path. From `S`'s commitment, a voucher is an offered HTLC: `R` claims
it directly with `t_k` and its own key (no second-stage signature needed); `S` takes an
unclaimed one after `T_exp` through the HTLC-timeout transaction `R` signed at step 4.
Anchors and CPFP are as for any anchor channel; there are no trimmed vouchers, by
construction. `R` needs only a preimage to enforce from either view, which is §9.5.3's
point.

`R` never returns: `S` force-closes after `T_exp` and sweeps every unclaimed voucher via
its ordinary HTLC-timeout path. This is precisely what §10's escapes existed to provide,
so **Variant D needs no escape ladder**: `G`, `J`, `escape_delay`, `ff_escape_sigs`, the
aggregate voucher script, and all of Appendix B drop out. `R`'s `to_remote` sits on-chain
awaiting it, as before.

#### 9.5.2 Why this is safe for `S` (normative)

`S` generates the preimages, therefore **the only way `R` can ever hold `t_k` is if `S`
revealed it, and `S` reveals it only to claim a real upstream HTLC.** `R`'s possession of
`t_k` is self-certifying evidence that `S` was paid. That single sentence is the whole
security argument for the `S` side, and it is why `R` MUST NOT generate the preimages in
this variant: an `R` that knows `t_1…t_K` can claim the entire voucher book without a
single payment ever arriving.

The corollary is a hard rule for implementations: **`S` MUST NOT reveal `t_k` to any party
before the upstream HTLC carrying `H_k` is irrevocably committed and fulfilled.** Pushing
a preimage to a mailbox early converts a failed payment into free credit for `R`.

#### 9.5.3 Why this is stronger for `R` than Variant A

`R`'s on-chain claim requires **the preimage and nothing else**. The HTLC-success
signatures arrived with the setup `commitment_signed`, so no signature is needed from `S`
at claim time, and `R` needs no packages to enforce, only (optionally) to audit.

This changes who can rescue `R`. Under Variant A a payer's preimage is useless to `R`,
which still needs `S`'s package signature; under Variant D **the payer's proof-of-payment
is `R`'s on-chain claim key**. And BOLT 2 forces `S` to publish it: to take the money, `S`
must send `update_fulfill_htlc(t_k)` upstream, and it propagates back to the payer. `S`
cannot claim the payment without handing the key to `R`'s voucher to a party that is not
`S` and that has a relationship with `R`.

`R`'s recovery set is therefore `{S, the payer, any mailbox R chose, R's own box}`: a
**1-of-N availability assumption over independent parties** rather than trust in a single
one, and `R` may enlarge N freely. What Variant D does **not** do is make withholding
impossible: an `S` that settles and withholds, whose payer is also unreachable, still
costs `R` that voucher. Variant D lands at **Variant A's trust level with a far better
recovery story**, not at Variant B's. §12.5 explains why that gap cannot be closed by
script.

#### 9.5.4 Hash-chained vouchers (RECOMMENDED)

Instead of `K` independent preimages, derive them as a chain: `x_M` random,
`x_{j−1} = SHA256(x_j)`. Voucher `j` is hash-locked to `x_{j−1}` (preimage `x_j`), of
uniform amount `G`, with `budget = M · G`. Because knowing `x_m` derives every `x_j` for
`j < m`, **the single most recent preimage unlocks `R`'s entire cumulative credit.**

- `R` does not need to reach every payer. **One** source of the latest preimage recovers
  everything, which is what makes the payer-as-fallback story practical rather than
  theoretical. A Variant D mailbox, if `R` keeps one, is 32 bytes, overwritten in place.
- Invoices MUST be served strictly in ascending level order and MUST NOT be reused
  (§13.7). Revealing `x_m` publishes the preimage of every invoice at a level below `m`,
  so an unserved lower-level invoice would become claimable by any node on its route.
- **One level per payment.** Every voucher in the chain has `d_j = G` (TLV 9 carries
  `M` copies of `G`), and the invoice for level `j` is for exactly `G` with
  `payment_hash = x_{j−1}`. An invoice for several levels at once, amount `(j − p)·G`
  on hash `x_{j−1}`, is **not** permitted in this version: it would reuse `H_j` at an
  amount other than `d_j`, and an honest `S` running §7.6 check 1 would fail it. A
  payer owing `n·G` pays `n` level invoices in turn (MPP is disabled, §13.1). Amounts
  that are not a multiple of `G`, and multi-level jumps, wait for transition-specific
  descriptors (issue #23) and are deferred.
- Fixed-amount invoices also repair §13.3: amount attestation stops being
  amountless-grade, because the invoice `R` signed states the amount.
- `S` lying about the current level (serving a `(p, j)` pair whose `p` is below the true
  level) undercredits `R` by the overlap. This is the §13.7 invoice-reuse attack in
  another dress, is bounded by the budget, and is detectable from any two payer receipts
  with overlapping levels. It adds no new trust class.

#### 9.5.5 Variant D with a tower (OPTIONAL, and a genuine trade)

Variant D composes with a tower, and the tower it needs is trivial. If `T` (not `S`)
generates the preimages and `S` must fetch `t_k` from `T` in order to settle at all, then
**`T`'s release-and-log *is* the credit event**, because the voucher for `H_k` was signed
into `R`'s commitment at setup. `T` records which `k` it released and hands those
preimages to `R` on return.

`T`'s verification checklist collapses to nothing. There is no package to verify, no
`C_i^R` to reconstruct, no signature to check, no budget to track, no chain to watch.
§9.4's **node-embedded breach-watch drops out entirely**, since there is no package,
no `C_i^R` and no chain artefact left for `T` to watch, and its provisioning bundle
shrinks to `epoch_id`, `s_node_id`, `r_node_id`, the `K` preimages, and a `K`-bit
released bitmap: `32K + K/8` bytes and a release-idempotent-by-`k` API. An `S` that
fetches `t_k` without a matching payment is **punished, not rewarded**: `T` will hand
that preimage to `R`, who claims voucher `k` for free. `S` therefore only ever fetches
against real payments.

Two of §9.4's rules do **not** drop out, and in this configuration both of them protect
`S` rather than `R`:

- **Role separation is if anything stricter here.** The whole guarantee above is
  "`T`'s release-and-log *is* the credit event". A `T` that is also `S` releases
  preimages to itself and logs nothing anyone can check, collapsing the configuration
  back to plain Variant D while `R` believes it has more. The `T ≠ R` half matters more
  than in Variant B, because the exposure runs the other way: an `R` that is its own
  tower holds every `t_k` and can claim the entire voucher book unpaid, which is exactly
  the §9.5.2 failure. Both halves of §9.4's rule apply unchanged.
- **A reduced durability contract still binds.** The released bitmap *is* the credit
  record, so losing it is not degraded service but a fork in whose money is lost:
  serving nothing strands every settled voucher, and serving everything lets `R` claim
  vouchers nobody paid for. `T` MUST therefore commit the released bit **fsync-backed
  before** returning `t_k` to `S` (the same argument as §9.4 item 5), and MUST rehydrate
  every epoch's preimages, node ids and bitmap on restart, since `R` is offline across
  the restart and cannot re-provision. What goes away is the *contents* of §9.4's
  bundle, not the obligation to persist one.

The trade, stated plainly rather than buried: **this configuration requires `S` to trust
`T` not to release preimages to `R` early**, since an `R` holding `t_k` for an unpaid
voucher can claim it. That is trust `S` must place in a party `R` chose, and it is the
exact mirror of Variant B, where `R` trusts a party it chose. Pre-playing `R`'s half of
the exchange is what moves the exposure across the table; §12.5 shows why one side or the
other must bear it. Use §9.5.5 only where `S` accepts that exposure (bounded by the
budget), for example between a user's own nodes or where `T` is bonded. Otherwise use
plain Variant D (§9.5.1), where `S` generates the preimages and no tower exists at all.

---

### 9.6 D-R: the receipt-witness profile (normative)

Plain Variant D leaves `R` with a one-of-N recovery set, `{S, the payers, any mailbox}`
(§9.5.3), in which every member is either the party that might withhold or a stranger.
D-R adds members `R` chooses: **receipt witnesses**, routing nodes on the invoice's
path before `S` that store the preimage durably before they let the payer's success
propagate. A witness holds information, never money: no channel keys, no signed
commitment of `R`'s, no broadcast kit, no ability to move a satoshi. The channel is
unchanged from §9.5; D-R is a profile over it.

#### 9.6.1 The claim, stated in full

> FFOR D-R provides payer-final, non-custodial offline receive for precommitted
> fixed-amount slots. A conforming payer using an authorized witness-bearing path sees
> ordinary Lightning success. Each conforming on-path receipt witness stores an
> encrypted preimage record before propagating fulfilment. `R` can enforce or
> reconcile the voucher if at least one authorized record remains retrievable before
> the claim deadline. The profile does not provide indefinite offline recovery or
> cryptographic protection against same-hash reuse.

For the path the invoice declares:

```
payer final success
  -> R already holds an enforceable voucher for (H_k, d_k)          (§9.5.1, §9.5.3)
  -> every conforming receipt witness on the path saw t_k
  -> at least one honest durable witness makes t_k retrievable by R
```

and for `S`:

```
R can activate voucher k
  -> S revealed t_k
  -> S had a matching irrevocably committed inbound HTLC             (§9.5.2)
```

This is trustless funds safety with **conditional liveness**, not unconditional data
availability. Its honest limits, each normative text elsewhere:

- **Bounded return.** `R` MUST retrieve a record and reconcile or force-close before
  `T_exp − claim_margin` (§7.5.6). The window is a parameter `R` chooses and `S` prices
  through locked liquidity; §5.1's long `to_self_delay` lets it be long, but it ends.
  An `R` that may never return needs a terminal construction that closes the channel
  (D1-WR, deferred: §13.8), not this profile.
- **Every witness learns plaintext `t_k`.** A witness can settle a later same-hash HTLC
  itself and never forward it to `S`; reuse is bounded by who holds the invoice, not
  prevented (§13.7.1).
- **Path enforcement is not cryptographic against `S`.** An honest `S` refuses
  delegated HTLCs that did not arrive from a designated witness (§9.6.3), but a
  malicious `S` already holds `t_k` after the first settlement and can accept the same
  hash on any channel. The defensible statement is limited to a conforming payer using
  one of the signed paths.
- **Availability of the witnesses is `R`'s assumption.** If every witness deletes,
  loses or withholds its record and no payer can be reached, an offline `R` cannot
  distinguish a paid slot from an unpaid one. `R` enlarges N by provisioning more
  witnesses; nothing else substitutes.
- **A witness still has operational exposure**: storage it promised, bandwidth, the
  privacy of what it observes, and denial of service. §9.6.7 bounds them; it does not
  remove them.

#### 9.6.2 Roles and objects

| Term | Meaning |
|---|---|
| `W` | A receipt witness. Any node on the invoice path before `S` that implements this section. There MAY be several per epoch; each is independent. The issuer of issue #25 is a natural `W`. |
| mailbox | One witness's store for one epoch, named by a random 32-byte `mailbox_id`. Unlinkable to the epoch, to `R`'s node id, and to any other witness's mailbox. |
| manifest | What `R` gives `W` at provisioning: the book, `H_act`, and the keys under which records are encrypted and fetched (§9.6.4). |
| record | One witness's signed, receiver-encrypted statement that it saw `t_k` (Appendix F.2). |
| `fetch_key` | A fresh secp256k1 keypair per `(W, epoch)`, generated by `R`. Its public half authorizes the manifest and every fetch; `R`'s node id appears nowhere. |
| `enc_key` | A fresh secp256k1 public key per epoch, generated by `R`, to which every record body is encrypted (Appendix F.3). |
| `claim_margin` | §7.5.6: the blocks `R` reserves between admission close and `T_exp` to return, fetch, drain or enforce. |

Every witness object binds to `H_act`. A witness that has not acknowledged the epoch's
`H_act` MUST NOT record for it, and `R` MUST NOT expose an invoice before every
witness it relies on has acknowledged (§7.5.5).

#### 9.6.3 Path requirements and `S`'s side

- Every invoice `R` signs for a D-R epoch MUST route through at least one provisioned
  witness immediately before `S`, or through a chain of them ending at `S`. BOLT 12
  blinded payment paths are the vehicle (a conforming payer cannot leave them; the
  aggregate fee and CLTV are computed per §7.6); a BOLT 11 route hint is advisory and a
  payer MAY ignore it, so BOLT 11 D-R invoices carry only the guarantee that a
  *conforming* payer follows the hint.
- `ff_init` TLV 13 `witness_peers` (`u16 count`, `count × 33` node ids) names the peers
  from which delegated HTLCs may arrive. `S` MUST fail upstream (§8 encoding) a
  delegated HTLC that arrives over a channel to any other peer. This is an honest-`S`
  guard: it stops a conforming payer's mistaken route from settling without a record,
  and it does nothing against an `S` that wants to settle anyway.
- `S` is otherwise unchanged from §9.5.1: one-shot slot state, `ff_close_ack` with
  bitmap and preimages, no message to anyone during the epoch. `S` MAY be told nothing
  about the witnesses beyond TLV 13.
- Witness hops charge ordinary forwarding fees, folded into the blinded path's
  aggregate `blinded_payinfo` per §7.6. None of them changes `d_k`.

#### 9.6.4 Provisioning

After `ACTIVE` and before exposing any invoice, `R` sends each witness
`ff_witness_provision` (Appendix F.1) carrying the manifest:

```
manifest = [1: version = 1][1: profile = 1 (D-R)]
           [32: mailbox_id]
           [32: T_setup][32: H_commit][4: epoch_start_height][32: H_act]
           [33: fetch_pubkey][33: enc_pubkey]
           [4: retention_until][1: min_receipts]
           [2: book_len][book_len: book]                (§7.5.3, the whole book)
           [64: manifest_sig]
```

`manifest_sig` is a compact ECDSA signature under `fetch_pubkey` over
`SHA256("ffor/witness/manifest" ‖ manifest without the signature)`. It proves that
whoever provisioned controls `fetch_key`, which is the only identity a witness ever
needs; the Noise-authenticated peer id of the provisioning connection is **not** part
of authorization, so `R` MAY provision over any connection, including one that is not
its node identity. `retention_until` MUST be at least `T_exp + 144`. `min_receipts` is
the number of guardian receipts (Appendix F.4) the witness MUST obtain before
propagating a fulfil; `0` means local durability only.

The witness verifies the signature, recomputes `H_book` from the book and `H_act`
from `T_setup`, `H_book`, `H_commit` and `epoch_start_height` (§7.5.2) and refuses a
manifest whose `H_act` does not match (so the book it stores is provably the one the
epoch activated), checks the book's internal consistency (`K` entries, unique hashes,
`Σ d_k` equal to the budget the book implies), reserves capacity for `K` records,
persists the manifest durably, and answers `ff_witness_ack`. `T_setup` and `H_commit`
are digests and reveal nothing about the channel. A witness that cannot reserve MUST refuse, and MAY require a
prior registration or payment for the service (issue coreyphillips/beignet#709 is one
such admission contract). A refused provisioning means `R` MUST NOT count that
witness.

`R` MUST persist, before going offline, the set of witnesses it provisioned with their
`mailbox_id`, `fetch_key` private half and `enc_key` private half; without them the
records are unrecoverable. These belong with the rest of the epoch record of §7.5.5.

#### 9.6.5 Recording: store before you propagate

A witness forwards HTLCs normally and holds nothing. Its one FFOR behaviour is on the
way back. When `W` receives `update_fulfill_htlc(t)` from downstream for an outgoing
HTLC whose `payment_hash` equals some `H_k` in an active manifest, then before it sends
the corresponding `update_fulfill_htlc` upstream it MUST:

1. verify `SHA256(t) == H_k`; on mismatch this is not a delegated fulfil and the
   ordinary forwarding rules apply unchanged;
2. build the record of Appendix F.2 for `(mailbox_id, k)`, encrypting the body to
   `enc_pubkey` and signing the header with its node key;
3. commit the record to its durable store, fsync-backed, so that a crash after this
   step and before step 5 still leaves the record retrievable on restart;
4. if `min_receipts > 0`, obtain that many guardian receipts (Appendix F.4) and append
   them to the record;
5. and only then propagate the fulfil upstream.

Idempotency: a second downstream fulfil for the same `(mailbox_id, k)` with the same
`t` is a no-op that MUST NOT create a second record; one with a different `t` is
impossible (the hash is fixed) and MUST be treated as a protocol error on the
downstream channel. Records are append-only per slot and per mailbox.

The barrier is bounded, because a witness that never propagated would strand the
payer's HTLC and eventually its own upstream channel:

- `W` MUST propagate the fulfil no later than `incoming_cltv_expiry − W`'s safety
  delta, whatever the state of steps 3 and 4, and SHOULD propagate within a small
  wall-clock bound (recommended 30 seconds) in normal operation. `W` holds `t` from
  step 1 on, so it can always claim its incoming HTLC on-chain; delaying is safe for
  `W` and unsafe only for the upstream channel's liveness.
- If the deadline arrives with step 3 incomplete, `W` MUST still propagate, MUST keep
  trying to store, and MUST mark the record `unbarriered` when it does store it. If
  step 4 is what is incomplete, `W` propagates and keeps collecting receipts. An
  `unbarriered` record is served like any other; `R` learns from the flag that the
  witness's durability promise was not kept for that slot.

A witness MUST NOT hold, delay or fail a delegated HTLC on the way **downstream**
for any FFOR reason. The profile's entire settlement effect on the payer is the
sub-second pause of the barrier on the way back.

#### 9.6.6 Retrieval, close and retention

On return, `R` sends each witness `ff_witness_fetch` (Appendix F.1), signed under
`fetch_key` with a requester-chosen nonce the witness MUST refuse to accept twice for
that mailbox. The witness answers with every record it holds for the mailbox. `R` MUST:

1. verify each record's witness signature against the node id the record names, and
   that node id against the witness it provisioned;
2. verify `H_act` and `terms_hash` against its own book;
3. decrypt the body under `enc_key` and verify `SHA256(t) == H_k` and that the body's
   `(k, H_k, d_k)` match the header;
4. union the results across every witness it provisioned and every other source (the
   `ff_close_ack` preimages, payer receipts). A record present at one witness and
   absent at another is an audit fact, not a fault of the protocol.

`R` then closes and drains per §7.5.6 with the union, or force-closes per §9.5.1 with
the same preimages if `S` will not answer. Records retrieved after `T_exp` are still
served (retention) but can no longer be enforced.

At `ff_close_ack` `R` SHOULD send each witness `ff_witness_close` (`mailbox_id`,
`H_act`, the settled bitmap, signed under `fetch_key`). On receipt the witness stops
creating records for the mailbox (a fulfil already at step 2 completes), and keeps
existing records until `retention_until`. A witness MUST NOT delete a record before
`retention_until` and MAY delete everything for the mailbox after it. Closing is
advisory for the witness's bookkeeping; it is not what ends `R`'s ability to fetch.

#### 9.6.7 What a witness is exposed to, and the bounds

- **Storage**: `K` records of at most Appendix F.2's size per mailbox, reserved at
  provisioning and released at `retention_until`. A witness sets its own caps on
  mailboxes, records and bytes, and refuses provisioning beyond them.
- **Time**: the barrier is bounded by §9.6.5 and never exceeds the HTLC's own expiry.
- **Privacy**: a witness learns every delegated hash of the epoch, which of them
  settled, the amounts it forwarded, and its neighbours on the path. It learns neither
  `R`'s node id nor the channel, and the body it stores it cannot read. Two witnesses
  cannot link their mailboxes to each other except through the shared hashes on the
  path, which a routing node sees anyway.
- **Denial of service**: provisioning is the only unsolicited work, and it is
  authorized by `fetch_key`, not by a node id, so a witness MUST gate it by capacity
  and MAY gate it by registration or payment. Fetch and close are signed and
  nonce-bound and cost one read.
- **Liability**: none. A witness that loses a record costs `R` liveness for that slot
  if no other source has it, and nothing else; it never holds or moves funds.

#### 9.6.8 Adversarial validation

A conforming implementation's test plan MUST cover, with the oracle being what `R`
can enforce rather than what any party reports:

- `S` crashing before and after every durable write and before and after the upstream
  fulfil (§9.5.1 per-slot state);
- the witness crashing before step 3, after step 3, after step 4, and after step 5 of
  §9.6.5, on restart serving exactly the records the steps imply;
- one witness withholding, corrupting, replaying, or deleting a record while another
  holds it;
- all but one witness unavailable;
- a payment over a path that omits every witness: an honest `S` fails it (TLV 13); a
  dishonest `S` settles it and `R` has only the payer;
- duplicate and concurrent same-hash HTLCs, MPP attempted despite the prohibition, and
  a witness settling a second same-hash HTLC itself (§13.7.1);
- a payment before `ACTIVE` and after admission close;
- `R` returning just inside and just outside `claim_margin`;
- both commitment views published, with fee spikes, dust boundaries, pinning, reorgs
  and the loss of sponsor inputs;
- a witness retaining records after close and serving them; and no payment at all,
  where `S` must recover every voucher by timeout without any claim reaching `R`.

---

### 9.7 Issuance for unknown payers: the BOLT 12 issuer (normative)

Everything before this section assumes a payer who already holds an invoice. `R` can
hand fixed-amount invoices to payers it knows before going offline (§7.3); it cannot
answer a payer it has never met, because a BOLT 12 invoice copies fields of the
`invoice_request` it answers and so cannot be pre-signed, and a BOLT 11 invoice for an
unknown payer is a bearer object anyone may copy (§13.7.1). Someone online must answer
each request. This section specifies that party, the **issuer** `I`, and what BOLT 12
already gives it for free.

#### 9.7.1 What BOLT 12 provides

An offer that carries `offer_paths` and omits `offer_issuer_id` is answered by whoever
sits at the end of the path the `invoice_request` arrived on: BOLT 12 requires the
invoice's `invoice_node_id` to be the final `blinded_node_id` of that path, requires the
invoice to be signed under that key, and requires the payer to reject any other signer.
`R` therefore builds its offer with onion-message paths terminating at `I`, and `I`
signs each invoice with its blinded key for that path. The payer sees an ordinary offer
and an ordinary invoice, and needs no FFOR support. No new signing authority exists;
the delegation is the offer.

The issuer is a delegated party by construction: it must know `R`'s node id and the
`S`→`R` channel to build the invoice's payment paths, so unlike a pure witness (§9.6.7)
it cannot be kept ignorant of who `R` is. It SHOULD also be the first receipt witness
on the path, which costs it nothing and gives `R` a record from the party that saw the
request.

#### 9.7.2 Provisioning the issuer

After `ACTIVE` and after provisioning it as a witness (§9.6.4), `R` sends `I`
`ff_issuer_provision` (Appendix F.6) carrying:

```
issuer_manifest = [1: version = 1]
                  [32: mailbox_id]                       (the witness mailbox, §9.6.4)
                  [2: offer_len][offer_len: offer]       (the BOLT 12 offer bytes)
                  [2: num_hops]{hop}*                    (the payment path template)
                  [4: issue_until]                        (block height, <= D)
                  [64: r_attestation]
hop             = [33: node_id][8: short_channel_id][4: fee_base_msat]
                  [4: fee_proportional_millionths][2: cltv_expiry_delta]
                  [8: htlc_minimum_msat][8: htlc_maximum_msat]
```

The template lists every hop from the first witness to `S` and then `R`, in order, with
the relay values each hop charges (`S`'s are the `ff_init` fee terms, §7.6). `I` builds
a **fresh blinded payment path per invoice** from the template with a fresh path key,
so two invoices cannot be linked through their paths. `r_attestation` is `R`'s
node-key compact signature over
`SHA256("ffor/issuer/attest" ‖ offer_id ‖ H_act ‖ H_book)`, where `offer_id` is BOLT
12's merkle root of the offer; it is what lets a payer who knows `R`'s node id verify,
out of band, that the offer and the slots are `R`'s (§9.7.5). The issuer verifies that
the offer's `offer_paths` terminate at blinded node ids it controls, that the template
ends at `R` via `S`, that `issue_until ≤ D`, and that `offer_absolute_expiry`, if
present, is no later than the conservative estimate of `issue_until` (§7.5.6). It
persists the manifest durably with the witness mailbox and answers `ff_issuer_ack`.

#### 9.7.3 Answering an `invoice_request`

On an `invoice_request` that arrives over one of the offer's paths and passes BOLT 12's
own checks, `I`:

1. Computes the **requested amount**: `invreq_amount` if present, else BOLT 12's
   *expected amount* from `offer_amount` and `invreq_quantity`.
2. Selects a slot: an unissued `k` with `d_k` **equal** to the requested amount. If
   `offer_amount` is present the offer SHOULD be sized so that `d_k = offer_amount ×
   quantity` exists for the quantities `R` expects to sell; with `offer_amount` absent
   (payer-chosen amounts) the payer's `invreq_amount` must land exactly on a slot. `I`
   MUST NOT round, MUST NOT choose a larger slot, and MUST NOT accept `invreq_amount`
   above the expected amount unless it equals a slot (BOLT 12's "MAY reject if it
   greatly exceeds" is a MUST here). Fixed slots are the price of §7.6's equality.
3. Marks the slot issued **durably, with a compare-and-swap on the slot state**,
   recording `invreq_payer_id` and a hash of `invreq_metadata`, before any invoice
   leaves. A crash between the mark and the send leaves the slot issued and the
   invoice unsent; the payer retries, and BOLT 12's rule for identical
   `invreq_metadata` lets `I` re-answer with the same invoice (same slot, same hash,
   same payer). A request with different metadata gets a different slot, never the
   same hash twice.
4. Builds the invoice: `invoice_payment_hash = H_k`; `invoice_amount = d_k`;
   `invoice_paths` = one fresh blinded payment path from the template, with
   `invoice_blindedpay` aggregated per BOLT 4 (§7.6); `invoice_relative_expiry` so that
   the invoice expires no later than the conservative estimate of
   `min(issue_until, D)`; `invoice_features` without MPP (§13.1); `invoice_node_id` and
   the signature per BOLT 12 for a path-terminal issuer; optionally TLV
   `ffor_issuer_attestation` (§9.7.5).
5. Sends it over the request's `reply_path`.

Refusals use `invoice_error` with a fixed string that reveals nothing about the book:
`"no slot for this amount"` when no unissued `d_k` equals the requested amount, and the
same string when the book is exhausted, when `issue_until` has passed, and after
`ff_witness_close`. An issuer MUST NOT enumerate remaining amounts, MUST NOT say how
many slots remain, and MUST answer an amount it has never had a slot for in the same
way as one it has just run out of.

#### 9.7.4 Path binding

Every invoice `I` issues carries only payment paths built from the template, each
traversing the required witnesses and ending at `R` through `S`. A conforming BOLT 12
payer cannot leave a blinded path, and `S`'s TLV 13 guard (§9.6.3) fails a delegated
HTLC that arrives from anyone but the last witness. That is the whole of the binding,
and its limit is §9.6.1's: an `S` that already holds `t_k` can accept the hash on any
channel, and nothing here stops it. An issuer MUST NOT add a BOLT 11 fallback, a
plaintext route hint, or a path that omits a witness.

#### 9.7.5 Proof of payment

The payer's receipt is the invoice, signed under the path-terminal blinded key, plus
the preimage. It proves payment of the request that `R`'s offer designated `I` to
answer, at exactly `d_k` (§13.3). It does not name `R`: a payer who wants to prove to
a third party that the payee was `R` needs `R`'s attestation. `I` MAY include
`r_attestation` in the invoice as the odd experimental TLV `ffor_issuer_attestation`
(type 1000055001: `[32: H_act][32: H_book][64: r_attestation]`), which a stock payer
ignores and an FFOR-aware payer can verify against `R`'s node id and the offer. In a
dispute between payer and `R`, `R` cannot deny an invoice whose slot its attestation
covers and whose preimage the payer holds; `R` can deny nothing about an invoice the
attestation does not cover, which is why `I` SHOULD include it.

#### 9.7.6 Privacy

The issuer learns every request (payer id, amount, quantity, metadata), every slot it
issued, and, if it is also a witness, every settlement. It knows `R`'s node id and the
channel. A payer learns the issuer's blinded node id for the path and nothing about
`R` unless it asks for the attestation. `S` learns nothing new: it sees delegated HTLCs
from the last witness as before. Two invoices for the same offer share nothing but the
offer id, since paths and hashes are fresh per invoice. `R` running its own issuer is
not possible while offline; that is the role's definition, and §12.5's bound applies:
serving invoices to unknown payers is an always-online, stateful job that no script
removes.

#### 9.7.7 Retirement

Issuance stops at the first of: `issue_until` reached; the book exhausted;
`ff_witness_close` received for the mailbox; the offer's own expiry. An invoice issued
before retirement stays payable until its own expiry, which §9.7.3 bounds by `D`, so
no unconsumed invoice outlives its slot. `I` MUST persist the issued-slot state with the
mailbox (§F.5) and MUST serve it to `R` on request (`ff_issuer_status`, Appendix F.6),
so that `R` on return can tell an issued-but-unpaid slot from a never-issued one when
it reads the `ff_close_ack` bitmap.

#### 9.7.8 Conformance

- A payer holding only the offer, with a stock BOLT 12 implementation and no FFOR
  knowledge, obtains an invoice for an unconsumed slot and pays it with a stock
  payment; `R` recovers `d_k`.
- A second `invoice_request` for a consumed slot, with different metadata, receives a
  different slot or the fixed refusal; with identical metadata it receives the same
  invoice.
- The issuer crashing between marking a slot issued and sending the invoice does not
  issue the slot twice after restart.
- Every issued invoice's paths traverse the required witnesses; a test payer that
  strips the path and pays `S` directly is failed by an honest `S` under TLV 13.
- `invoice_error` is byte-identical for "no slot at this amount", "exhausted", "after
  issue_until" and "after close".
- Vectors: a K = 1 book, a slot grid, an exhausted book, and a request with no matching
  amount.

---

## 10. Escape: `S`'s unilateral exit (optional, `G > 0`)

Escapes are a **Variant A/B mechanism**. Variant D (§9.5) needs none: its vouchers carry
ordinary HTLC-timeout paths, so a vanished `R` is resolved by `S` force-closing after
`T_exp` and sweeping them.

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
  **and** reconciliation has not begun. `escape_delay` is fixed at **2016 blocks** in
  v1 (a protocol constant, not negotiated: `R` must be able to rely on it when
  reasoning about how late it can return before `S`'s escape window opens; a future
  version may make it a negotiated `ff_init` TLV). Because §7.1 requires
  `T_exp ≤ D + escape_delay` whenever `G > 0`, the escape window opens **at or after**
  `T_exp`, i.e. never while `R` still has a legitimate reconciliation window. Without
  that constraint an `R` choosing `T_exp − D > escape_delay` would face an escape it was
  told (§11.2) could not have happened yet. Opening the window that late costs `S`
  nothing: the aggregate voucher's refund path carries `T_exp` CLTV regardless
  (Appendix B.2 Path 2), so `S` was waiting for `T_exp` either way. It MUST
  choose `j = ceil(owed/G)`, rounding **up**, so `S` bears the rounding cost (≤ G) and
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

With `G = 0` (no escapes), `S` accepts the hostage risk explicitly, reasonable between
own nodes, or with small budgets/short epochs.

---

## 11. Return and reconciliation

### 11.1 Message flow

On reconnect, `channel_reestablish` carries TLV **55001**
`{epoch_id: 32, state: u8, last_seq: u16, activation_hash: 32}` from each side
(`state`: 0 = `NEGOTIATING`, 1 = `VOUCHERS_COMMITTED`, 2 = `ACTIVATING`, 3 = `ACTIVE`,
4 = `DRAINING`, 5 = `CLOSED`, 6 = `ABORTED`, §7.5; `activation_hash` is `H_act`, or 32
zero bytes before `ACTIVE`; `last_seq` is always 0 in Variant D, which has no
settlement sequence), and, from `S`, iff escape signatures were
exchanged, TLV **55003** `s_catchup_per_commitment_point` (33 bytes): `S`'s
per-commitment point for `n0 + 2`, which `R` otherwise could not obtain before signing
the catch-up commitment in step 2. Mismatch rules: an `S` reporting no epoch, or `ABORTED`, while `R` is before
`ACTIVE` means setup never completed and `R` MUST discard (§7.5.5); conversely, if `R` reports no epoch
while `S` has `last_seq > 0`, `S` MUST retain the epoch and respond `ff_error`: `S`
holds voucher obligations and MUST NOT forget them; in Variants A and B `S` MAY
discard only at `last_seq == 0`. In Variant D `last_seq` is always 0 and carries no
retention meaning: retention there is decided by state alone. From the moment either
side persisted `ACTIVE`, **neither** side may discard the epoch on any reestablish,
whatever the peer reports and whether or not any slot was settled, because the
vouchers are real HTLCs and the book is the only record of which hash is which; the
epoch ends only through `DRAINING → CLOSED` or on-chain. Before `ACTIVE` the
disconnect-aborts rule of §7.5.5 applies. Symmetrically, in A and B, once settlements
exist **neither** side may discard on a TLV-less reestablish: `R`'s packages and preimages are its only claim on the
credited vouchers, so an `S` that stops sending the TLV after settlements is treated
as misbehaving (`R` enforces on-chain per step 6); the §7.5 discard rule applies only
while `R` holds zero settlement evidence. `S`'s `last_seq` is a **lower bound** on the
replay count, never the figure `R` acts on: `R` MUST adopt the highest `seq` for which
it holds a package that passes the §9.4 checklist, from **any** source (`S`'s replay,
`T`, or its mailbox), and a `last_seq` below that count is itself §12.2 evidence. (An
`S` that settled `j` payments upstream and reports `last_seq = j − 2` would otherwise
have `R` adopt a commitment missing two vouchers and then revoke the states that carried
them in `ff_revoke_batch`, executing §12.1's withholding attack through the
reconciliation handshake.) Symmetrically, `S` MUST replay every package it holds
regardless of what `R` reports, and MUST send its `channel_reestablish` before any
replayed packages (replay ordering relies on transport FIFO). During an epoch and
reconciliation, the standard `next_commitment_number` / `next_revocation_number`
validation needs an FFOR carve-out: commitment numbers advance out-of-band (packages,
catch-up commitment), so peers MUST tolerate the fast-forwarded numbers and reconcile
via the FFOR TLVs, not the standard fields. This carve-out is for Variants A and B
only; Variant D never advances a number out of band and uses the standard rules
unchanged (§9.5.1). Every reconciliation message is **idempotent**: each of the
replayed packages, `ff_reconcile`, `ff_reconcile_ack`, `ff_revoke_batch`, and
`ff_close_ack` MUST be safely re-processable (or re-sendable) after a reconnect at any
point, and a peer that is already `DRAINING` or `CLOSED` MUST answer a still-`ACTIVE`
peer's reestablish by retransmitting `ff_close_ack`, not with an error (§7.5.5). The
sequence, in Variants A and B, once `R` has sent `ff_close` (§7.5.4) and `S` has
completed or failed every in-flight delegated HTLC (no other updates are legal in
`ACTIVE`, so the channel is synchronized by construction):

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
3. **`ff_reconcile_ack`** (type 55017, S→R), fixed fields first, then the TLV stream
   (standard LN layout):
   `{s_next_per_commitment_point: 33}`, then
   `TLV 1 revocation_secret_n0: 32 (iff j == 0; otherwise it went out in package 1)`,
   `TLV 3 revocation_secret_n0plus1: 32 (iff escapes were signed)`.
   `R` MUST verify each secret against its stored points. All escapes are now toxic to
   `S`; `T` can stand down at end of epoch. Note the division of labor: `T` can
   penalize only `C_{n0}^S` (its secret arrives in package 1); the escape revocation
   secret (`n0 + 1`) is revealed only here, at reconciliation, when `R` is back. For
   escapes, `T` is therefore structurally **alert-only**; only `R` penalizes a stale
   `E_j` (§B.5's "`R` (or its tower)" applies to `C_{n0}^S`, not to escapes).
4. **`ff_revoke_batch`** (type 55019, R→S):
   `{count: u16, secrets: count×32}`, `R`'s per-commitment secrets for its skipped
   indexes `n_R … n_R + j − 1` (its pre-epoch state and every superseded `C_k^R`,
   `k < j`). Sequential indexes are not mutually derivable in shachain, hence the
   explicit list; `S` verifies each against `R`'s points and inserts into its shachain
   store normally.
5. **`ff_close_ack`** (type 55053, §7.5.4): `S` sends it upon successfully processing
   `ff_revoke_batch`, with the settled bitmap covering `seq 1…j`, having persisted
   `DRAINING`. `R` persists `DRAINING` on receipt. The channel now has `j` live HTLCs
   and the feerate is unfrozen for the conversion round.
6. **Conversion**: `R` sends standard `update_fulfill_htlc` for each voucher (preimages
   from packages / `T`), through the normal commitment dance; the credits become plain
   channel balance with zero new machinery. If `S` stalls here and `T_exp` approaches,
   `R` force-closes `C_j^R` and claims every voucher on-chain via its pre-signed
   HTLC-success transactions (that is what the `htlc_sigs` in package `j` are for),
   with anchor CPFP as usual. The epoch is `CLOSED` when the last converted voucher
   is irrevocably removed from both commitments. In Variant B the post-reconcile tower fetch is
   **REQUIRED** for this step, not optional: `S`'s replay cannot carry preimages
   (§9.1's preimage TLV is Variant A only), so without the fetch `R` cannot fulfill
   its vouchers; towers MUST keep serving fetches after reconciliation completes.
   **Enforcement never requires the reconcile handshake**:
   adopting `C_j^R` needs only the validated packages, so `R` MAY force-close directly
   from `ACTIVE`, e.g. when `S` refuses reconciliation entirely (§12.1) or on an
   `ff_error` protocol violation after activation. Implementation note: attaching
   CPFP/fee inputs to an HTLC-success transaction changes its txid; downstream
   spent-output tracking must match by the preserved `SIGHASH_SINGLE|ANYONECANPAY`
   input 0 (outpoint + witness), never by txid.

`ff_error` (type 55023, body `[u16: len][len: data]` after the standard header, BOLT 1
error style) signals a protocol violation and nothing else. A valid `ff_init`,
`ff_activate` or book that a peer declines is answered with `ff_abort` alone (reason
2, 3 or 4) and no `ff_error`. Before `ACTIVE`, an `ff_error` MUST be followed by
`ff_abort` (reason 7) from the same sender, and the receiver records the abort's
reason, never a reason of its own inferred from the `ff_error`; during `ACTIVE` and
`DRAINING` the channel falls back to on-chain enforcement rather than aborting
(§7.5.1: there is no abort from `ACTIVE`).

### 11.2 Edge cases

- **Reconnect mid-settlement**: `S` MUST complete or upstream-fail any in-flight
  delegated HTLC before entering step 1; reconciliation always starts from a settled
  package history.
- **Zero-settlement epoch**: `ff_close` answered by an `ff_close_ack` with an empty
  bitmap and no reconcile is permitted regardless of `G`. With escapes outstanding this is still safe: normal operation reuses index
  `n0 + 1`, so the escapes die automatically the next time that index is revoked in
  the ordinary flow, and until then a broadcast escape only *overpays* `R` (at `j·G`
  against zero owed) at `S`'s own expense. Implementations MAY instead run the
  escape-killing reconcile (step 2 at `n0 + 2`, step 3 revealing both secrets)
  immediately.
- **Mid-reconcile disconnect**: on the next reconnect `S` simply re-replays from
  `seq 1`; `R`'s byte-comparison idempotency (§11.1 step 1) makes this safe. Crash
  windows around `R`'s adoption of `C_j^R` and the `ff_reconcile` send are handled the
  same way: reconciliation restarts from replay; no step before `ff_revoke_batch`
  reveals anything `R` cannot safely re-send.
- **`R` returns after `D` but before `T_exp`**: reconciliation proceeds normally; `S`
  cannot have escaped yet, because §7.1's `T_exp ≤ D + escape_delay` constraint (when
  `G > 0`) puts the whole reconciliation window ahead of the escape window.
- **`R` returns after `S` escaped**: `R` claims the aggregate voucher on-chain with its
  key; remaining balance per the escape commitment; audit vs packages for rounding
  fraud.
- **Non-delegated HTLCs arriving for `R` during the epoch** (someone routes to `R`
  outside the delegated set): `S` MUST fail them upstream (`unknown_next_peer`) or hold
  briefly and attempt wake, if separately supported.
- **Duplicate/unknown hash**: fail upstream; never settle a consumed hash again.
- **Close racing a payment**: resolved by `S`'s serial processing order and the signed
  bitmap (§7.5.6). `R` never has to guess whether the last payment landed.
- **Abort after a Variant D voucher round**: the vouchers are ordinary HTLCs that `R`
  fails on the next synchronized channel (§9.5.1); `S` never settles against them.

### 11.3 Liquidity interplay

- **Provisioning is everything.** All offline-receive capacity must exist in the
  channel *before* the epoch: splicing and lease purchases need both signatures, so
  neither can run while `R` is offline. The natural pairing with bLIP-51 liquidity ads:
  `R` leases inbound (`S`'s local balance) sized to expected offline volume, then opens
  the epoch. An FFOR budget is, economically, a *use* for a liquidity lease while the
  buyer sleeps.
- **Advertising**: `S` SHOULD advertise standing FFOR terms alongside its lease rates:
  `node_announcement` TLV **55007**, a 19-byte record
  `{ff_fee_base_msat: u32, ff_fee_ppm: u32, max_budget_msat: u64, max_epoch_blocks:
  u16, variants: u8 bitfield}`, letting `R` price uptime+delegation the same way it
  prices inbound capacity today. The two fee fields are the forwarding fee `S`
  charges for the `S`→`R` hop on delegated payments (§7.6); they need not equal the
  channel's `channel_update` fees, since the route hint `R` signs carries the FFOR
  terms and a payer uses the hint, not gossip, for a private last hop. "Echoing the
  terms" in `ff_init` means: fee fields
  **≥ advertised** (overpaying is acceptable), `budget_msat ≤ max_budget_msat`, epoch
  length ≤ `max_epoch_blocks`, and a variant whose bit is set; `S` rejects an
  out-of-terms `ff_init` with `ff_error`.
- **Tower discovery**: a tower `T` MAY advertise its service in its own
  `node_announcement` via TLV **55043**, a 19-byte record
  `{tower_fee_base_msat: u32, tower_fee_ppm: u32, max_budget_msat: u64,
  max_epoch_blocks: u16, variants: u8 bitfield}` (same field order convention as 55007).
  The dial endpoint is **not** in the TLV; it is the announcement's standard BOLT-7
  `addresses`, so a discovered tower is reached at `node_id@host:port`. `R` selects a
  tower from the gossip graph (filtering by variant and `max_budget_msat`) instead of
  configuring one out-of-band; the chosen `T` is then named in `ff_init` (§7.1 tower
  TLVs) so `S` can reach it. This is discovery only; the trust model is unchanged, and
  the §9.4 role-separation rule still applies (`R` MUST NOT pick a `T` that is its `S`).
- **On return**: vouchers convert to in-channel balance (no on-chain footprint), after
  which `R` can splice-out revenue, `S` can splice-in to replenish sell-side inventory,
  and the next epoch can begin. `R` SHOULD size a revenue splice-out to respect its
  `channel_reserve`, since splicing out the full converted revenue can dip below reserve
  and block subsequent payments. Note the pleasant asymmetry with hold-based schemes:
  FFOR consumes no route CLTV, jams no third-party channels, and parks no sender
  capital; the only locked resource is `S`'s balance in a channel that `R`'s absence
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
| Broadcast pre-epoch state `C_{n0}^S` after any settlement | Revoked by package 1: penalized (tower or returned `R` takes everything). In Variant A the *upstream claim of payment 1 is itself the revocation*: `P_1 = per_commitment_secret_S[n0]`, so the payer and every upstream node hold the revocation evidence the moment the payment completes. A revocation secret is harmless to them (useless without `R`'s keys) but fatal to `S` if it ever cheats: `R` can even recover it from the payer's receipt out-of-band. A false `H_1` binding is detected at settlement 1 (`P_1·G ≠` point), is attributable via the signed `ff_accept`, and downgrades only this evidence channel; tower/penalty paths are unaffected. |
| Broadcast an escape early or with `j` too small | Escape ≠ revoked (unless reconciliation happened, in which case penalized). Early: `R` still gets ≥ owed (ceil rounding), `S` gains nothing and pays the rounding cost. Undersized: provable fraud bounded by `owed − j·G` (signed packages at `T` vs the chain). |
| **Settle upstream, withhold the credit** (never deliver package, never broadcast) | **Variant B: impossible**, since the preimage physically does not reach `S` until `T` durably holds the verified package; `R` recovers everything from `T` even if `S` vanishes. **Variant A: possible**; this is the variant's honest limitation. `R`'s loss is bounded by the epoch budget; the fraud is automatically evidenced (payer holds `R`-signed invoice + preimage; `S` signed `ff_accept` over the hash set; for payment 1 the preimage is also `S`'s own revocation secret). "Cheating is provable and bounded" rather than "impossible": use Variant A only where that suffices. |
| Under-credit the voucher / skim beyond fee | Fixed-amount profile: not possible undetected. The voucher MUST equal the `d_k` in both signed setup messages, `T` refuses any other package before releasing the preimage (B), and `R` refuses it on return (A, D). `S`'s only surplus is fee overpayment the payer chose (§7.6). Amountless profile: `S`'s report of the upstream amount is unverifiable by `T` or `R`, and the payer's receipt states no amount either; the theft is bounded only by what payers send. Use fixed amounts. |
| Refuse reconciliation / stall conversion | `R` force-closes `C_j^R` before `T_exp` and claims all vouchers via pre-signed HTLC-success txs. This is the standard unilateral-close cost, not a loss. |
| **Reuse an invoice / settle the same `H_k` twice** | **Not closed by any variant.** A preimage is a bearer token: once `S` (or any on-path witness) holds `t_k` it can fulfil *every* upstream HTLC carrying `H_k`, and the tower is never consulted for the second. `R` is credited once; the holder pockets the rest. A distribution rule bounds it (a second attempt needs an invoice holder to start it); nothing prevents it: see §13.7.1. |

### 12.2 Fraud-proof inventory

Every dishonest path above leaves third-party-verifiable evidence, by construction:
`R`-signed `ff_init` + invoices (delegation happened, terms), `S`-signed `ff_accept`
(terms + hash set + `n0`), `S`-signed packages (per-payment credit obligations), payer
receipts (settlement happened), the chain (what `S` actually did). This spec does not
define an adjudication venue; the proofs' immediate value is objective blacklisting,
reputation systems, and bonded-`S` arrangements, and they are what keeps rational-`S`
deviation unprofitable even in Variant A.

### 12.3 `R` / `T` / third-party misbehavior

- `R` broadcasts a stale `C_k^R` (`k < j`) or its pre-epoch state: it only shortchanges
  itself (`S`'s vouchers `k+1…j` simply never existed on that state and `S` keeps those
  amounts; every broadcastable `R` state is one `S` signed). No `S` exposure.
- `R` claims a voucher on-chain and *also* disputes off-chain: impossible, as claims are
  hash/sig-bound to states `S` signed.
- `T` alone: holds no funds, no channel keys (except the scoped §9.4(a) option); worst
  case it withholds preimages/packages from `R`; `R`'s recourse is that `T` is `R`'s
  *chosen agent*, typically `R`'s own box; `S`'s packages replayed at reconciliation are
  an independent copy.
- `S`+`T` collusion (Variant B): reduces to Variant A's withholding case, bounded,
  evidenced. `R` chose both its counterparty and its tower; requiring *two* chosen
  parties to conspire is the standard watchtower-grade assumption.
- Payer/upstream: sees a normal payment; learns one revocation secret (payment 1,
  Variant A) that is useless without `R`'s keys. Jamming *this* mechanism is
  unattractive: delegated HTLCs settle instantly, so there is nothing to jam, a strict
  improvement over hold-invoice-based offline receive, which hands griefers long-lived
  route locks.
- DoS on `S`/`T`: rate-limit invoice serving; packages are cheap (~`32·i + few hundred`
  bytes); `K` bounds everything.

### 12.4 What is genuinely weaker than online receive

Stated plainly: (1) Variant A's and Variant D's bounded withholding exposure; (2)
`payment_secret` unenforced, and single-use hashes are an **assumption the protocol does
not enforce**: reuse is bounded by who holds the invoice and is not cryptographically
prevented in any variant or distribution configuration (§13.7.1); (3) in the amountless profile only, amount attestation is amountless-grade and
`S`'s reported amounts are unverifiable (§7.6, §13.3), which the fixed-amount
profile removes; (4) `R` must return before `T_exp` or its claims rest
on `S`'s honesty / escape rounding; (5) `S` learns `R`'s offline schedule and all payment
amounts (it learns the latter as last hop today anyway); (6) vouchers below the economic
enforcement threshold (§8) are collectible only from a cooperative `S`.

### 12.5 Why an always-online agent is necessary (normative rationale)

This section states a bound on the design space. It is here because the tower reads like
an engineering compromise that a sufficiently clever script could remove, and it is not.

At settlement time there are exactly **two digital items** in flight. `S` holds one: the
preimage, without which it cannot claim upstream. `R` holds the other: consent to a
commitment state that credits it. The protocol must exchange these **fairly, while `R` is
asleep**. That is the fair-exchange problem, and *deterministic fair exchange without a
trusted third party is impossible* (Pagnia and Gärtner 1999; Even, Goldreich and Lempel
before them). See §16.

Bitcoin normally sidesteps this, because the chain **is** the trusted third party: a
hash-locked atomic swap is fair exchange with consensus as arbiter. But that construction
requires **both parties to act**. `R` is offline by construction, so `R`'s half of the
swap must be pre-played, and the design space forks into exactly three points, all three
of which this spec now occupies:

| | `R`'s half | `S` can withhold the credit | `R` can fabricate credit |
|---|---|---|---|
| Variants A/B | played live, per payment (`S`'s package signature mints the voucher) | **yes** (A) / no (B, `T` gates it) | no |
| Variant D (§9.5) | **pre-played at setup** (vouchers exist from block one) | yes, but the payer holds the key | no, *while `S` holds the preimages* |
| Variant D + tower (§9.5.5) | pre-played at setup | **no** | **yes**, if `R`'s tower leaks a preimage |

Pre-playing `R`'s half protects `R` and exposes `S`. Not pre-playing it protects `S` and
exposes `R`. Interposing `T` between the two items (Variant B) protects both, and costs an
always-online party. **Someone has to hold the balance point, and script cannot hold it.**

Concretely, and this is the answer to every "could we not just do it with
scripts/taproot/covenants":

- **Script cannot force a message to be sent.** `S` withholding a signature is invisible
  to consensus. There is no opcode for "you did not send that."
- **Script cannot prove a negative.** Every construction of the form "`S` must demonstrate
  it did *not* settle payment `k`" fails, because knowledge is monotonic: `S` can never be
  compelled to prove it does not know something. And the only positive evidence that a
  settlement occurred, the preimage, is exactly what a cheating `S` withholds.
- **Script cannot force `S` on-chain.** `S`'s only compelled on-chain action is the escape
  (§10), and `S` escapes only when `R` has *vanished*, never in the case that matters. In
  the cooperative-close case, nothing about the epoch ever touches the chain, so the chain
  cannot adjudicate it.
- **Covenants do not help.** CTV, CSFS, OP_VAULT and relatives constrain *how* an output
  is spent, never *whether*. `S` can always decline to act.
- **Taproot changes the encoding, not the game**, and neither do PTLCs on their own:
  §13.5's Variant C still composes adaptor shares from `S` **and `T`**. The obstruction is
  topological, not cryptographic. `S`'s upstream claim necessarily reveals its secret
  *toward the payer*, because that is the direction the HTLC arrived from. `R` sits
  **beside** the payment path, not at its end. No signature scheme relocates it.

What survives this bound is not "trust a server" but a choice of **who bears a bounded
exposure**, plus a free hand in how small the online agent gets:

- §5.1's long `to_self_delay` removes the **watching** role entirely, with script, today.
  Nothing in §9.4's chain-watch, penalty, or scoped-key machinery is needed under it.
- §9.5 removes the **mediating** role by pre-playing `R`'s half, landing at Variant A's
  trust level with the payer as a structurally guaranteed, independent holder of the
  preimage, and with no online infrastructure of any kind.
- §9.5.5 restores `R` to Variant B's guarantee with a tower reduced to a preimage store
  and a released bitmap, at the cost of moving the exposure onto `S`.

An implementation seeking "fully trustless with no server" should read this section as:
**take §5.1 and §9.5, and accept that a settling-and-withholding `S` costs `R` at most the
epoch budget and at least one unreachable payer.**

---

## 13. Limitations and open problems

### 13.1 MPP
`S` cannot read `total_msat` in the final onion (undecryptable), so it cannot know when
a multipart set completes. v1: delegated payments MUST be single-part; `S` fails
surplus parts carrying an already-settled hash. Possible v2: delegation-time rule
("accumulate parts on `H_i` for up to `t` seconds, settle when sum ≥ payer-signaled
total via TLV in the *outer* onion"); needs sender cooperation, deferred.

### 13.2 Invoice distribution / BOLT 12
Pre-signed BOLT 11 invoices, fixed-amount under §7.6's fixed-amount profile and
amountless otherwise, remain the vehicle for payers `R` knows before going offline. For
unknown payers, §9.7 specifies a BOLT 12 issuer at the end of the offer's paths, which
BOLT 12 already lets sign invoices with no new authority. The async-payments work
(static invoices held by an always-online node,
[BOLT PR #1149](https://github.com/lightning/bolts/pull/1149)) solves the same
distribution problem for the hold-and-release model; §13.7.1 says why `S` MUST NOT be
the party serving invoices in either design, and §9.7 puts the issuer with the
witnesses instead.

### 13.3 Amount-binding in receipts
In the fixed-amount profile (§7.6) the payer's receipt is `R`'s signed invoice for
exactly `d_k` plus the preimage, and it proves that `R`'s request for exactly `d_k` was
paid: `S` reveals `t_k` only by settling, and a conforming `S` settles only at
`amt_to_forward == d_k` (within the blinded-path slack). In Variants B and D that is
also proof that `R` holds an enforceable claim for `d_k`, because the voucher's
signatures exist before the preimage is released. In Variant A it is not, until the
settlement package reaches `R`: the receipt proves payment of the request, and the
package proves the claim. A non-conforming `S` that settles at a lower amount gains
nothing, since the voucher still pays `d_k`. Where it holds, this is stronger than an
ordinary online receipt, which attests the invoice amount but not an overpayment. In the amountless
profile the receipt proves *a* payment, not its size; the signed settlement package,
which states `htlc_amount_msat`, partially repairs this, but the package is `S`'s own
report (§7.6). PTLCs would repair the amountless case properly.

### 13.4 Simple-taproot channels
MuSig2 funding does not block fast-forwards: `S` contributes its partial signature on
`C_i^R` unilaterally; `R` completes the aggregate on return. It *does* require `R`'s
verification nonces for `K` future commitments to be pre-shared, which a deterministic
verification-nonce derivation (as beignet already implements for reestablish:
`HMAC(per_commitment_seed, tag‖height)`) makes straightforward, and it complicates the
tower's checklist (partial-sig verification) and the penalty path (taproot revocation
key-path tweaks). Deferred to a v2 appendix; v1 is ECDSA-anchor only.

### 13.5 PTLC upgrade (Variant C)
With PTLCs, replace hashes with points and compose: the upstream payment point requires
adaptor shares from both `S` and `T`, so `S`'s completed upstream adaptor signature
*is* the release event, cryptographically inseparable from the package commitment, so
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

### 13.7 Invoice serving and hash reuse (bounded, not closed)

A preimage is a **bearer token**. Once `S` holds `t_k`, it can fulfil *any* upstream HTLC
carrying `H_k`, not merely the first. If a second payer pays an HTLC with
`payment_hash = H_k`, `S` fulfils it from the `t_k` it already has: the tower is never
consulted, no second package is ever created, `R` is credited **once**, and `S` pockets
the second payment. `R` has no way to learn that it happened.

**This is not closed by Variant B.** `T`'s gating binds only the *first* settlement on
each hash; after that, `S` needs nothing from anyone. It is not closed by Variant D
either, whose voucher book has exactly one output per hash. It is the one theft vector in
this spec that no variant's cryptography addresses, and unlike Variant A's withholding it
is **not bounded by the epoch budget**: it is bounded only by what payers actually send.

Characterized against the reference implementation (beignet `feat/ffor`) in a two-test
gate (M8.8, §15.2), which sharpened the finding. An **honest** `S` *does* refuse the
duplicate: on a second payment for a consumed hash it fails upstream with
`duplicate delegated payment for consumed hash H_k`. Single-use is implemented. But that
refusal is **self-imposed by `S` and unverifiable by anyone else**. The tower's gate is
keyed and idempotent on `seq`, and `seq` was consumed by the first settlement, so a second
settlement on `H_k` never reaches `T`; `R` is offline and no package, tower record, or
chain artefact is produced. A malicious `S` that simply omits its own guard fulfils the
second payer with the token `t_k` it already holds, via an ordinary `update_fulfill_htlc`,
and `R` is credited exactly once with no evidence it could ever act on. The test confirms
this end-to-end: same `S` node identity, a second payer, no tower interaction, `R`'s epoch
state byte-identical before and after the theft. The gap is therefore not a missing check
in the implementation but the **absence of any place to put an enforceable one**: nothing
`R` or `T` observes distinguishes one payment on `H_k` from two.

§13.1's "`S` fails surplus parts carrying an already-settled hash" and §12.4's "mitigated
by single-use hashes" are both MUSTs aimed squarely at the party that would be cheating.
Single-use is enforceable only by whoever **distributes** the invoices:

- **`R` distributes its own invoices out-of-band before going offline** (one per known
  payer, per order). `S` then cannot *induce* a second payment on a hash it was never
  able to hand out; a second attempt needs someone who holds the invoice to make it.
  This is the safest configuration and **SHOULD be the v1 default**; it is also the
  configuration in which `R`'s pre-signed invoice set is a natural fit. It is a
  mitigation, not a closure (§13.7.1).
- **`S` serves `R`'s invoices.** `S` then holds exactly the capability this attack
  requires. §13.2's proposed convergence with async-payments invoice serving (a static
  invoice held by an always-online node) therefore **MUST NOT** place `S` in that role
  without a further binding. The natural candidate holder is `T`, which can enforce
  single-use and which, under §9.5.5, is already the party gating each hash.
- **Enforceable amount- and payer-binding** (BOLT 12, or PTLC proof-of-payment
  uniqueness, §13.5) closes it properly, by making each payment's secret distinct even on
  a reused offer.

Until one of those lands, this bounds how much invoice distribution may be delegated to
`S`, and it should be read as a constraint on §13.2's roadmap rather than a footnote.

#### 13.7.1 What the distribution rule does and does not do

Keeping `ff_invoices` away from `S` (§7.3) removes `S`'s ability to *create* a second
payment on a consumed hash. It is defence in depth. It is **not** a cryptographic
single-use guarantee, and this spec makes no claim that any configuration is
"theft-free". The security property FFOR needs is

```
one successful logical payment  ->  one independently recoverable receiver credit
```

and the HTLC construction does not enforce that mapping once anyone on the path holds
`t_k`:

1. A BOLT 11 invoice is a transferable bearer object. Its intended holder can forward
   it, leak it, or pay it twice.
2. A public distributor serving unknown payers cannot reliably distinguish `S`, or a
   Sybil identity `S` controls, from a payer. Serving an invoice once does not stop the
   recipient from copying it.
3. BOLT 2 requires a receiver to accept multiple HTLCs carrying the same
   `payment_hash`. Honest MPP, a retry after an ambiguous result, and concurrent
   attempts all present one hash more than once, so "second HTLC on `H_k`" is not by
   itself evidence of anything.
4. After the first settlement `S` holds `t_k` and needs nothing from `T`, `R`, or the
   chain to fulfil every later HTLC on `H_k`.
5. Every receipt witness on the path (issue #24) learns plaintext `t_k` when the
   fulfil passes through it. A witness can settle a later HTLC on `H_k` itself and never
   forward that attempt to `S`. The party that can take a reused hash is therefore any
   on-path holder of `t_k`, not only `S`.
6. An invoice stays payable until its `expiry`; §7.5.6 ties that to `D` so an invoice
   cannot outlive its slot, but it can still be paid a second time inside the window.

The accurate statement is: **reuse requires someone who possesses the invoice to
initiate another attempt, and FFOR does not cryptographically prevent it.** The honest
`S` guard of M8.8 (refuse a consumed hash) is real, is required, and is enforced by the
party that would profit from omitting it.

The narrow deployment in which no second attempt can arise is: `R` hands one
fixed-amount invoice directly to one known, conforming payer; MPP is disabled; the payer
pays it once; and `S` durably rejects later attempts. Every wider deployment carries the
residual above, bounded by what payers send, and MUST be described that way.

The stronger target is a fresh per-payment secret that `S` cannot reuse alone. PTLCs
are not sufficient by themselves: closing reuse needs a payer-specific tweak *and* a
fresh online gate input per settlement, which changes the payer protocol and reintroduces
an always-online party on the settlement path (§13.5, §12.5). That construction is
future work, and nothing in v0.9 depends on it.

A conformance test for this section MUST count receiver-enforceable credits, not
whether an honest `S` returned an error. Cases: the same signed invoice delivered to two
payers; `S` obtaining an invoice from a public distributor under another identity; two
concurrent same-hash HTLCs; MPP on one hash; a retry after an ambiguous fulfil; a payment
after `ff_close` but before invoice expiry; a witness settling a second same-hash HTLC;
and a malicious `S` omitting its consumed-hash check. M8.8(b) is the last of these and is
expected to keep passing (the theft succeeds) until the stronger target lands.

---

### 13.8 D1-WR: terminal one-shot witness recovery (deferred)

D-R (§9.6) covers an `R` that returns inside its window. An `R` that may never return
needs a witness that can enforce on its behalf, which means giving a witness a
complete, fee-funded broadcast kit for `R`'s commitment. That is only safe if the
commitment can never be revoked, since a witness holding an old signature is otherwise
a stale-state broadcaster in waiting. The construction, D1-WR, is: `K = 1`, the
voucher-bearing commitment is terminal, the funding output is ultimately spent rather
than the channel returning to ordinary operation, and after a configured trigger the
witness publishes the receiver claim and the channel closes. Deletion or a signed
delete acknowledgement never makes an old Bitcoin signature safe; terminality is the
property. A reusable autonomous profile needs a non-penalty state construction
(LN-Symmetry or a covenant-backed receive slot). D1-WR is documented in issue
coreyphillips/ffor#24 and is not part of this version.

## 14. Message and TLV registry (provisional)

| Type | Name | Dir | Signed |
|---|---|---|---|
| 55001 | `ff_init` | R→S | ✍ |
| 55003 | `ff_accept` | S→R | ✍ |
| 55005 | `ff_invoices` | R→S | (invoices individually signed) |
| 55009 | `ff_escape_sigs` | R→S | |
| 55011 | `ff_begin` | | removed in v0.9; MUST NOT be sent |
| 55013 | `ff_settlement` | S→R, S→T | ✍ |
| 55015 | `ff_reconcile` | R→S | |
| 55017 | `ff_reconcile_ack` | S→R | |
| 55019 | `ff_revoke_batch` | R→S | |
| 55021 | `ff_end` | | removed in v0.9; MUST NOT be sent |
| 55023 | `ff_error` | both | |
| 55045 | `ff_activate` | R→S | ✍ (§7.5.4) |
| 55047 | `ff_activate_ack` | S→R | ✍ |
| 55049 | `ff_abort` | both | ✍ |
| 55051 | `ff_close` | R→S | ✍ |
| 55053 | `ff_close_ack` | S→R | ✍ |
| 55055 | `ff_witness_provision` | R→W | (manifest signed under `fetch_key`, Appendix F.1) |
| 55057 | `ff_witness_ack` | W→R | |
| 55059 | `ff_witness_fetch` | R→W | ✍ (`fetch_key` digest, Appendix F.1) |
| 55061 | `ff_witness_fetch_resp` | W→R | (records individually signed by `W`) |
| 55063 | `ff_witness_close` | R→W | ✍ (`fetch_key`) |
| 55065 | `ff_witness_close_ack` | W→R | |
| 55067 | `ff_issuer_provision` | R→I | (manifest with `R`'s attestation, Appendix F.6) |
| 55069 | `ff_issuer_ack` | I→R | |
| 55071 | `ff_issuer_status` | R→I | ✍ (`fetch_key`) |
| 55073 | `ff_issuer_status_resp` | I→R | |
| 55031 | `ff_tower_provision` | R→T | |
| 55033 | `ff_tower_ack` | T→R | |
| 55035 | `ff_tower_release` | S→T | (carries the ✍ `ff_settlement`) |
| 55037 | `ff_tower_release_resp` | T→S | |
| 55039 | `ff_tower_fetch` | R→T | ✍ (§9.4 digest) |
| 55041 | `ff_tower_fetch_resp` | T→R | |

55007 is not a message type; it is the `node_announcement` TLV below.

`channel_reestablish` TLVs: 55001 (epoch state and `H_act`, §11.1), 55003 (`S`'s catch-up per-commitment
point, iff escapes; §11.1). `ff_accept` TLV 7: `s_htlc_id_base` (§7.2). `ff_init`
TLV 9 and `ff_accept` TLV 9: `voucher_amounts_msat` (§7.1, §7.2, §7.6). `ff_accept`
TLV 11: `init_hash` (§7.2, §7.5.2). `ff_init` TLV 13: `witness_peers` (§9.6.3).
`ff_close_ack` TLV 1: `preimages` (§7.5.4). BOLT 12 invoice TLV 1000055001:
`ffor_issuer_attestation` (§9.7.5). Feature bits
560/561 (`option_ff_receive`). `node_announcement` TLVs 55007 (FFOR standing terms,
§11.3) and 55043 (tower service advertisement, §11.3). All numbers provisional
pending bLIP assignment.

**Variant D (§9.5) allocates no message types of its own.** It uses `ff_init`
(`variant = 4`), `ff_accept` and optionally `ff_invoices` for setup, the lifecycle
messages of §7.5 that every variant shares, and nothing else: the voucher book is
committed by stock BOLT 2 `update_add_htlc` / `commitment_signed` / `revoke_and_ack`
traffic, settlement sends no message, and draining is stock `update_fulfill_htlc` /
`update_fail_htlc`. `ff_settlement`, `ff_escape_sigs`, `ff_reconcile`,
`ff_reconcile_ack`, `ff_revoke_batch` and the Appendix C tower transport are
all **unused** in plain Variant D (§9.5.5's optional tower uses a reduced form of
`ff_tower_provision` / `ff_tower_release` / `ff_tower_fetch`). `ff_accept` TLV 1 carries
the hash set, `S`-generated, **without** the §7.2 `H_1` revocation-secret binding, which
is forbidden under `variant = 4`. This is the registry's way of saying that Variant D is
not an extension of the protocol but a large subtraction from it.

Appendices: (A) canonical `C_i^R` construction test vectors, see companion file
`ffor-test-vectors.md`; (B) escape commitment and aggregate voucher script + weights,
below; (C) tower transport (provisioning/authentication wire format), below;
(D) Variant D setup transcript and both-view commitment vectors for §7.5 and §9.5.1,
see companion file `ffor-variant-d-vectors.md`; (E) taproot variant, TBD; (F) witness
transport and the payment mailbox object, below.

---

## 15. Prototype plan (beignet ↔ beignet)

Everything below reuses existing beignet machinery: quiescence (splicing), hold
invoices + wake (M2 async payments), commitment building, pre-signed HTLC-success
handling, shachain stores, liquidity ads (M3), and the regtest/bitcoind harness.

1. **M1, epoch setup**: messages 55001-55011 (55011 since replaced by §7.5's lifecycle), FF_SETUP/FF_EPOCH channel states (since renamed, §7.5.1),
   parameter validation, persistence. Gate: epoch established, `R` disconnects, both
   sides restart and recover epoch state.
2. **M2, Variant A settlement + reconciliation**: package build/verify, deterministic
   `C_i^R`, upstream settle, reestablish TLV, replay, reconcile, revoke batch, voucher
   fulfillment. Gate: payer→`S`→(offline `R`) settles for payer; `R` returns; balances
   correct; full suite green.
3. **M3, on-chain enforcement**: `R` force-closes `C_j^R` post-return and sweeps all
   vouchers via pre-signed HTLC-success (bitcoind-validated); penalty of `C_{n0}^S`
   from package-1 secret (bitcoind-validated); ChainMonitor/output-resolver
   classification for voucher outputs.
4. **M4, tower (Variant B)**: standalone minimal tower (outside beignet core),
   checklist verification, release flow, package serving, breach watch. Gate:
   withholding-`S` chaos test; `R` recovers everything from `T` with `S` gone.
5. **M5, escapes**: deterministic escape set, pre-signing, escape broadcast + timeout
   claim + post-reconcile penalty of a stale escape (bitcoind-validated).
6. **M6, liquidity integration + chaos**: lease-then-epoch flow, advertised terms TLV,
   splice-on-return; crash matrix at every arrow in §6's diagram; multi-payment epochs
   at `K` and budget boundaries.

### 15.1 M7: hardening the tower into a deployable service

M4 proved a tower can gate settlement. M7 turned that prototype into something that
survives operations, and its results are normative in §9.4 and §11.3 rather than being
confined to this list. Appendix C was drafted alongside it but not built (see its
status note).

1. **M7.0: Durable store and restart contract.** `T` persists the full provisioning
   bundle, not just the settlement record, and rehydrates every epoch on restart with no
   `R` involvement. Gate: restart mid-epoch with `R` offline throughout; `T` still
   serves released preimages idempotently, still rejects a differing package for an
   already-released `seq`, and still verifies and releases the *next* `seq`. Normative
   in §9.4's restart contract.
2. **M7.1: Tower transport boundary.** The tower is reached through an abstract
   provision / release / fetch client rather than being wired into the channel, so a
   transport can be swapped without touching tower logic. Gate: the same tower serves
   both an in-process loopback (tests) and an out-of-process transport (the tower
   example). **Appendix C's BOLT-8 wire format was written against this boundary but
   is not implemented**; see the status note there.
3. **M7.2: Role separation and node-embedded breach-watch.** A tower running inside a
   full node refuses epochs where it is `S` (and should refuse where it is `R`), and
   arms funding-outpoint watches from durable state on restart. Gate: provisioning
   rejected on identity collision; a mid-epoch revoked broadcast routed to the breach
   classifier after a tower restart. Normative in §9.4.
4. **M7.4: Tower discovery.** `T` advertises its terms in `node_announcement` TLV
   55043; `R` selects from the gossip graph rather than out-of-band configuration. Gate:
   an `R` with no pre-configured tower provisions one found in gossip and completes an
   epoch. Normative in §11.3.

M7.3 is not recorded in this document. The four entries above are reconstructed from the
work that landed in §9.4, §11.3 and Appendix C; if M7.3 produced anything normative it
still needs writing up here.

### 15.2 M8: Variant D and watchtower-free operation

M8 validates that the tower can be removed on both axes (§5.1 for watching, §9.5 for
mediating). It should be cheaper than any prior milestone, because Variant D deletes
machinery rather than adding it: no packages, no escapes, no unilateral updates, no tower
transport.

1. **M8.0: Watchtower-free penalty (§5.1).** Open a channel with
   `to_self_delay_S > (T_exp − epoch_start) + margin`. Run any variant's epoch, have `S`
   broadcast the revoked `C_{n0}^S` mid-epoch with nothing watching, bring `R` back after
   the full offline window, and penalize. **Gate:** justice transaction confirms with
   `R`'s CSV margin intact and no tower process ever running. Verifies that the §9.3
   classification rule (treat any counterparty commitment whose revocation secret we hold
   as revoked) still fires on a cold-start `R`.
2. **M8.1: Voucher book setup.** The §9.5.1 sequence exactly: `ff_init` / `ff_accept`
   with TLVs 9 and 11, `K` `update_add_htlc` with the specified onion, both
   `commitment_signed` and both `revoke_and_ack`, then `stfu` ×2, `ff_activate`,
   `ff_activate_ack`. **Gate:** no update message between either `stfu` and the ack
   (assert on the wire log); both sides hold mutually signed, non-revoked commitments
   with `K` HTLC outputs at `T_exp` in **both** views; byte-exact against a BOLT 3
   reference; every second-stage signature verifies; both sides compute the same
   `T_init`, `T_setup`, `H_book`, `H_commit` and `H_act` (Appendix D vectors); `ACTIVE`
   survives a disconnect and a restart on each side, and a disconnect before the ack
   aborts with the vouchers failed.
3. **M8.2: Silent settlement.** Payer pays voucher `k`'s pre-signed invoice while `R` is
   offline. **Gate:** payer sees SUCCESS; `S` sends **zero** messages to `R` and zero to
   any tower for the whole epoch (assert on the wire log, not just on balances).
4. **M8.3: Cooperative return.** `R` reconnects, sends `ff_close`, receives
   `ff_close_ack` with bitmap and preimages, fulfils settled vouchers, fails the rest.
   **Gate:** one commitment round, entirely stock BOLT 2 after the ack; balances
   correct; the only FFOR messages after activation are `ff_close` and `ff_close_ack`;
   a payment racing `ff_close` lands on exactly one side of the bitmap and `R`'s drain
   agrees with it; `S` retransmits the ack on a reestablish from an `ACTIVE` `R`.
5. **M8.4: Withholding `S`, payer rescue.** `S` settles upstream, then vanishes without
   revealing any preimage. `R` returns, obtains `t_k` **from the payer's receipt alone**,
   force-closes, and sweeps voucher `k` via the setup-time HTLC-success signature.
   **Gate:** `R` recovers the full voucher with no cooperation from `S` and no tower.
   This is the milestone that proves §9.5.3.
6. **M8.5: Hash chain (§9.5.4).** Chain-derived preimages; three payments at levels 1..3;
   `R` obtains **only `x_3`** (from the most recent payer) and claims all three vouchers by
   deriving `x_2`, `x_1`. **Gate:** all three sweep from a single 32-byte secret.
7. **M8.6: `R` cannot fabricate credit.** Adversarial `R` attempts to claim a voucher
   whose payment never arrived. **Gate:** claim is unconstructable (no preimage); and the
   inverse test, an `S` that leaks `t_k` to a mailbox *before* the upstream HTLC is
   irrevocably fulfilled, MUST be caught by the §9.5.2 ordering assertion.
8. **M8.7: Vanished `R`.** No reconciliation; `S` force-closes after `T_exp` and sweeps
   every unclaimed voucher via HTLC-timeout. **Gate:** `S` whole (no escape machinery
   present in the build); `R`'s `to_remote` claimable whenever it returns.
9. **M8.8: Hash reuse (§13.7), characterization.** Two tests, both **passing today**, that
   pin the open problem rather than gate against it. (a) An honest `S` refuses a second
   payment on a consumed hash (`duplicate delegated payment for consumed hash`), proving
   single-use *is* implemented. (b) A malicious `S` (same node identity, its own duplicate
   guard omitted) claims a second payer on `H_k` with the token alone: the payment
   completes, the tower is never consulted, and `R`'s epoch state is byte-identical before
   and after, proving the theft is currently possible and evidence-free. Test (b) is
   written to **invert** (start failing) the day BOLT 12 / PTLC payer-and-amount binding
   (§13.5) makes the second settlement unconstructable, giving that future work a
   regression target. Unlike M8.0 to M8.7 this milestone is **not blocked on Variant D**:
   it characterizes the existing Variant B implementation and is already implemented
   (`tests/lightning/ffor-hash-reuse.test.ts`, in-memory, no bitcoind, green as of this
   writing).

---

### 15.3 M9: D-R receipt witnesses

Builds on M8 (plain Variant D on master). Each gate is judged by what `R` can enforce.

1. **M9.0: Witness module and manifest.** `ff_witness_provision` / `ff_witness_ack`
   over BOLT 8; manifest verification; capacity reservation; durable manifest store
   that rehydrates on restart with `R` offline. **Gate:** provision, restart the
   witness, fetch an empty mailbox; a manifest with a bad `fetch_key` signature or an
   inconsistent book is refused.
2. **M9.1: Store before propagate.** The §9.6.5 barrier on a three-hop path
   `P → W → S → R` with `R` offline. **Gate:** the record is fsync-committed before
   the upstream `update_fulfill_htlc` leaves `W` (assert on the store and the wire
   log); the payer sees success; `S` sends nothing to `R`; the barrier deadline case
   propagates with the `unbarriered` flag.
3. **M9.2: Witness rescue.** `S` settles and vanishes. `R` returns, fetches from `W`
   alone, decrypts, verifies, force-closes and sweeps the voucher with the setup-time
   signature. **Gate:** `R` recovers `d_k` with no cooperation from `S` and no payer.
4. **M9.3: Crash matrix.** Every §9.6.8 case for `S` and `W`, both sides of every
   durable write, on regtest. **Gate:** each case ends with exactly the records and
   the enforceable claims §9.6.5 implies.
5. **M9.4: Reuse by a witness, characterization.** A witness that settles a second
   same-hash HTLC itself. **Gate:** the theft succeeds and is evidence-free, as
   §13.7.1 says; the test inverts when a payer-bound settlement primitive lands.
6. **M9.5: Issuance.** The §9.7 issuer, co-hosted with the first witness: a stock
   BOLT 12 payer holding only the offer obtains an invoice for an unconsumed slot and
   pays it while `R` is offline. **Gate:** §9.7.8 in full, including the crash between
   mark and send and the byte-identical refusals.

## 16. Prior art and references

- ZmnSCPxj, *Fast Forwards*, [lightning-dev, April 2019](https://lists.linuxfoundation.org/pipermail/lightning-dev/2019-April/001986.html);
  *Fast Forwards By Channel-in-Channel Construction*, [lightning-dev, October 2021](https://lists.linuxfoundation.org/pipermail/lightning-dev/2021-October/003265.html)
- Lloyd Fournier's offline-receive observation on fast forwards,
  [Bitcoin Optech #152](https://bitcoinmagazine.com/technical/bitcoin-optech-lightning-node-payments);
  popular summary: [Protos](https://protos.com/bitcoin-lightning-dev-fix-existential-problem-offline-crypto-payments/)
- Async payments: Matt Corallo's brainstorm and successors,
  [Bitcoin Optech topic](https://bitcoinops.org/en/topics/async-payments/);
  [BOLT 12 async payments, lightning/bolts #1149](https://github.com/lightning/bolts/pull/1149);
  [proof-of-payment wishlist thread](https://www.mail-archive.com/lightning-dev@lists.linuxfoundation.org/msg03075.html);
  trampoline-hold deployments: [eclair #2424](https://github.com/ACINQ/eclair/issues/2424),
  [Breez Lightning Rod](https://medium.com/breez-technology/introducing-lightning-rod-2e0a40d3e44a)
- bLIP-51 liquidity ads (budget provisioning); BOLTs 2/3/5 (all reused machinery)
- Fair-exchange impossibility (the bound §12.5 rests on): Henning Pagnia and Felix
  Gärtner, *On the Impossibility of Fair Exchange without a Trusted Third Party*,
  Darmstadt University of Technology TUD-BS-1999-02, 1999; Shimon Even, Oded Goldreich and
  Abraham Lempel, *A Randomized Protocol for Signing Contracts*, CACM 28(6), 1985

FFOR's delta over fast-forwards as previously discussed: the complete delegation and
settlement protocol around the core update (packages, tower gating of preimage release,
the revocation-secret-as-first-preimage evidence binding, uniform-expiry vouchers,
pre-signed granular escapes, and batch reconciliation), such that the payer-side payment
*completes* while the recipient is offline, the property neither hold-based nor
async-payment designs provide.

---

## 17. Errata

### 17.1 v0.8 → v0.8.1

Behaviour changes. An implementation built against v0.8 is not interoperable with one
built against v0.8.1 in any of these respects.

| # | Section | v0.8 | v0.8.1 |
|---|---|---|---|
| 1 | §8 | A voucher's sub-satoshi remainder stays with the offerer's `to_local` | BOLT 3's rule: the offerer's balance drops by the full millisatoshi and every output is floored, so the remainder raises the on-chain fee. Appendix A regenerated against a corrected builder: `C_0`/`C_1` unchanged, `C_2`'s `to_remote` 6994130 to 6994129 and `C_3`'s 6943951 to 6943950, with the dependent txids and signatures |
| 2 | §7.2, §14 | `ff_accept` TLV 1's `H_1` binding was scoped ambiguously | Binding is Variant A only and **forbidden** in Variant D, where `S` reveals `per_commitment_secret_S[n0]` in the setup `revoke_and_ack` and the binding would hand `R` an unpaid voucher |
| 3 | §7.1, §10, §11.2 | Nothing bounded `T_exp − D` | With `G > 0`, `T_exp ≤ D + escape_delay`, so the escape window cannot open inside `R`'s reconciliation window |
| 4 | §11.1 | `S`'s `last_seq` is authoritative for the replay count | It is a lower bound; `R` adopts the highest `seq` it can validate from any source |
| 5 | §8 | Reserve checked on `S` only; `K` bounded by `min(max_accepted_htlcs)` | Both parties' reserves checked with the funder's fee delta charged correctly; `K ≤ R`'s `max_accepted_htlcs` and `K ≤ 483` |
| 6 | §9.5.5 | §9.4's role-separation and restart contract "disappear" | Both still bind (in reduced form for durability); only the node-embedded breach-watch drops out |
| 7 | §7.3 | Invoices amountless and strictly ordered, unconditionally | Per-variant: A/B amountless and ordered, D fixed-amount and unordered. Message is now chunked |
| 8 | §7.4 | `J` unbounded | `J ≤ 1022`, rejected at `ff_init`; `num_escapes` validated on receipt rather than at `ff_init` (§B.5) |
| 9 | §7 | Signature over `SHA256(type ‖ body)` | Domain-separated: `SHA256("ffor/msg" ‖ type ‖ body)` |
| 10 | §9.4, C.1, C.2 | Fetch nonce "`T`-issued", with no message issuing one; `last_released` 4 bytes; `r_node_id` absent from the bundle | Requester-chosen nonce with `T` rejecting repeats; `last_released` `u16`; `r_node_id` in the bundle |

Editorial only, no behaviour change: `escape_htlc_sigs` removed (§7.4); the
`option_anchors` / `option_anchors_zero_fee_htlc_tx` duality collapsed (§5, §8);
`ff_release` renamed to Appendix C's `ff_tower_release_resp`; §6's "no broadcastable
commitment at all" qualified for the `G > 0` case; §14's registry lists the Appendix C
messages; §15.1 documents M7 and M8 moves to §15.2.

### 17.2 v0.8.1 → v0.8.2

Behaviour changes, all from the amount model of §7.6 (issue #21). An implementation
built against v0.8.1 is not interoperable with one built against v0.8.2 in any of
these respects.

| # | Section | v0.8.1 | v0.8.2 |
|---|---|---|---|
| 1 | §7.6, §8 | `v_k = htlc_amount − fee(htlc_amount)`: the fee was skimmed from the incoming amount and computed on it | `v_k` is the payee amount (`d_k`, or `amt_to_forward`); `fee_S` is computed on the payee amount and paid by the incoming HTLC on top of it, as the ordinary last-hop forwarding fee |
| 2 | §7.1, §7.2, §14 | Voucher amounts never on the wire; Variant D's `d_k` implied by the invoices | `ff_init` TLV 9 carries `d_1…d_K`; `ff_accept` echoes it byte-identical; both signed. REQUIRED in Variant D; selects the fixed-amount profile in A and B |
| 3 | §7.3, §9.5.1 | Variant D invoice amount `d_k + fee(d_k)` | Invoice amount exactly `d_k`; the fee lives in the route hint |
| 4 | §7.6, §9.5.1 | `S` accepted `htlc_amount ≥ d_k + fee(d_k)` | `amt_to_forward == d_k` (equality) and `amount_msat − d_k ≥ fee_S(d_k)` |
| 5 | §9.4 | `T` checked `voucher_amount == htlc_amount − fee(htlc_amount)`, i.e. against `S`'s own report | `T` checks `voucher_amount == d_seq` from provisioning; `htlc_amount` is never an input to the expected voucher amount |
| 6 | §7.1 | `budget_msat` an upper bound in every variant | Fixed-amount profile: MUST equal `Σ d_k` |
| 7 | §7.6 | No overflow or bounds rule | `d × ppm` and `gross_into_S` bounded by `2^64 − 1` and checked at setup; trimming, `htlc_minimum_msat`, in-flight and slot limits checked at setup in the fixed-amount profile |
| 8 | Appendix A | Inputs were incoming HTLC amounts, vouchers derived; `K = 8`, `budget` and `min_payment_msat` inconsistent with the fixed-amount rules | Inputs are the payee amounts `d_k`; incoming amounts derived; `K = 3`, `budget = Σ d_k`, `min_payment_msat` at the dust floor. Every commitment, txid and signature is byte-identical to v0.8.1. New A.5 arithmetic vectors |
| 9 | §7.6 | Funder and `S` obligations conflated; fee reserved at the frozen feerate only | `S` covers budget plus its reserve; the funder, whichever side, covers base fee, `K` HTLC outputs and both anchors at twice the frozen feerate above its reserve |
| 10 | §7.6 | `S` reads plaintext `amt_to_forward` | Plaintext under a BOLT 11 route hint; under a BOLT 12 blinded path `S` derives it by BOLT 4's inverse formula, check 1 admits `rounding_slack(d_k)` with `N = 8`, and every failure is `invalid_onion_blinding` |
| 11 | §9.5.4 | Multi-level hash-chain invoices `(p, j)` of amount `(j − p)·G` | One level per invoice, amount `G`; multi-level and non-multiple amounts deferred to #23 |

Editorial only: §3 gains `d_k` and `fee_S`; §9.2, §12.1, §12.4 and §13.3 now
distinguish the fixed-amount and amountless profiles; §11.3 says what the advertised
fee fields are.

### 17.3 v0.8.2 → v0.9

Behaviour changes, from the signed lifecycle (§7.5, issue #22) and the legal Variant D
transcript (§9.5.1, issue #23). Message types 55011 and 55021 are retired.

| # | Section | v0.8.2 | v0.9 |
|---|---|---|---|
| 1 | §7.5, §14 | `ff_begin` (unsigned) opens the epoch; `ff_end` (unsigned, echoed) closes it | `ff_activate` / `ff_activate_ack` (both signed over `H_act`) open it; `ff_close` / `ff_close_ack` (signed; the ack carries the settled bitmap and, in D, the preimages) close it; `ff_abort` (signed) ends a setup. 55011 and 55021 MUST NOT be sent |
| 2 | §7.2, §7.5.2 | `ff_accept` did not commit to `ff_init` | TLV 11 `init_hash = T_init`; `T_setup` chains both; `H_act` chains `T_setup`, the book and both commitment txids |
| 3 | §7.5.3 | No canonical per-slot descriptor | The voucher book: `(k, H_k, d_k, T_exp, D, s_htlc_id_k)` under `(epoch_id, variant, profile, K)`, covered by `H_act` |
| 4 | §7.5.1, §7.5.5 | FF_SETUP / FF_EPOCH; the epoch "live once both processed `ff_begin`"; disconnect during setup aborts, otherwise unspecified | Seven named states with a transition table: authorized sender, signed content, durable-before-ack, permitted traffic, replay, disconnect, restart, timeout. `ACTIVE` and `DRAINING` are durable and outlive BOLT 2 quiescence; there is no abort from `ACTIVE` |
| 5 | §9.5.1 | "Setup, from quiescence": vouchers added while quiescent, which BOLT 2 forbids | Vouchers added, committed and revoked into both views **before** `stfu`; activation under quiescence as an FFOR transition; the ack terminates quiescence; onion payload, `K` bounds, abort-after-round unwinding, id continuity and both force-close views specified |
| 6 | §7.3, §7.5.6 | Invoice `expiry ≥` estimate of `T_exp` | Invoice `expiry ≤` a conservative estimate of `D` (at most 8 minutes per block); `D < T_exp − claim_margin`; `S`'s stopping conditions and the close-versus-payment race resolved by `S`'s serial order and the signed bitmap |
| 7 | §7.5.5 | Towers acknowledged provisioning | Every tower or witness MUST acknowledge `H_act` before any invoice is exposed and MUST refuse records that do not name it |
| 8 | §11.1 | Reestablish TLV 55001 `{epoch_id, last_seq, state}` with four states; number carve-out for every variant | `{epoch_id, state, last_seq, activation_hash}` with the seven states; the carve-out is A/B only, Variant D uses BOLT 2's reestablish rules unchanged |

| 9 | §7.3 | `ff_invoices` required; setup incomplete without it | OPTIONAL and SHOULD NOT be sent unless `S` is deliberately the distributor; `S` recognises delegated payments from the hash set alone |

Editorial only: §6's diagram and lifecycle line; §11.2 gains the close-race and
abort-after-round cases; §13.7 retitled "bounded, not closed" with §13.7.1 stating
exactly what the distribution rule does and does not do (issue #20), §7.3's
distribution table, §12.1 and §12.4 aligned; §15.2's M8.1 and M8.3 gates restated
against §9.5.1 and §7.5. Appendix D (`ffor-variant-d-vectors.md`) carries the
transcript and both-view commitment vectors for §9.5.1: six scenarios (K = 1; K = 3
with S funding; K = 3 with R funding; the 546,000 msat dust boundary; K = 483; K = 1
with S funding and R holding nothing), every
signed message as wire bytes, every hash of §7.5.2, both commitment views with all
second-stage signatures, and all four force-close spends of voucher 1, computed with
beignet's builder and verified both ways. Its generation fixed the signing and
TLV-extent definitions in §7, the empty point list under Variant D in §7.1, the
onion's associated data and payload set in §9.5.1, the anchor term of the fee-spike
buffer in §7.6, and Appendix A's `D` (now `T_exp − 1008`).

---

### 17.4 v0.9 → v0.9.1 (D-R)

Additive. Nothing changes for an implementation that does not use the profile.

| # | Section | Change |
|---|---|---|
| 1 | §9.6 | The D-R receipt-witness profile: claim, roles, path requirements, provisioning, store-before-propagate with a bounded barrier, retrieval, close, retention, exposure bounds, adversarial validation |
| 2 | §7.1 | `ff_init` TLV 13 `witness_peers`; `S` fails delegated HTLCs from any other peer |
| 3 | §14, Appendix F | Messages 55055 to 55065; the manifest, record, encryption and receipt formats |
| 4 | §4, §13.8, §15.3 | D-R in the trust overview; D1-WR recorded as deferred; M9 milestones |
| 5 | §9.7 | The BOLT 12 issuer for unknown payers: path-terminal signing per BOLT 12, provisioning with a payment-path template and `R`'s attestation, exact-slot selection, durable single issuance, fixed refusals, proof-of-payment semantics, privacy, retirement |
| 6 | §14, Appendix F.6 | Messages 55067 to 55073; invoice TLV 1000055001 |
| 7 | §13.2 | Points at §9.7 instead of a convergence with `S`-served static invoices |

### 17.5 v0.9.1: errata from the M8 implementation

Clarifications, none changing wire bytes: §7.5.5 no longer describes an
`ff_activate` retransmission across a reconnect that the disconnect-aborts rule makes
unreachable; §7.5.4 fixes the bitmap's bit order (LSB-first) and counts a `SETTLING`
slot as settled; §7.2's `H_1`-versus-revealed-secret check runs at `ff_accept` over
the secrets `R` already holds and again when the voucher round reveals
`per_commitment_secret_S[n0]`; §8 bounds `R`'s reserve only when `R` is the funder;
§7.5.5's 60-second timeout may surface as BOLT 2's mandated disconnect (reason 6);
§7's epoch-id uniqueness covers a refused `ff_init`; §11.1 states `last_seq = 0` in
Variant D and scopes the `last_seq` retention rule to A and B, with Variant D
retention decided by state alone from `ACTIVE` on. Review of the above added: the
acknowledgement-loss window is the one pre-`ACTIVE` state a disconnect preserves
(§7.5.5); `D ≤ T_exp − claim_margin` is non-strict, so `T_exp − D = 1008` conforms
(§7.5.6); §9.5.1's bounds carry §8's conditional reserve; `ff_error` never implies an
abort reason of its own (§11.1); Appendix D gains the S-funded, R-holds-nothing
scenario and asserts `R`'s reserve only when `R` funds.

Bytes on the wire are unchanged by this section; what it changes is behaviour: which
reestablish outcomes abort, how the bitmap is read, which abort reason is recorded,
and what `last_seq` means. An implementation of v0.9 before these errata interoperates
on every message and can disagree on those four points.

## Appendix B: escape commitments and the aggregate voucher (normative)

### B.1 Deterministic construction of `E_j`

Each escape `E_j` (`j = 1…J`, `J = ceil(budget_msat / G)`) is a standard BOLT 3
commitment transaction **for `S`** at commitment number `n0 + 1` (using `S`'s
per-commitment point for that index, which `R` holds from the last pre-epoch
`revoke_and_ack`), derived from the pre-epoch quiescent state as follows:

1. `S`'s `to_local_msat` is reduced by `j·G`. (The §7.2 budget check,
   `budget ≤ spendable − reserve − G`, guarantees `S` stays at or above
   `channel_reserve` even at `j = J`, where `j·G` may exceed `budget` by up to `G`.)
   All escape quantities are defined against the **frozen pre-epoch state**: the
   pre-epoch balances, `S`'s per-commitment point at `n0 + 1`, and the funder identity
   MUST be snapshotted at setup; reconciliation later moves the live balances,
   commitment numbers, and point pipeline, and without the snapshot an implementation
   cannot rebuild, recognize, or penalize an escape afterwards.
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
`S` MUST verify every signature before `ff_activate`, and MUST refuse the epoch otherwise.

There are **no second-level transactions**: unlike a BOLT 3 offered HTLC, whose timeout
path is a 2-of-2 routed through a pre-signed HTLC-timeout transaction so the CSV
revocation-delay can ride on top of the CLTV, the aggregate voucher applies both
timelocks directly in-script on `S`'s single-sig branch (§B.2). `ff_escape_sigs`
therefore carries commitment signatures only.

### B.2 Aggregate voucher witness script

P2WSH. `revocationpubkey` is the standard BOLT 3 revocation key for `S`'s commitment
`n0 + 1`; `local_delayedpubkey` is `S`'s delayed-payment key at that per-commitment
point (matching `to_local` semantics); `payment_basepoint(R)` is `R`'s **static**
payment basepoint, untweaked.

```
OP_DUP OP_HASH160 <RIPEMD160(SHA256(revocationpubkey))> OP_EQUAL
OP_IF
    # Path 1, revocation: R (or its tower) penalizes a revoked escape
    OP_CHECKSIG
OP_ELSE
    OP_NOTIF
        # Path 2, S refund after voucher expiry, revocation-delayed
        <T_exp> OP_CHECKLOCKTIMEVERIFY OP_DROP
        <to_self_delay> OP_CHECKSEQUENCEVERIFY OP_DROP
        <local_delayedpubkey> OP_CHECKSIG
    OP_ELSE
        # Path 3, R claim: bare sig, 1-block CSV (anchor pinning rule)
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
locate and claim the aggregate voucher from its seed and the funding outpoint alone: no
packages, no per-commitment points, no tower. Path 2 keeps a revoked escape penalizable:
after reconciliation reveals the `n0 + 1` secret, a cheating `S` broadcasting any `E_j`
must still wait `to_self_delay` blocks before sweeping, the standard justice window.

### B.3 Script size

115 bytes, itemized (with `T_exp` as a 3-byte scriptnum, any height up to 8,388,607,
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

Spend-side. The table assumes **worst-case 72-byte DER+sighash signatures**; live
RFC 6979 low-S signatures are frequently 71 bytes, making real witnesses 1 WU smaller
per path; validate against the worst case. (These numbers, and the 115-byte script
length above, were confirmed exactly by the reference implementation against bitcoind.)
Witness serialization includes the count byte and per-item length prefixes; script push
= `1 + 115`:

| Path | Witness WU | Marginal input WU (input 164 + witness) | 1-in/1-out sweep to P2WPKH, total WU (vB) |
|---|---|---|---|
| 3 `R` claim | 192 | 356 | 522 (130.5) |
| 2 `S` refund | 191 | 355 | 521 (130.25) |
| 1 revocation | 224 | 388 | 554 (138.5) |

(Sweep total = 328 WU non-witness for a minimal 1-in/1-out tx: version, counts, a
41-byte input, a 31-byte P2WPKH output, locktime; plus 2 WU marker/flag plus the
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
  multiple-of-1000/dust-floor constraints, or whose implied `J` exceeds §7.4's bound.
- `S` MUST reject an `ff_escape_sigs` whose `num_escapes` is not exactly
  `ceil(budget_msat / G)`. (The check belongs here, on a value a peer actually sends:
  `J` is not a field of `ff_init`, where it is derived and therefore unfalsifiable.)

---

## Appendix C: tower transport (provisioning / authentication wire format)

Variant B needs `R` and `S` to reach the tower `T` over an authenticated channel.
This appendix specifies a **direct BOLT-8** transport for that purpose: `T` is reached
as a directly-dialed BOLT-8 peer (`nodeId@host:port`). Onion-message indirection, for
the case where `S` should not learn `T`'s network identity, is an optional privacy
upgrade left to a future revision. The three logical operations (§9.4), provision,
release and fetch, are carried as request/response pairs of custom, odd (ignorable)
peer messages. Numbers are provisional pending bLIP assignment; all multi-byte integers
are big-endian.

**Implementation status (2026-07-26): this appendix is specified but not prototyped.**
Unlike the rest of this document, it does not describe what the reference
implementation does. beignet reaches `T` through an abstract three-method client
(provision / release / fetch) with an in-process loopback for tests and a TCP
JSON-lines transport in its tower example; message types 55031 to 55041 exist nowhere.
Read this appendix as the interop target for a third-party tower, not as a description
of running code, and see §11.3's tower discovery, which presupposes it. Two
consequences follow, and neither is theoretical while the appendix is unbuilt:

- C.2's access-control layer assumes an authenticated peer identity. A transport
  without one leaves `ff_tower_provision` with **no** authentication of any kind, since
  the §9.4 bundle carries no signature (release and fetch are separately signed).
- `R` cannot in practice select a tower from gossip (§11.3) without a dial protocol
  both sides implement.

### C.1 Messages

Every request begins with a 16-byte `request_id`, echoed in its response, so a client
can correlate replies over the fire-and-forget peer transport (it keys pending requests
by `request_id` with a timeout). Unlike the §7 channel messages, tower messages carry no
`channel_id`/`epoch_id` prefix: each body names its own epoch, directly (`ff_tower_fetch`)
or inside its payload (the provisioning bundle, the `ff_settlement` package).

| Type | # | Dir | Body |
|---|---|---|---|
| `ff_tower_provision` | 55031 | R→T | `[16: request_id][provisioning bundle]` (the §9.4 provisioning object, serialized) |
| `ff_tower_ack` | 55033 | T→R | `[16: request_id][1: ok][2: err_len][err_len: error]` |
| `ff_tower_release` | 55035 | S→T | `[16: request_id][ff_settlement payload]` (the raw §9.1 package) |
| `ff_tower_release_resp` | 55037 | T→S | `[16: request_id][1: ok]` then ok ⇒ `[2: seq][32: preimage]`, else `[2: err_len][error]` |
| `ff_tower_fetch` | 55039 | R→T | `[16: request_id][32: epoch_id][32: nonce][64: signature]` (§9.4 fetch request) |
| `ff_tower_fetch_resp` | 55041 | T→R | `[16: request_id][1: ok]` then ok ⇒ `[2: last_released][2: num_packages]{[4: len][package]}*[2: num_preimages]{[32: preimage]}*`, else `[2: err_len][error]` |

`last_released` is a `u16`, matching `seq` everywhere else in the protocol
(`ff_settlement.seq`, `max_payments`, the §11.1 reestablish TLV's `last_seq`, and
`ff_tower_release_resp`'s own `seq`). `0` means nothing has been released.

The provisioning bundle serialization is defined by the durable-store format (§9.4 /
Appendix C reference implementation) and MUST round-trip `r_node_id`, `s_node_id`, the
preimages, channel static parameters, both sides' basepoints/configs, `S`'s
per-commitment points at `n0` and (if escapes) `n0 + 1`, and any option-(a) scoped
revocation secret + sweep script.

### C.2 Authentication: two independent layers

- **Access control = the Noise-authenticated peer identity.** BOLT-8 already
  authenticates the sending peer's node id, so `T` gates each operation on it, with no
  additional bearer token: `ff_tower_provision` MUST originate from the epoch's `R`
  (matched against `r_node_id` inside the provisioning bundle, since the epoch is not yet
  known to `T`); `ff_tower_release` MUST originate from that epoch's `S`; `ff_tower_fetch`
  MUST originate from that epoch's `R`. A mismatch is rejected regardless of payload
  validity.
- **Evidence = the per-message node-key signatures** (the fetch digest of §9.4, the
  package signatures of §9.1). These are the §12.2 non-repudiation layer and are verified
  **independently** of, and in addition to, the access-control check: e.g. a fetch with
  a validly-signed digest is still rejected if it arrives from a peer other than the
  epoch's `R`. The fetch nonce is requester-chosen (§9.4); `T` MUST reject a nonce it has
  already accepted for that epoch, which is what keeps one signed request from being
  presented as two. No challenge round trip is needed or defined, because the transport
  above already rules out third-party replay.

### C.3 Size bound

An `ff_tower_provision` message MUST fit the 65535-byte peer-message limit. At
approximately 203 bytes per delegated payment (preimage + hash + per-commitment point,
plus a fixed ~2.6 KB of channel static parameters) this bounds a single-message epoch at
`K ≈ 305`. Typical epochs have `K` in the low tens, so this is not a practical
constraint; an implementation supporting `K > ~305` MUST chunk the provisioning across
multiple messages (a future extension).

### C.4 Durability

A tower answering these messages MUST persist provision and release state per the §9.4
restart contract, so both survive a tower restart while `R` is offline.

---

## Appendix F: witness transport and the payment mailbox object (D-R, §9.6)

Direct BOLT 8 peer messages, as in Appendix C: odd, ignorable types; a 16-byte
`request_id` echoed in each response; all integers big-endian. Unlike Appendix C,
**no operation is authorized by the Noise peer identity**: the witness never needs to
know who `R` is, and every request is authorized under the mailbox's `fetch_key`. An
onion-message transport is a future privacy upgrade.

### F.1 Messages

| Type | # | Dir | Body |
|---|---|---|---|
| `ff_witness_provision` | 55055 | R→W | `[16: request_id][manifest]` (§9.6.4, includes `manifest_sig`) |
| `ff_witness_ack` | 55057 | W→R | `[16: request_id][1: ok]` then ok ⇒ `[33: witness_node_id][4: retention_until]`, else `[2: err_len][error]` |
| `ff_witness_fetch` | 55059 | R→W | `[16: request_id][32: mailbox_id][32: nonce][64: sig]`, `sig` under `fetch_key` over `SHA256("ffor/witness/fetch" ‖ mailbox_id ‖ nonce)` |
| `ff_witness_fetch_resp` | 55061 | W→R | `[16: request_id][1: ok]` then ok ⇒ `[2: num_records]{[2: len][record]}*`, else `[2: err_len][error]` |
| `ff_witness_close` | 55063 | R→W | `[16: request_id][32: mailbox_id][32: H_act][2: K][ceil(K/8): settled][32: nonce][64: sig]`, `sig` under `fetch_key` over `SHA256("ffor/witness/close" ‖ body without sig)` |
| `ff_witness_close_ack` | 55065 | W→R | `[16: request_id][1: ok][2: num_records_held]` |

A witness MUST reject a fetch or close whose nonce it has already accepted for that
mailbox, and MUST answer an unknown `mailbox_id` exactly as it answers a mailbox with
no records (so that probing for mailbox ids learns nothing).

### F.2 The record

```
header  = [1: version = 1][1: profile = 1]
          [32: mailbox_id][32: record_id][2: k]
          [32: H_act][32: terms_hash]
          [33: witness_node_id][33: enc_pubkey]
          [4: recorded_height][1: flags]
          [32: ciphertext_hash]
record  = header ‖ [64: witness_sig] ‖ [2: ct_len][ct_len: ciphertext]
          ‖ [1: num_receipts]{[2: len][receipt]}*
```

`record_id` is 32 random bytes. `terms_hash = SHA256("ffor/terms" ‖ entry_k)` over the
book entry of §7.5.3, so a record commits to `(k, H_k, d_k, T_exp, D, s_htlc_id_k)`
without revealing them to anyone who lacks the book. `flags` bit 0 is `unbarriered`
(§9.6.5). `ciphertext_hash = SHA256(ciphertext)`. `witness_sig` is the witness's
node-key compact signature over `SHA256("ffor/witness/record" ‖ header)`; it is the
§12.2 evidence that this witness saw the preimage, and it is what lets `R` audit a
witness that later serves a different ciphertext.

The plaintext body, before encryption:

```
body = [32: epoch_id][2: k][32: t][32: H_k][8: d_k][4: T_exp][4: D]
       [8: amount_in_msat][8: amount_out_msat][4: outgoing_cltv][8: observed_unix_time]
```

`R` verifies, after decryption, that `SHA256(t) == H_k`, that `(k, H_k, d_k, T_exp, D)`
reproduce `terms_hash`, and that `epoch_id` is its own. The amounts and time are
context for `R`'s books and carry no protocol meaning.

Size: the header is 235 bytes, the signature 64, the ciphertext 142 bytes of body plus
Appendix F.3's overhead, receipts as configured; well under 1 KB per record without
receipts.

### F.3 Encryption

ECIES over secp256k1: the witness generates an ephemeral keypair `e`, computes
`s = SHA256(ECDH(e, enc_pubkey))`, derives `key = HKDF-SHA256(s, "ffor/witness/body")`
(32 bytes), and encrypts the body with ChaCha20-Poly1305 under `key`, nonce all
zeros (the key is single-use), AAD = the record header. `ciphertext = [33: e_pub] ‖
aead_output`. The ephemeral key MUST be fresh per record. The AAD binds the body to
the header, so a witness cannot serve one body under another header without
detection.

### F.4 Guardian receipts

A receipt is a storage acknowledgement from a third party the witness replicated the
record to, under whatever fault assumption that party documents. This specification
does not define the receipt format or the replication protocol; the beignet guardian
protocol is one provider, and its receipts are opaque bytes here. A receipt is
**not** proof of payment, proof of solvency, or proof of Byzantine retrievability, and
`R` MUST NOT treat the presence of receipts as anything more than the witness's claim
that it did what `min_receipts` asked. What `R` can verify is the record it decrypts.

### F.5 Durability

A witness answering these messages MUST persist manifests and records so that both
survive a witness restart while `R` is offline, MUST rehydrate every mailbox on
restart without any message from `R`, and MUST honour `retention_until`. The
store-before-propagate order of §9.6.5 is what makes the profile's claim true; a
witness that propagates first and stores later is not a receipt witness.

### F.6 Issuer messages (§9.7)

| Type | # | Dir | Body |
|---|---|---|---|
| `ff_issuer_provision` | 55067 | R→I | `[16: request_id][issuer_manifest]` (§9.7.2) |
| `ff_issuer_ack` | 55069 | I→R | `[16: request_id][1: ok]` then ok ⇒ `[2: num_paths]{[33: blinded_node_id]}*` (the offer-path terminal keys `I` confirmed it controls), else `[2: err_len][error]` |
| `ff_issuer_status` | 55071 | R→I | `[16: request_id][32: mailbox_id][32: nonce][64: sig]`, `sig` under `fetch_key` over `SHA256("ffor/issuer/status" ‖ mailbox_id ‖ nonce)` |
| `ff_issuer_status_resp` | 55073 | I→R | `[16: request_id][1: ok]` then ok ⇒ `[2: K][ceil(K/8): issued]{[2: k][33: invreq_payer_id][32: metadata_hash][8: issued_unix_time]}*` for every set bit, else `[2: err_len][error]` |

`ff_issuer_provision` is authorized like the witness manifest: `mailbox_id` names a
mailbox this issuer already holds, and the request MUST arrive with a valid
`r_attestation`; the Noise peer identity is not consulted. `ff_issuer_status` follows
F.1's nonce rule. The issued-slot state is part of the mailbox's durable state (F.5).
