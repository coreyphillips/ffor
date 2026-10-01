# Concurrent Variant D receive, proposed extension version 1

Status: **experimental specification, not implemented in the reference engine**.
This companion draft addresses [FFOR #39](https://github.com/coreyphillips/ffor/issues/39).
It specifies an opt-in extension to [FFOR v0.9.4](ffor-offline-receive.md), without
changing the baseline behavior of existing peers or epochs. MUST, SHOULD and MAY in
this file describe conformance to the proposed extension, not current support.

The receiver `R` can use one channel for ordinary online payments while its unpaid
offline invoices remain valid. The settlement peer `S` reserves the voucher value
and HTLC capacity, while ordinary payments use the remaining capacity. Each new
commitment preserves the unresolved vouchers. No new funding output, Bitcoin
consensus rule, payer behavior or ordinary routing-node behavior is required by
this design. Its implementation and on-chain safety still require the gates in
[CONCURRENT-IMPLEMENTATION.md](CONCURRENT-IMPLEMENTATION.md).

## 1. Scope and compatibility

Version 1 supports Variant D (`variant = 4`) with independent hashes, fixed amounts,
one immutable book per channel, `1 <= K <= 483`, and the anchor commitment format
of base section 5. All smaller negotiated channel limits still apply.
It composes with D-R receipt witnesses and the section 9.7 issuer. It does not apply
to A/B, chained books, the optional preimage-origin tower, delegated MPP or simple-taproot
channels. It does not add arbitrary offline sends or ordinary receives while `R`
is offline.
`ff_init` TLV 15 (`hash_chain`) MUST be absent; `S` generates independent random
voucher preimages as in the unchained base construction.

Book refill, partial cancellation, changing a voucher's amount/deadline, fee updates,
splicing and cooperative channel close while the book is live are excluded. A peer
MUST retain the setup feerate until the book closes. Version 1 removes the global
payment freeze, not the liquidity reservation or ordinary Lightning limits.

An implementation MUST NOT advertise support until it implements this entire
version's required behavior, including nonterminal synchronization, paid-voucher
redemption, recovery and the active/draining traffic policy. It MAY reject books
larger than its supported capacity, including supporting only `K = 1` initially.
Prototype milestones alone do not establish production readiness.

### 1.1 Experimental negotiation

All identifiers below are **proposed experimental assignments**, pending review
and bLIP allocation. Their appearance here does not establish a deployed allocation.

| Surface | Proposed assignment | Meaning |
|---|---|---|
| `init` feature pair | 562/563, `option_ff_concurrent` | Requires `option_ff_receive` 560/561; advertise support in peer `init` |
| `ff_init` TLV | 17, `concurrent_version` | Exactly two bytes, `00 01` |
| `ff_accept` TLV | 17, `concurrent_version` | Exact echo of the requested value |
| R to S message | 55075, `ff_sync` | Signed nonterminal settlement fetch |
| S to R message | 55077, `ff_sync_reply` | Signed cumulative settlement snapshot |

Normal BOLT feature-bit rules apply. Each peer MUST have advertised either bit of
the concurrent pair and either bit of the base pair before concurrent negotiation.
An advertisement alone does not select concurrent behavior for any channel.

`R` requests version 1 in `ff_init` TLV 17; `S` accepts only by the exact signed
echo in `ff_accept`. `S` MUST reject an unsupported value, an absent feature
dependency, or a request with a disallowed variant/profile. `R` MUST reject a
missing, unsolicited or different echo. Duplicated TLVs, noncanonical BigSize
encodings or a length other than two are malformed. TLV 17 is absent in both
messages for a baseline epoch. An older peer ignoring the odd TLV cannot enable
concurrent operation, because its acceptance lacks the required echo.

The new fields are already covered by `T_init` and `T_setup`, and therefore by
`H_act` and both activation signatures. The selected version MUST be persisted
with that transcript. It MUST NOT be inferred from current advertised features,
connection status or wallet preferences after activation. A failed negotiation
MUST NOT silently retry as baseline under the same epoch id. A separate baseline
attempt needs a new epoch and its usual voucher unwind/activation safeguards.

There is no upgrade or downgrade of an existing live epoch. A restarted peer that
cannot support its persisted concurrent epoch MUST NOT resume channel updates or
delegate new settlements using baseline assumptions. It follows normal data-loss
or safe enforcement recovery; it MUST NOT publish a revoked activation state.

### 1.2 Base rules that change

This file overrides only these rules, and only for a selected version 1 epoch:

| Base location | Concurrent rule |
|---|---|
| Sections 3, 7.5.1, 7.5.5 and 11.2 | `ACTIVE` and `DRAINING` permit the ordinary traffic in section 3 below |
| Sections 7.5.2 and 9.5.1 | Activation commitments remain historical evidence; enforceable commitments continue advancing |
| Section 9.5.1 return path and 9.6.6 | Reconnect and receipt fetch do not close the book |
| Sections 7.5.6 and 9.5.1 voucher removal | A verified preimage permits fulfillment during `ACTIVE`; failure still requires the terminal close authority |
| Section 9.5.1 HTLC counters | Ordinary offered ids continue past the voucher range and MUST NOT reset after book closure |
| Section 7.5.4 final bitmap | Includes all upstream-settled slots, including vouchers already redeemed |
| Section 14 | Adds the experimental identifiers in section 1.1 |

All other base requirements remain, including activation acknowledgement loss,
signature encoding, amount/fee policy, admission deadlines, explicit close, D-R
evidence validation and the same-hash reuse limitation. Existing Appendix D vectors
remain baseline vectors; they do not validate the new extension.

## 2. Book state and channel state

Keep three separate durable records:

1. **Book identity:** original setup bytes, selected version, `H_book`, activation
   `H_commit`, `H_act`, immutable slot tuples and activation signatures.
2. **Upstream admission and settlement:** the base `UNUSED -> SETTLING -> SETTLED`
   state, exact upstream channel/HTLC identity, replayable fulfillment decisions,
   reportable snapshot state and permanent consumed-slot records.
3. **Channel enforcement:** both commitment views, pending updates and revocations,
   state-specific HTLC signatures/output mappings, ordinary HTLCs, verified voucher
   preimages, pending voucher removals and final removal records.

The slot identity is `(epoch_id, S-offered HTLC id, k, H_k, d_k, T_exp)` and its
direction is `S -> R`. `H_book`, `H_commit` and `H_act` MUST remain unchanged for
the book's lifetime. Do not hash new commitment txids into the old activation.
Current commitment counters and enforcement material belong to the channel record.

A slot may be settled upstream while its voucher is still present. A voucher may
be fulfilled using a payer or witness preimage before `S`'s latest snapshot reports
it. Neither event permits slot reuse. Pending channel credit MUST NOT be presented
as irrevocably settled spendable balance before normal commitment finality.

Every signed message, dependent revocation and upstream fulfillment MUST obey
durable-before-release ordering. A state flag without its transaction, signature,
preimage and replay dependencies is not a durable record. Crash recovery MUST use
the persisted operation and ordinary retransmission rules, not repeat settlement
against another upstream HTLC.

## 3. Legal channel traffic

Setup follows base section 9.5.1: reserve the voucher ids and capacity, finish the
stock voucher rounds, verify both commitments, then quiesce and activate. A local
admission barrier MUST serialize setup against new ordinary adds so they cannot
race the reserved id range or invalidate `H_commit` before activation. It MUST NOT
block updates needed to finish already admitted operations. BOLT quiescence still
forbids updates while actually quiescent. No invoice is exposed before the base
activation and witness acknowledgements are durable.

After activation terminates quiescence:

| Epoch state | Permitted channel behavior |
|---|---|
| `ACTIVE`, peers synchronized | Ordinary adds, fulfills, failures, required commitment/revocation messages, ordinary deadline processing, and validated voucher fulfills |
| `ACTIVE`, disconnected | Existing offline delegated settlement at `S`; no new ordinary receiver-side updates |
| `DRAINING`, peers synchronized | Ordinary traffic as above, plus voucher failures authorized by the final close bitmap |
| `CLOSED` | Baseline ordinary channel operation; retain replay and consumed-slot records as required below |

For `ACTIVE` and `DRAINING`, `update_fee`, new `stfu`, splice and cooperative channel
close negotiation remain disallowed in version 1. Forced on-chain enforcement and
normal HTLC safety deadlines remain available. The old blockheight guard MUST NOT
suppress expiry handling for ordinary HTLCs.

The peer MUST apply ordinary directional admission checks before accepting new
work. A full receive direction is not, by itself, reason to disable affordable
outgoing payments. A close transition MAY briefly serialize new ordinary adds,
but MUST permit existing ordinary fulfill/fail and commitment progress. Once that
transition is synchronized, unrelated adds MUST be admitted normally. Waiting for
every unresolved voucher or for `T_exp` to resume ordinary traffic is forbidden.

Liveness remains conditional on a connected, cooperating peer and sufficient
capacity. A peer refusing to sign cannot be compelled to keep the channel usable.
The extension does not promise payments during data-loss recovery or force-close.

### 3.1 Capacity and fee accounting

For each relevant current or proposed commitment and pending-update view:

- Unresolved vouchers and ordinary `S -> R` HTLCs share `R`'s count and in-flight
  value limits. Ordinary `R -> S` HTLCs use `S`'s separate limits.
- Charge the voucher value once. If it is already excluded from available balance
  as an offered HTLC, do not subtract the book budget a second time.
- Preserve both peers' applicable reserves, nontrimming voucher outputs, total
  commitment weight, anchors and the funder's mandatory base section 7.6 fee-spike
  buffer for the full mixed commitment, not just the initial `K` vouchers.
- Check signatures against the actual output order and commitment view. Equal
  hashes or amounts alone do not identify an HTLC id or direction.

Reject new work that fails a check without removing or weakening an existing
voucher. An application SHOULD choose book size and value that leave useful
ordinary receive headroom. No fixed 354 sat minimum or 50,000 sat buffer is added
as a universal protocol rule. All balance computations use integer millisatoshis
and base rounding/overflow rules.

## 4. Preserve claims through every commitment update

Each valid commitment MUST preserve every unresolved voucher's direction, id,
hash, amount and absolute expiry, except for an authorized fulfill/fail transition.
Do not fail and re-add a voucher to move it into a new commitment. The invoice
remains exposed throughout and requires continuous backing.

When fulfilling, a successor commitment removing the voucher MUST credit its full
`d_k` to `R`, with normal channel fees accounted separately. During the asymmetric
transition, an older still-valid commitment may retain the HTLC while a successor
already carries the credit. Each view MUST allocate the value correctly; neither
simultaneous replacement nor premature finality is assumed. Failure returns the
voucher value to `S` only through the authorized procedure in section 7.

Each new commitment requires its own valid funding and HTLC signatures. Before
releasing the revocation of a previous commitment, validate and durably persist
the successor and all material required to enforce it under the ordinary BOLT
state machine. Also persist outgoing signatures and associated updates before
release so restart can replay them exactly. Retain all claim material required
for valid intermediate and revoked on-chain states, including second-stage paths.

Activation-time signatures and output indexes MUST NOT be reused for a successor.
Enforcement uses the valid current local state or correctly classified observed
remote state, including its own keys, HTLC signatures and output indexes. The
activation commitment usually becomes revoked after ordinary traffic and is not
a fallback transaction. Current commitment numbers follow normal BOLT rules, with
no A/B fast-forward exception and no reset on reconnect or book closure.

This is a voucher-subset invariant. Ordinary HTLCs may coexist in the commitment;
requiring the total HTLC count to equal the book length would defeat the extension.

## 5. Nonterminal settlement synchronization

`ff_close_ack` is terminal and MUST NOT be reused as a periodic status query.
Version 1 defines an explicit fetch that leaves the book open. A successful fetch
is not a prerequisite for unrelated ordinary traffic once BOLT reestablishment
and book/channel consistency checks have succeeded.

### 5.1 Encoding and signatures

Both messages use the base section 7 encoding: two-byte message type, standard
`[32: channel_id][32: epoch_id]` header, fields below, BOLT 1 TLV stream, then a
final 64-byte compact low-S node-key ECDSA signature over one SHA256 of
`"ffor/msg" || message_type || body_excluding_signature`. Integers are unsigned
big-endian. The header and TLVs are included in the digest. There is no TLV-stream
length prefix. Unknown odd TLVs are preserved in the signed bytes; unknown even
TLVs and malformed/noncanonical streams are rejected. Version 1 defines no TLVs.

`ff_sync` (55075, signed by `R`):

| Field | Bytes | Rule |
|---|---|---|
| `activation_hash` | 32 | Original `H_act` |
| `nonce` | 32 | Cryptographically random request correlation value |

`ff_sync_reply` (55077, signed by `S`):

| Field | Bytes | Rule |
|---|---|---|
| `activation_hash` | 32 | Original `H_act` |
| `nonce` | 32 | Echo from the request |
| `snapshot_seq` | 8 | Durable monotonic snapshot version |
| `num_slots` | 2 | Exactly the original `K` |
| `settled` | `ceil(K/8)` | Cumulative reportable slots, base close-bitmap bit ordering |
| `num_preimages` | 2 | Exactly the bitmap popcount |
| `preimages` | `34 * num_preimages` | Strictly increasing `[2: k][32: t_k]` for every set bit |

For slot `k`, use bit `(k-1) mod 8` in byte `floor((k-1)/8)`, least significant
bit first. Unused high bits in the final byte MUST be zero. Indexes are 1-based,
unique and within the book. Each preimage MUST hash to its indexed book entry.
Duplicate, missing or extra entries, a mismatching `K`/activation, or a bad
signature invalidate the response. Validate the entire message before updating
snapshot state.

A full response fits one frame without paging. With empty TLVs, its byte length,
including message type and signature, is `206 + ceil(K/8) + 34*n`, where `n` is
the bitmap popcount. At `K = n = 483` this is **16,689 bytes**. The empty-TLV
request is **194 bytes**. Including any extensions, a message MUST fit the BOLT 8
65,535-byte plaintext limit. Reject an overlong or truncated frame before allocation
from untrusted counts. This is distinct from multi-record witness-fetch paging.

### 5.2 Sender durability and reporting predicate

`S` handles a fetch only for an authenticated `R`, the named channel/epoch and
the persisted selected version and `H_act`. Before activation, reject with
`ff_error` without revealing a preimage. In `ACTIVE`, return the full cumulative
reportable snapshot. In `DRAINING` or `CLOSED`, replay the persisted
`ff_close_ack` instead. If the close is still completing, finish or recover its
base admission barrier before replying. Do not synthesize a new terminal bitmap.

A slot is reportable only after the upstream HTLC is irrevocably committed and
fulfilled as required by base section 9.5.2, and that result and its replay
dependencies are durably recorded. A bare `SETTLING` intent is insufficient.
After an uncertain crash window, recover the upstream fulfillment before adding
that slot to a live snapshot. Until then it is omitted, without authorizing any
voucher failure. A live fetch MUST NOT release an unused preimage, speculate that
an upstream payment will complete, or convert a recoverable intent back to unused.

Initialize sequence zero with the empty snapshot at activation. Before publishing
a changed reportable set, atomically persist its bitmap, indexed preimages and
`snapshot_seq + 1`. The set only grows, including after voucher redemption. Repeat
fetches without a set change retain the sequence. Reject sequence overflow rather
than wrap. Snapshot generation is serialized with upstream settlement and close;
it must never combine the bitmap from one state with preimages from another.

Sequence identifies canonical snapshot content, not message bytes: its content
is `K || settled || num_preimages || preimages`. Nonce, signature and extension
TLVs are not part of that identity. A retried request MAY receive a newer snapshot;
the sender need not store an unbounded response cache per nonce. A nonce is request
correlation, not a promise that an old response reflects current settlement state.

### 5.3 Receiver validation and replay

`R` keeps at most one outstanding live fetch per book. Persist its nonce before
sending; a retransmission uses that nonce. After completion or abandonment, a new
fetch uses a new nonce. A response advances sync state only if it matches that
outstanding request and passes section 5.1.

Represent "no snapshot accepted" separately from the valid empty sequence zero.
Persist the highest accepted sequence and canonical snapshot alongside the union
of all verified preimages. A higher-sequence snapshot MUST be a superset of every
earlier accepted snapshot from `S`. At equal sequence, canonical contents MUST be
identical; a changed nonce/signature does not make matching contents contradictory.
Lower sequences MUST NOT roll back state. A conflicting signed snapshot is a
protocol error: retain the evidence and valid claims, and use safe channel recovery
if the peer cannot continue consistently. Never fail a voucher as a response.

Verify and preserve independently obtained witness/payer preimages even if the
peer's snapshot omits them. A lower or uncorrelated response may still supply a
hash-valid claim preimage, but cannot change snapshot progress or lifecycle.
Absence from any live snapshot proves nothing about nonpayment. Timeouts MAY trigger
a fresh fetch; they MUST NOT cancel the book, remove vouchers or close witnesses.

Live responses never transition `ACTIVE`, `DRAINING` or `CLOSED`. A response delayed
past `ff_close_ack` cannot reopen admission. The existing signed final close is the
only cooperative authority for failing an unpaid voucher. Unknown-token retention
remains bounded by the original expiry and enforcement margin, not fetch retries.
Processing a matching `ff_close_ack` supersedes any outstanding live fetch, so
the receiver does not retry it indefinitely after admission has closed.

## 6. Redeeming paid vouchers while the book stays active

With a verified `t_k`, `R` MAY fulfill the original voucher while `ACTIVE`, through
ordinary `update_fulfill_htlc` and commitment/revocation exchanges. The token may
come from a valid live snapshot, a D-R witness or a payer. `S` MUST accept a valid
fulfillment of that outstanding voucher irrespective of snapshot lag or its own
payment accounting. The preimage is the enforceable claim.

Until removal is irrevocable in both views, keep the pending transition and its
claim material. Afterwards persist a terminal fulfilled-slot record. Do not
recreate the voucher on replay, refund its amount, or credit it again. Duplicate
receipts are idempotent evidence for the same slot.

`S` MUST classify every known delegated hash before the ordinary forwarding path.
An eligible unused slot can be settled once by the delegated procedure. A consumed
hash is rejected by an honest peer, including after its voucher has been removed;
it MUST NOT fall back to ordinary forwarding, become a new offered HTLC or return to
issuer inventory. The invoice's hash, amount, path and expiry remain unchanged for
every still-outstanding slot.

Store consumed-slot records across restarts and epoch closure; do not reuse a
voucher hash or its offered id in a future book. Channel HTLC counters advance
normally in both directions. Honest rejection does not cryptographically prevent
a malicious holder from reusing a known preimage to settle another payer's HTLC;
base section 13.7 remains applicable.

## 7. Explicit retirement and draining

`R` sends `ff_close` only for explicit retirement, all slots consumed, a deadline
policy, or another reason requiring admission to stop, never merely because it
reconnected or fetched receipts. The base serial ordering of admission, `D` and
close continues to apply. Invoice wall-clock expiry alone does not erase a claim.

`S` stops new delegated admission, resolves upstream decisions per the base close
barrier, then durably records and sends `ff_close_ack`. Its cumulative bitmap and
preimages include already redeemed slots. A removed voucher does not clear its
settlement bit. All previously reported settled bits MUST remain set, and
`SETTLING` treatment remains as required by base section 7.5.4.

On receiving the final ack, `R` unions every valid preimage from every source.
Already fulfilled slots are checked against their terminal records, not fulfilled
again. Present vouchers with known preimages are fulfilled even if the peer denies
payment. Present vouchers may be failed only if the final ack marks them unsettled
and `R` holds no preimage, under the base section 7.5.6 trust limits. A live snapshot,
a receipt-query failure or a zero bit before this barrier never authorizes failure.

If a preimage arrives during a pending failure, preserve it and use ordinary
commitment/on-chain recovery where still possible. A failure already irrevocable
cannot be undone by a later receipt. Signed peer statements and missing receipt
availability retain the baseline bounded-withholding limitation; this extension
does not strengthen a negative bitmap into proof of nonpayment.

Normal in-flight HTLCs must continue resolving during `DRAINING`. After the bounded
close transition, permit new unrelated ordinary payments within remaining capacity
even if a voucher is still pending. `CLOSED` means every voucher, not every ordinary
HTLC, has been irrevocably resolved. The peer must not force-close solely because
an unrelated ordinary HTLC exists when the last voucher is removed; normal HTLC
and channel safety policies still apply.

`ff_close_ack` replay, activation-acknowledgement loss, and explicit on-chain remedies
remain unchanged. If `S` is unavailable, a local decision to cancel cannot make it
sign a refund or stop a malicious preimage holder. Use valid current commitments
and the original claim deadlines.

## 8. Reconnect, witnesses and issuer continuity

On reconnect, complete normal `channel_reestablish`, including pending BOLT
retransmissions and the base FFOR state/`H_act` checks. Compare the selected version
with persisted setup bytes and validate the live voucher subset and terminal
resolution records against the recovered channel. Do not recompute historical
`H_commit` from current txids or apply A/B counter exceptions.

Before resuming new ordinary adds or new delegated admissions after reconnect,
both peers MUST also confirm that the current `init` exchange advertises the base
and concurrent capabilities. An observed incompatible reconnect holds new admission
without changing the persisted mode. Continue safe fulfill/fail/replay work needed
for existing obligations under that mode; restore support or use safe retirement
or enforcement. Ordinary disconnection does not trigger this hold: the previously
negotiated offline settlement service continues while `R` is absent. Operators
stopping new epoch creation can reject `ff_init` while retaining the capability
advertisement needed to honor live epochs.

Ordinary traffic can resume once those checks pass. Settlement fetching is separate
and may run while other channel operations proceed. A missing FFOR record, a
different activation or unavailable current recovery material is a data-loss or
protocol-error case, not permission to drop the reservation or sign an old state.
Refusing an unsupported persisted mode must not erase ordinary HTLC obligations.

D-R witnesses remain receipt stores. `R` MAY fetch their records repeatedly and
validate them under the unchanged `H_act`. It MUST NOT send `ff_witness_close` on
ordinary reconnect, a live fetch, or partial redemption. The issuer continues to
honor its original issued-slot uniqueness, inventory and deadline rules. It must
never reissue a redeemed slot or extend a previously issued invoice's validity.

After the actual final `ff_close_ack`, witness close and issuer retirement follow
the base rules. A witness must finish in-progress recording and preserve retention.
Live synchronization allocates no new witness message and does not change mailbox
encryption. Compatibility still requires deployments to avoid application-level
auto-close behavior and to preserve opaque activation/transcript bindings.

A receipt witness MUST NOT be given an activation commitment to broadcast later
as part of this extension. Once revoked, that transaction could expose `R` to
penalty. A deletion acknowledgement cannot invalidate an already supplied Bitcoin
signature. Terminal witness enforcement remains separate deferred work.

## 9. Offline safety and unilateral enforcement

The long voucher window does not extend an ordinary HTLC's expiry. Before a planned
long absence, stop accepting new ordinary work and finish ordinary HTLCs/updates
that require action before return, while leaving the voucher book active. An
application MUST NOT assume its background callback will finish: mobile suspension,
process termination and connection loss can interrupt any operation.

At each such interruption, the safe return deadline is the earliest applicable
voucher claim deadline, ordinary HTLC enforcement deadline or breach-response
deadline, with the required confirmation/reorganization/fee margins. For any
absence extending past that bound, provide an appropriate current-state monitoring
and enforcement service or refuse to advertise that offline duration as safe.
A preimage mailbox is not that service. A short background grace period is not
a guarantee of reaching a safe state.

Re-evaluate base section 5.1's watchtower-free argument for every retained revoked
commitment and its HTLC second-stage paths. A long delay on `S`'s delayed outputs
does not let `R` reclaim an ordinary received HTLC after a valid timeout has already
spent its output. Protecting stale-state penalties and meeting current-state HTLC
deadlines are distinct requirements.

Either peer may force-close. Claim each voucher using its correct current or
observed commitment path and preimage; timeout unpaid vouchers under original
`T_exp`. Account for ordinary HTLCs and pre-existing receiver funds in the same
transaction. Keep required enforcement material and preimages across crashes,
including when one commitment view has advanced and the other has not.

## 10. Example legal transcript

This omits retransmissions, ordinary onion traffic and unchanged base fields.
Every `commitment_signed` includes signatures for the full applicable mixed state.

```text
R and S: advertise base and concurrent capability
R -> S: ff_init(variant=4, TLV17=0001, fixed independent book)
S -> R: ff_accept(TLV17=0001, original hashes and ids)
S -> R: update_add_htlc(voucher k=1), update_add_htlc(voucher k=2)
S -> R: commitment_signed
R -> S: revoke_and_ack; commitment_signed
S -> R: revoke_and_ack
R <-> S: stfu; ff_activate; ff_activate_ack
R: persist ACTIVE; provision witnesses if selected; expose invoices

R -> S: update_add_htlc(ordinary outgoing payment)
R <-> S: ordinary commitment/revocation rounds retaining both vouchers
S <-> R: ordinary incoming payment and its rounds retaining both vouchers
R: disconnect
Payer -> S: pay invoice for voucher 1; S durably fulfills upstream
R: reconnect; ordinary BOLT recovery; original H_act unchanged
R -> S: ff_sync(H_act, nonce A)
S -> R: ff_sync_reply(nonce A, seq=1, bitmap=01, preimage for slot 1)
R -> S: update_fulfill_htlc(voucher 1)
R <-> S: commitment/revocation rounds crediting R and retaining voucher 2
R: may spend irrevocably credited funds; invoice 2 is still payable

R -> S: ff_close(H_act), only when the book is to retire
S -> R: ff_close_ack(cumulative bitmap and preimages)
R <-> S: drain remaining vouchers alongside permitted ordinary payments
R and S: CLOSED after every voucher is irrevocably resolved
```

For two slots, bitmap `01` above is one byte in hexadecimal, with slot 1 set.
An upstream settlement concurrent with any ordinary update changes the settlement
ledger, not the immutable voucher tuple. A later fetch may report it; none of the
ordinary rounds needs to know a still-hidden preimage to preserve its backing.

## 11. Validation scope

Run the standalone abstract state and wire models with:

```sh
node --test tools/concurrent-receive-model.test.mjs tools/concurrent-receive-wire.test.mjs
```

The [state model](tools/concurrent-receive-model.test.mjs) checks 70 bilateral
transition schedules, 630 peer-memory-reset positions and 165 settlement/update
interleavings. The [wire model](tools/concurrent-receive-wire.test.mjs) checks
negotiation, malformed input and snapshot replay against
[pinned serialization fixtures](tools/fixtures/concurrent-receive-wire.json).
On Node.js 22.13.1 the combined run has **47 passing, 0 failing and 0 skipped**
tests. The request and full 1-, 9- and 483-slot reply fixtures were also reproduced
independently with Python `struct` and `hashlib`, including their digest bytes.

The state model explores enforcement-allocation and persistence rules. Its crash
positions reset peer memory while retaining the external driver's proposed operation
and logical network; fees are supplied as static obligations. The wire model checks
serialization, unsigned digest fixtures and snapshot validation with placeholder
signature bytes. Neither verifies Bitcoin/ECDSA signatures, real commitment
transactions, BOLT 8 transport, production restart recovery or mobile/on-chain
enforcement. Passing these models is not a proof of protocol safety. Signed wire
transcripts, independent implementation comparison, mined regtest claims/penalties
and process-termination tests remain required in
[the implementation plan](CONCURRENT-IMPLEMENTATION.md).

The relevant primary channel rules are
[BOLT 2 at 1aadb719](https://github.com/lightning/bolts/blob/1aadb719b4007c4cea0ba6e36b08c4fb53788dee/02-peer-protocol.md#normal-operation)
and [BOLT 3 at the same revision](https://github.com/lightning/bolts/blob/1aadb719b4007c4cea0ba6e36b08c4fb53788dee/03-transactions.md#commitment-transaction-outputs).
The concurrent traffic policy, live-sync messages and snapshot semantics are this
proposal; they are not existing BOLT requirements.
