# Implementation status and verification

This document maps the FFOR draft to the current reference implementation. It
separates source/test coverage, checks executed for this snapshot, and qualification
work still needed for another Lightning engine or a wallet release.

## Pinned baseline

- Review date: **2026-09-17**.
- Specification: draft **v0.9.3**, including section 17's errata and Appendix F paging.
- Reference: Beignet
  [`9ea018b6371c8b22366a133bc504679ac04b830e`](https://github.com/coreyphillips/beignet/tree/9ea018b6371c8b22366a133bc504679ac04b830e)
  on `master`.
- Historical A/B reference: the
  [`feat/ffor`](https://github.com/coreyphillips/beignet/tree/2b15cfb6bf6f82c87350b62f38512346ce284432)
  prototype. Its M1-M7 status does not establish current D/D-R conformance.
- Downstream implementation tracker:
  [synonymdev/ldk-node#117](https://github.com/synonymdev/ldk-node/issues/117), covering
  rust-lightning, ldk-node, Blocktank interoperability and both Bitkit applications.

The draft and implementation must be compared at pinned revisions. A moving branch,
closed issue, or test filename is not a verified interoperability result. Differences
must be classified as implementation bugs, specification ambiguities, extensions or
missing coverage before a port adopts them.

## Current implementation map

All Beignet paths below refer to the pinned revision. The executable checks described
in the next section cover these suites, except where a limitation is stated.

| Area | Source | Existing evidence and limits |
|---|---|---|
| M8.1: signed lifecycle and voucher setup | [`types.ts`, `messages.ts`, `transcript.ts`, `voucher.ts`, `amounts.ts`](https://github.com/coreyphillips/beignet/tree/9ea018b6371c8b22366a133bc504679ac04b830e/src/lightning/ffor) and [`channel.ts`](https://github.com/coreyphillips/beignet/blob/9ea018b6371c8b22366a133bc504679ac04b830e/src/lightning/channel/channel.ts) | `ffor-variant-d-vectors.test.ts`, `ffor-variant-d-setup.test.ts`, `ffor-adversarial-safety.test.ts`, `ffor-adversarial-recovery.test.ts`; Appendix D is the byte-level baseline |
| M8.2/M8.3: offline settlement and cooperative return | [`lightning-node.ts`](https://github.com/coreyphillips/beignet/blob/9ea018b6371c8b22366a133bc504679ac04b830e/src/lightning/node/lightning-node.ts), channel lifecycle and serialization | `ffor-variant-d-settlement.test.ts`, `ffor-settle-policy.test.ts`, `ffor-adversarial-recovery.test.ts`, `ffor-variant-d-quorum.test.ts`; these exercise Beignet roles, not an LND/LDK pair |
| M8 transport | [`channel-manager.ts`](https://github.com/coreyphillips/beignet/blob/9ea018b6371c8b22366a133bc504679ac04b830e/src/lightning/channel/channel-manager.ts) and peer transport | `ffor-variant-d-networking.test.ts` runs setup and close over a real TCP peer connection; it is separate from the in-process on-chain fixture |
| M8.0/M8.4/M8.5/M8.7: penalty, payer rescue, chained claims and unpaid timeout | Channel and chain-monitor claim paths | [`interop/ffor-variant-d-regtest.test.ts`](https://github.com/coreyphillips/beignet/blob/9ea018b6371c8b22366a133bc504679ac04b830e/tests/lightning/interop/ffor-variant-d-regtest.test.ts) submits, mines and checks real transactions; peer links in this fixture are in-process |
| M8.5/M8.6: hash chains and preimage release order | Channel and node settlement handling | `ffor-variant-d-m8.test.ts`; uniform amounts, ordered chain settlement, no unpaid receiver preimage, and irrevocably committed upstream HTLC requirement |
| M8.8: same-hash reuse | Settlement handling | `ffor-variant-d-hash-reuse.test.ts` covers honest rejection and successful theft by a malicious settlement peer; passing the latter reproduces the limitation |
| M9.0: witness manifest, persistence and transport | [`witness-service.ts`, `witness-ledger.ts`, `witness-messages.ts`, `witness-crypto.ts`](https://github.com/coreyphillips/beignet/tree/9ea018b6371c8b22366a133bc504679ac04b830e/src/lightning/ffor) | `ffor-witness-manifest.test.ts`, `ffor-witness-store.test.ts`, `ffor-witness-transport.test.ts`; includes real BOLT 8 provision/fetch transport |
| M9.1/M9.2/M9.3: barrier, rescue and crash boundaries | Witness service, durable ledger and receiver recovery | `ffor-witness-barrier.test.ts`, `ffor-witness-crash.test.ts`; in-process payment/claim fixtures exercise record ordering, restart and recovery. These do not by themselves establish the full real-regtest witness crash matrix described in section 15.3 |
| v0.9.3 fetch paging | Witness messages/service and receiver fetch loop | `ffor-witness-paging.test.ts`; signed cursor requests, bounded pages and non-progress handling |
| M9.4: witness reuse | Witness/forwarding path | `ffor-witness-reuse.test.ts` characterizes reuse by a preimage-holding witness; it does not close the attack |
| M9.5: BOLT 12 issuer | [`issuer-service.ts`, `issuer-ledger.ts`, `issuer-messages.ts`, `issuer-paths.ts`](https://github.com/coreyphillips/beignet/tree/9ea018b6371c8b22366a133bc504679ac04b830e/src/lightning/ffor) | `ffor-issuer.test.ts` covers the reference implementation. Independent stock-payer and production-path interoperability still need their own execution evidence |
| Public API and daemon role wiring | [`beignet-node.ts`, `daemon.ts`, `daemon-options.ts`](https://github.com/coreyphillips/beignet/tree/9ea018b6371c8b22366a133bc504679ac04b830e/src/cli) | `tests/cli/ffor-surface.test.ts` and `tests/cli/daemon-options.test.ts`, including the role forwarding regression described by [Beignet #864](https://github.com/coreyphillips/beignet/issues/864) |

The named protocol tests are in the pinned
[`tests/lightning/`](https://github.com/coreyphillips/beignet/tree/9ea018b6371c8b22366a133bc504679ac04b830e/tests/lightning)
directory unless otherwise qualified.

## Verification recorded for this refresh

Environment: Node.js **22.13.1**, npm **11.17.0**, locked Beignet dependencies.
The SQLite native dependency must be available, and the transport/API tests need
permission to open local listening sockets.

Executed from the pinned Beignet checkout:

```sh
./node_modules/.bin/mocha --exit --timeout 30000 -r ts-node/register \
  'tests/lightning/ffor-*.test.ts' \
  tests/cli/ffor-surface.test.ts tests/cli/daemon-options.test.ts
```

Result: **199 passing, 0 failing, 0 pending**, across 40 suites. This selection
includes the public configuration tests, some of which also exercise other daemon
options. A preliminary restricted run could not open local sockets; the recorded
passing run used local networking. This is targeted FFOR verification, not the full
Beignet suite or an independent security audit.

The on-chain suite was also executed against an isolated Bitcoin Core 31.0 regtest
instance with a fresh wallet. The fixture's RPC port was temporarily changed from
43782 to 44782 to avoid an existing local chain, then restored:

```sh
./node_modules/.bin/mocha --exit --timeout 600000 -r ts-node/register \
  tests/lightning/interop/ffor-variant-d-regtest.test.ts
```

Result: **4 passing, 0 failing, 0 pending**. The executed cases cover M8.4 payer
preimage rescue after S disappears, M8.5 three-level chained claims using only the
final preimage, M8.7 unpaid-voucher timeout with R's balance intact, and M8.0 delayed
penalty recovery from a revoked pre-epoch commitment. Transactions were submitted
and mined by Bitcoin Core; the fixture uses in-process peer links.

Both appendix generators were run against the pinned reference. Their transaction,
script, signature and transcript output is unchanged. Only the regeneration
instructions and provenance text changed. Repeated runs produced byte-identical
output. Before these documentation edits, Appendix D also reproduced the original
checked-in file byte for byte.

## Reproduce and regenerate

Use disposable sibling checkouts named `beignet` and `ffor`, because the generators
import Beignet's source and dependencies through relative paths:

```text
work/
  beignet/
  ffor/
```

From the Beignet checkout, select the reference revision and install its locked
dependencies using the package manager's normal dependency-script approval policy:

```sh
git checkout --detach 9ea018b6371c8b22366a133bc504679ac04b830e
npm ci
```

Run the targeted suite above. For the on-chain gates, use a dedicated disposable
Bitcoin regtest instance matching Beignet's fixture. The fixture defaults to RPC port
43782 and mines blocks, so do not point it at a chain shared with other work. The
fixture currently skips when its RPC endpoint is unavailable; inspect the actual test
counts and require all four tests to execute:

```sh
npm run test:interop:ffor
```

The four tests cover M8.0, M8.4, M8.5 and M8.7. They do not establish cross-engine
interoperability or the entire M9 witness crash matrix.

Generate each appendix into a temporary output before replacing the checked-in file:

```sh
./node_modules/.bin/ts-node -P ../ffor/tools/tsconfig.json \
  ../ffor/tools/generate-ffor-variant-d-vectors.ts > /tmp/ffor-variant-d-vectors.md
./node_modules/.bin/ts-node -P ../ffor/tools/tsconfig.json \
  ../ffor/tools/generate-ffor-vectors.ts > /tmp/ffor-test-vectors.md

diff -u ../ffor/ffor-variant-d-vectors.md /tmp/ffor-variant-d-vectors.md
diff -u ../ffor/ffor-test-vectors.md /tmp/ffor-test-vectors.md
```

Review any difference. A changed signature, transaction, transcript or script needs
an explanation and compatibility assessment, not automatic replacement of the
expected value. The generators should also produce byte-identical output on repeated
runs. Appendix D fixture delays and balances are construction inputs, not recommended
production offline-window parameters.

## Porting and conformance checklist

The detailed cross-repository plan is
[ldk-node #117](https://github.com/synonymdev/ldk-node/issues/117). In particular:

- Preserve section 7.5's activation-acknowledgement loss exception. An `ACTIVATING`
  receiver retains its record while an already `ACTIVE` peer reestablishes with the
  matching activation hash and retransmits the acknowledgement.
- Persist complete state before acknowledgements and dependent signatures leave.
  `ACTIVE` remains frozen across disconnect and restart even though BOLT 2 quiescence
  ends. Variant D never adopts the A/B commitment-number exceptions.
- Require both commitment views and the necessary HTLC signatures before activation.
  Setup vouchers are reserved claims, not received payments.
- Preserve serial admission/close ordering, `SETTLING` replay and the final close
  bitmap. A valid known preimage must remain usable even if a peer denies payment.
- Match section 17.6's witness encryption corrections, including ECDH hashing, HKDF
  semantics and the zeroed ciphertext-hash field in the associated data. Match
  section 17.7's authenticated paging.
- Exercise S unavailable, witness unavailable, stale restore, process death,
  persistence failure and force-close from both commitment views. Validating a
  transaction locally is different from mining its complete claim path.
- Keep hash reuse, deadline fallback, finite fixed-amount capacity and one-of-N
  receipt availability explicit. Guardian receipts are not proof of Byzantine
  retrievability. Ordinary invoice issuance does not repair same-hash reuse.
- Attach separate results for an independent payer, the actual Blocktank settlement
  implementation, and Android/iOS with the wallet process stopped. The current
  reference checks do not establish those outcomes.

## Historical and deferred work

M1-M7 and Appendix A remain useful references for the A/B construction. The current
Variant D port does not need their unilateral updates, escape transactions or Variant B
tower mediation. Appendix C remains an unimplemented transport target in the inspected
baseline; its provisioning authentication issue is [FFOR #18](https://github.com/coreyphillips/ffor/issues/18).
It must not be marked complete because Appendix F witnesses are implemented.

Terminal one-shot witness recovery remains deferred in
[FFOR #32](https://github.com/coreyphillips/ffor/issues/32). MPP, simple-taproot and
payer-bound settlement primitives are separate protocol work, not implied by the
current tests or by the planned mobile port.
