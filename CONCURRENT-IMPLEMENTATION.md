# Concurrent receive: downstream implementation plan

Status: **proposed and unimplemented**. This is the implementation and qualification
plan for [issue #39](https://github.com/coreyphillips/ffor/issues/39) and the
[concurrent receive design](CONCURRENT-RECEIVE.md). The design document owns the
protocol contract. This plan identifies downstream changes and evidence required
before enabling that contract. It does not change draft v0.9.4 or claim that a
working concurrent implementation, security review, or interoperability result exists.

The target is one receiver channel with an unpaid offline invoice: while online,
the receiver can spend its available balance and accept unrelated payments; after
going offline, the original invoice remains payable within its existing limits.
Reserved liquidity and HTLC slots remain unavailable for other obligations. An
offline receiver cannot originate ordinary channel updates while absent.

## Audited source baseline

These are source inspections, not execution results. A downstream release must
record its own specification revision, implementation revisions and test results.

| Repository | Audited revision | Relevance |
|---|---|---|
| [FFOR](https://github.com/coreyphillips/ffor/tree/d719161f42d1eeb6bd6c3856d564222f03c2205e) | `d719161f42d1eeb6bd6c3856d564222f03c2205e`, draft v0.9.4 | Existing frozen-epoch protocol |
| [Portable engine](https://github.com/coreyphillips/beignet-portable-engine/tree/95f4b3dc36c1c78256c46f102aeba6683574c976) | `95f4b3dc36c1c78256c46f102aeba6683574c976` | Channel lifecycle, wallet coordinator, chain recovery |
| [Wallet core](https://github.com/coreyphillips/beignet-wallet-core/tree/2d37d416427ee1ad061c5911ca4cf2ca734ea375) | `2d37d416427ee1ad061c5911ca4cf2ca734ea375` | Receive and send contracts, capacity display |
| [Chicory](https://github.com/coreyphillips/chicory/tree/0135b9db0630e8867f7c4f0c48b34caa4bd7c7de) | `0135b9db0630e8867f7c4f0c48b34caa4bd7c7de` | Native wallet integration |
| [Umbrel manager](https://github.com/coreyphillips/beignet-umbrel/tree/7d71b24e5d7001baed121b82702a6e05741bb2d0) | `7d71b24e5d7001baed121b82702a6e05741bb2d0` | Service configuration and return handling |

Chicory's audited [dependency manifest][chicory-deps] pins portable engine
`86b34e421f5727c0149af4bc10afcd41a90a8747` and wallet core
`b9f68a55862d7fab4be42f28b8d777f08be162a0`, earlier than the separate checkouts above.
The pinned engine also enforces zero local balance in its receive selector and
creation recheck. A local checkout is not evidence of the package a shipped app runs.

## Current restrictions and required changes

| Current source behavior | Implementation work |
|---|---|
| [Receive selection][receive-selector] requires zero local balance, no reservation, no live epoch, and inbound headroom. Creation rechecks the balance. | Permit funded channels only after explicit concurrent-profile negotiation and validated available capacity. Preserve conservative behavior for the existing profile. |
| [Runtime channelization][runtime-channelize] excludes whole reserved channels; [channel reporting][runtime-channels] marks them `htlcUsable: false`. | Represent reserved value and slots separately from channel usability. Audit routing, balance, send review, ordinary receive and funding operations that consume this field. |
| [Channel guards][channel-freeze] prohibit ordinary adds, settles, fee updates and commitments during ACTIVE, and restrict DRAINING to voucher removals. | Apply the contract's operation matrix without weakening existing-profile guards or parked-voucher protections. Keep unsupported funding and channel-type transitions blocked. |
| [Setup preconditions][channel-setup] require no HTLCs or pending updates and an eligible anchor channel; simple taproot is rejected. | Keep initial scope explicit. Queue or refuse setup safely when the channel is busy; do not imply this work adds arbitrary channel-type support. |
| [Commitment binding][channel-binding] hashes both commitment numbers and transaction IDs; the output checker requires total HTLC output count to equal book length. | Implement the contract's binding rules and exact voucher-subset checks in both views, alongside normal validation of unrelated HTLCs. |
| [Routing admission][channel-admission] refuses frozen channels; [local graph construction][node-routing] excludes channels that cannot accept new HTLCs. | Use the same admission rules for advertised availability, route selection, set preflight and final HTLC insertion. Reserved capacity must not be counted twice. |
| [Commitment scheduling][manager-signing] waits for the previous remote revocation before signing again and [resumes on revocation][manager-revocation]. | Preserve this serialization. Coexistence does not authorize overlapping unsupported commitment rounds or overwriting retransmission state. |
| [Receipt import][node-preimage] persists preimages and informs chain monitors; [monitor resolution][monitor-point] pins the remote point belonging to the classified commitment. | Retain claim material for every still-relevant generation. A newer live point or output index cannot substitute for the generation actually broadcast. |
| [Cooperative rescue][node-rescue] closes an ACTIVE epoch after collecting evidence; [Umbrel return handling][umbrel-return] targets ACTIVE and DRAINING epochs. | Integrate the contract's reconciliation and retirement behavior. Returning online alone must not silently invalidate a still-live invoice. |

Current wallet timing is policy, not a cancellation proof. The [coordinator][receive-create]
creates a 600-second invoice, a settlement deadline at `height + 144`, and voucher
expiry at `height + 144 + 1152`. Its [sync loop][receive-sync] waits for a successful
receipt query and then requests recovery after payment, unused setup, or invoice
expiry plus 120 seconds. The [runtime][runtime-sync] invokes sync every two seconds.
These durations do not demonstrate that no payment or receipt is still in flight.

Chicory's [foreground refresh][chicory-refresh] polls while active and refreshes when
the app returns to active. Mobile suspension and process termination must be treated
as expected conditions; a faster poll or background timer cannot supply the missing
protocol guarantees.

## Milestones and release gates

All milestones below are open. Their order expresses dependencies, not estimates.
Implementations may split work into smaller changes while retaining these gates.

### M1: contract and executable state model

- Review the concurrent design and its proposed experimental wire assignments
  before enabling production behavior. Record supported channel types and operations.
- Model activation, ordinary updates, delegated settlement, evidence import,
  retirement, reconnect and enforcement, including crossing actions and crashes.
- Specify which durable fact authorizes each signature, revocation and upstream
  preimage release. Model restart from each previous durable state.
- Resolve refused-accept transcript binding and late voucher additions, the
  mixed-commitment fee-buffer rule during failback, consumed-record retention,
  and admission and enforcement policy for a disputed signed removal before
  claiming those behaviors are qualified.
- Produce positive and negative vectors for the new binding and transcript rules.

Gate: model properties and vectors cover the contract's safety invariants; review
all counterexamples and unresolved assumptions. A simulation is not a security proof.

### M2: negotiated engine support and durable state

- Add capability negotiation, profile-specific dispatch and durable versioned state.
  Refuse unsupported combinations before exposing an invoice.
- Preserve the existing frozen profile and its transcript bytes. Do not reinterpret
  a restored existing-profile epoch as concurrent.
- Integrate voucher reservations with both commitment builders, admission limits,
  signing, revocation bookkeeping, retransmission and recovery persistence.
- Persist the transaction, commitment number, signatures and exact replay
  dependencies as one immutable signed commitment. Never replace a released or
  durably queued signature with one for a different transaction at the same
  number.
- Validate live vouchers as a subset of outputs, including their amounts, hashes,
  expiries, spend paths and enforceability. Validate unrelated outputs normally.
- Ensure fee policy and changing HTLC counts cannot trim or underfund a voucher;
  cover fees, reserves and claim costs according to the approved contract.

Gate: deterministic one-channel tests exercise unrelated sends and receives with an
unpaid voucher. Every rejected operation leaves the existing invoice enforceable.

### M3: settlement, reconciliation and retirement

- Integrate settlement authorization with ordinary channel updates. Evidence must
  remain attributable to the correct epoch, slot and protection state.
- Persist receipt evidence and claim material before the transition that needs it.
  Retries must be idempotent across both peer restart and receiver restart.
- Redeem paid vouchers while the book remains active; fail unpaid vouchers only
  under the contract's terminal close rules. Release value and slot reservations
  only when the necessary channel transition is final.
- Preserve unpaid invoice identity and validity through normal foreground return
  and unrelated operations. A wall-clock timeout alone must not authorize removal.
- Preserve witness and issuer activation bindings across live sync and partial
  redemption. Do not close either service merely because the wallet reconnects.
- Complete a matching live fetch independently from snapshot progress, include
  recorded redemptions without upstream records in cumulative reports, and
  retain contradictory signed snapshots and final close evidence without losing
  preimages.
- Check final removal records in both signed views before closing a book with no
  live voucher entries; unrelated ordinary traffic must not postpone `CLOSED`.

Gate: crossing settlement and retirement, duplicate evidence, missing evidence and
partial reconnect cannot produce double credit, lost claim rights or unsafe reuse.

### M4: chain enforcement, backup and restore

- Track commitment-specific scripts, signatures, output indexes and key material
  for every broadcastable state, including asymmetric commitment-round windows.
- Classify actual broadcasts before constructing claims. Test revoked-state justice
  separately from normal voucher recovery.
- Carry protection state through channel monitor persistence, recovery snapshots,
  watchtower data and restart. Preserve existing stale-state safety holds.
- Apply the authoritative restore barrier before publishing a snapshot sequence.
  A restore missing publication state must recover it before publishing again.
- Treat a learned preimage after a signed voucher failure using the actual
  signed commitment views. Preimage retention alone does not undo that failure
  or restore a removed output. Automatic force-close in this dispute requires a
  separate approved policy; do not infer it from the receipt-import path.
- Test fee bumps, timeout paths, reorgs and delayed evidence on real regtest spends.

Gate: every applicable broadcast window in the matrix below has executed on-chain
results with mined transactions and balance assertions. Passing off-chain tests is
insufficient to enable wallet use.

### M5: wallet core, portable runtime and native applications

- Replace whole-channel reservations only for a qualified concurrent profile.
  Report available balance, reserved inbound capacity and remaining slot capacity.
- Remove zero-local-balance selection for that profile and preserve all other
  admission limits. Verify quotes and final insertion use consistent capacity.
- Update send review, ordinary receive, Activity and lifecycle handling. Explain a
  capacity refusal without presenting the entire wallet as unusable.
- Keep pending offline receipts separate from spendable balance until the engine
  reports the relevant final state. Deduplicate recovery and Activity by identity.
- Bound the coordinator's setup wait starting with its own `ff_init`; do not
  assume a receiver-side engine timer will abort an abandoned setup. On timeout
  before `ACTIVATING`, request the engine's normal signed setup abort and retain
  the channel reservation until any real voucher additions are safely unwound.
  In `ACTIVATING`, preserve the acknowledgement-loss window and reconcile the
  peer's state before deciding whether activation completed. Do not release the
  reservation or start a replacement epoch solely because the application wait
  expired.
- Update pinned dependencies together and record the artifacts actually bundled in
  each app. Qualify background, foreground, force-stop and cold-launch paths.

Gate: the complete acceptance scenario works with exactly one receiver channel in
the packaged app; no hidden second channel, manual intervention or invoice replacement.

### M6: interoperability and controlled release

- Run current/current, current/legacy and legacy/current negotiation combinations.
  Preserve refusal and fallback behavior agreed in the contract.
- Run ordinary payer compatibility against the targeted external implementations.
  Qualify distinct settlement-peer implementations separately when available.
- Obtain independent review of the new protection, persistence and recovery logic.
  Track unresolved findings and state which threat assumptions remain unchanged.
- Keep partial implementations as unadvertised prototypes. Advertise version 1
  only after all of its required behavior qualifies. Retain the ability to stop
  creating new concurrent epochs without discarding live ones.

Gate: publish exact revisions, build identifiers, executed counts, exclusions and
review status. Existing FFOR test results in [IMPLEMENTATION.md](IMPLEMENTATION.md)
do not qualify this extension.

## Required qualification matrix

Each row is required coverage, not a report of passing tests. Parameterize supported
channel types and fee policies; use real peer transport for reconnect and replay.

| Family | Cases | Required observation |
|---|---|---|
| One-channel acceptance | Nonzero receiver balance; unpaid offline invoice; unrelated send and ordinary receive; receiver terminates; payer pays original invoice; receiver restarts twice | Original invoice unchanged; sender finishes while receiver absent; correct exactly-once credit; available capacity remains accurate |
| Ordinary traffic | Bidirectional adds and removals, multiple payment hashes, MPP where ordinary channel support allows it, payment retries | Voucher invariants hold; ordinary limits and payment deduplication remain effective; no implied delegated-MPP support |
| Commitment crashes | Before/after persistence, each signature, each revocation, outbox write and replay acknowledgment; both peers independently restart | No lost protection, revoked broadcast, reused signing material, omitted replay or premature reservation release |
| Settlement crashes | Evidence stored/not stored; upstream fulfillment crossing a channel update; peer restart before/after receipt response | Any completed payer payment retains the required receiver recovery path; imports and acknowledgments are idempotent |
| Retirement races | Payment versus cancellation, settlement versus expiry, evidence arriving during removal, duplicate requests, partial removal round | No removal based only on elapsed time; exactly one terminal result; a still-live invoice remains backed |
| Capacity limits | Reserve boundary, remaining inbound value, maximum HTLC count and value, dust boundary, mixed-commitment cost at the fixed feerate, simultaneous quote users, attempted `update_fee` in ACTIVE and DRAINING | Unsafe new work refused; version 1 fee changes rejected; existing obligations retained; no double allocation |
| Current broadcasts | Both sides' commitments before/during/after update rounds, disconnect before final revocation, later evidence import | Correct transaction-specific claim material; paid vouchers recover; unpaid vouchers time out according to contract |
| Revoked broadcasts | Pre-activation and later revoked generations; restart before detecting broadcast | Correct classification and justice handling; no normal claim path incorrectly treats revoked state as current |
| Chain stress | Fee spikes and bumps, delayed confirmation, timeout race, reorg before/after claim confirmation, applicable pinning cases | Recoverable claim state persists; required margins and assumptions documented; balances and spent outputs verified |
| Recovery sources | Settlement peer absent, witness absent, delayed/unbarriered record where supported, restored snapshot with unproven recency | Existing recency holds preserved; no fabricated receipt, credit or indefinite recovery guarantee |
| Compatibility | Concurrent/current, concurrent/legacy, unsupported profile, attempted downgrade, restore across software upgrade, missing either feature on reconnect and subsequent restoration | Deterministic negotiated behavior; incompatible reconnect holds new admission without discarding existing obligations; live epochs keep their original semantics; existing-profile vectors unchanged |
| Setup and refusal | Barrier from the first setup message; unsupported value versus malformed TLV length; authenticated refused accept; late voucher adds; coordinator timeout; abort crossing activation quiescence | No invoice exposure or epoch revival after refusal; agreed transcript binding and safe unwind; no reservation release before real voucher obligations finish; acknowledgement-loss window retained |
| Signed removal and replay | Preimage import before and after a voucher-failure signature is durably queued; asymmetric commitment views; close-state mismatch; missing local close record | Exact signed transactions and replay dependencies retained; no alternative signature at the same commitment number; no claim that preimage retention reverses a signed failure; data-loss recovery preserves obligations |
| Live snapshot and empty drain | Reportable redemption without an upstream record; authoritative restore barrier; matching equal/lower sequence; final ack clearing a reported bit; retirement after all vouchers were redeemed | Durable cumulative reporting; fetch completion without rollback; contradictory evidence and preimages retained; `CLOSED` after final ack and complete voucher records without requiring an ordinary round |
| Native lifecycle | iOS and Android background/suspension, force-stop, lost network, cold start, repeated cold start, receiver absent at payment | Correct durable recovery without relying on background execution; no duplicate Activity or unsafe spendable balance |

Use independent clocks for invoice wall time and chain height. Exercise deadline
boundaries, not only a convenient fast path. Record skips as missing qualification.

## Existing test scaffolding and evidence to publish

The [portable coordinator suite][coordinator-tests] already checks that reopening an
unpaid request preserves its reservation, paid recovery releases it, expiry grace
is observed, failed receipt queries do not close it, and stale jobs cannot recover
a replacement epoch. Retain those expectations for the existing profile and add
separate concurrent-profile assertions.

The [native harness][native-harness] already terminates the receiver before payment
and checks repeated cold launch. Extend its setup to the one-channel funded case
and unrelated traffic; qualify the harness against the current app API before
treating a run as evidence. Test-file presence does not establish execution.

For each qualification run, retain:

- specification and implementation commits, dependency lock/build identifiers,
  channel type, negotiated features, role configuration and relevant timing values;
- test command, environment, actual passed/failed/skipped counts and scenario seeds;
- crash injection boundary and recovered durable state for each restart case;
- transaction IDs, mined heights, claim paths and resulting balances for chain cases;
- native platform/build and lifecycle actions for device cases;
- unresolved limitations and the exact profile/operation set the evidence supports.

This proposal adds the specification and standalone executable models. No concurrent
engine, regtest, native-device or interoperability tests have been executed for it.
The downstream release gates remain open; model results do not satisfy them.

[chicory-deps]: https://github.com/coreyphillips/chicory/blob/0135b9db0630e8867f7c4f0c48b34caa4bd7c7de/package.json#L17
[receive-selector]: https://github.com/coreyphillips/beignet-portable-engine/blob/95f4b3dc36c1c78256c46f102aeba6683574c976/portable/offline-receive.ts#L93
[runtime-channelize]: https://github.com/coreyphillips/beignet-portable-engine/blob/95f4b3dc36c1c78256c46f102aeba6683574c976/portable/runtime.ts#L349
[runtime-channels]: https://github.com/coreyphillips/beignet-portable-engine/blob/95f4b3dc36c1c78256c46f102aeba6683574c976/portable/runtime.ts#L745
[channel-freeze]: https://github.com/coreyphillips/beignet-portable-engine/blob/95f4b3dc36c1c78256c46f102aeba6683574c976/src/lightning/channel/channel.ts#L22047
[channel-setup]: https://github.com/coreyphillips/beignet-portable-engine/blob/95f4b3dc36c1c78256c46f102aeba6683574c976/src/lightning/channel/channel.ts#L22226
[channel-binding]: https://github.com/coreyphillips/beignet-portable-engine/blob/95f4b3dc36c1c78256c46f102aeba6683574c976/src/lightning/channel/channel.ts#L23052
[channel-admission]: https://github.com/coreyphillips/beignet-portable-engine/blob/95f4b3dc36c1c78256c46f102aeba6683574c976/src/lightning/channel/channel.ts#L13646
[node-routing]: https://github.com/coreyphillips/beignet-portable-engine/blob/95f4b3dc36c1c78256c46f102aeba6683574c976/src/lightning/node/lightning-node.ts#L15591
[manager-signing]: https://github.com/coreyphillips/beignet-portable-engine/blob/95f4b3dc36c1c78256c46f102aeba6683574c976/src/lightning/channel/channel-manager.ts#L1863
[manager-revocation]: https://github.com/coreyphillips/beignet-portable-engine/blob/95f4b3dc36c1c78256c46f102aeba6683574c976/src/lightning/channel/channel-manager.ts#L4365
[node-preimage]: https://github.com/coreyphillips/beignet-portable-engine/blob/95f4b3dc36c1c78256c46f102aeba6683574c976/src/lightning/node/lightning-node.ts#L17660
[monitor-point]: https://github.com/coreyphillips/beignet-portable-engine/blob/95f4b3dc36c1c78256c46f102aeba6683574c976/src/lightning/chain/chain-monitor.ts#L138
[node-rescue]: https://github.com/coreyphillips/beignet-portable-engine/blob/95f4b3dc36c1c78256c46f102aeba6683574c976/src/lightning/node/lightning-node.ts#L17940
[umbrel-return]: https://github.com/coreyphillips/beignet-umbrel/blob/7d71b24e5d7001baed121b82702a6e05741bb2d0/manager/server/ffor.js#L349
[receive-create]: https://github.com/coreyphillips/beignet-portable-engine/blob/95f4b3dc36c1c78256c46f102aeba6683574c976/portable/offline-receive.ts#L336
[receive-sync]: https://github.com/coreyphillips/beignet-portable-engine/blob/95f4b3dc36c1c78256c46f102aeba6683574c976/portable/offline-receive.ts#L440
[runtime-sync]: https://github.com/coreyphillips/beignet-portable-engine/blob/95f4b3dc36c1c78256c46f102aeba6683574c976/portable/runtime.ts#L563
[chicory-refresh]: https://github.com/coreyphillips/chicory/blob/0135b9db0630e8867f7c4f0c48b34caa4bd7c7de/src/services/useWalletSession.ts#L307
[coordinator-tests]: https://github.com/coreyphillips/beignet-portable-engine/blob/95f4b3dc36c1c78256c46f102aeba6683574c976/portable-tests/offline-receive.test.cjs#L81
[native-harness]: https://github.com/coreyphillips/beignet-portable-engine/blob/95f4b3dc36c1c78256c46f102aeba6683574c976/scripts/regtest-ffor-native.cjs#L86
