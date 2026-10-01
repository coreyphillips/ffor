# Amountless receive: downstream integration scope

Assessed 2026-09-18. This document scopes downstream implementation; this FFOR PR does not implement or release the feature in Beignet, Umbrel, Chicory, or the web app.

## Supported behavior and limits

The existing section 9.7 issuer already permits a BOLT 12 **offer with no amount**. The payer supplies a positive `invreq_amount`; the issuer returns a fixed-amount invoice only when an unused, precommitted voucher has exactly that amount. This PR formalizes that receive-request profile and its safety requirements. It does not introduce unrestricted amountless BOLT 11 invoices.

At a product's receive-creation boundary, a blank amount or an explicitly documented zero sentinel can mean “payer chooses.” Normalize that sentinel to an absent offer amount, never to a zero invoice, zero-value voucher, or zero payment. Keep sender payment validation strictly positive. Merely removing existing amount checks would be unsafe: Variant D's pre-signed claim outputs have fixed values, not a signed variable range.

The initial release must disclose that supported amounts and payment count are bounded by prepared inventory. It must not round the payer's amount, select a larger voucher, or promise arbitrary amounts. Issuing an invoice consumes its slot even if the payer abandons it. An issuer/witness must remain reachable while the receiver is offline; issuer outage or exhausted inventory can prevent payment without authorizing a different amount.

## Source snapshots

Links below identify the inspected revisions, not a claim that downstream changes have shipped.

| Component | Inspected source |
| --- | --- |
| Beignet | [4c95e330faa1e24feb1b89c3a21dcedc8bc040dd](https://github.com/coreyphillips/beignet/tree/4c95e330faa1e24feb1b89c3a21dcedc8bc040dd) |
| Beignet Umbrel | [c6f5420816ed894e8d6df36b900010696375f13f](https://github.com/coreyphillips/beignet-umbrel/tree/c6f5420816ed894e8d6df36b900010696375f13f) |
| Portable engine | [aeff6c00bdf3c7c65c65efb6e30140f7858165f2](https://github.com/coreyphillips/beignet-portable-engine/tree/aeff6c00bdf3c7c65c65efb6e30140f7858165f2), with vendored Beignet baseline `e5529047c0f2adcea32f9865a28dee66d907fd57` / `0.21.8` |
| Shared wallet core | [c60669198e8f14ae3c44655157b9926b8fc1b31a](https://github.com/coreyphillips/beignet-wallet-core/tree/c60669198e8f14ae3c44655157b9926b8fc1b31a) |
| React Native / Chicory | [721a3a79f2b610008a042f14943e97732a48eeed](https://github.com/coreyphillips/chicory/tree/721a3a79f2b610008a042f14943e97732a48eeed) |
| Web | Local `beignet-projects/beignet-web` snapshot, version `0.1.0`; this directory has no Git repository or verifiable commit pin. Its dependencies reference sibling portable-engine and shared directories. |

Chicory's inspected package pins portable engine `7b3d9fb31729da328f939e61f74de2f92813bb6a` and wallet core `d276ec2d0730f51142599e86895faed5f69c85db`; release work must update those pins rather than assume the newer sibling checkouts are already installed.

## Implementation work

**Beignet.** Reuse the optional-amount issuer API in [src/cli/beignet-node.ts:7083](https://github.com/coreyphillips/beignet/blob/4c95e330faa1e24feb1b89c3a21dcedc8bc040dd/src/cli/beignet-node.ts#L7083), issuer provisioning, and the exact positive amount selection in [src/lightning/ffor/issuer-service.ts:318](https://github.com/coreyphillips/beignet/blob/4c95e330faa1e24feb1b89c3a21dcedc8bc040dd/src/lightning/ffor/issuer-service.ts#L318). Add a typed offer result and capability negotiation to the normal receive flow. Its [src/cli/offline-receive.ts:77](https://github.com/coreyphillips/beignet/blob/4c95e330faa1e24feb1b89c3a21dcedc8bc040dd/src/cli/offline-receive.ts#L77) currently requires a positive amount, allocates for one amount, creates one fixed slot, and journals one invoice. Add bounded denomination/count policy, inventory funding, issuer/witness setup, durable offer ownership, expiry, exhaustion and recovery without invalidating issued-but-unpaid invoices.

Also verify receiver payment-row materialization for issuer-created invoices: [lightning-node.ts:17396](https://github.com/coreyphillips/beignet/blob/4c95e330faa1e24feb1b89c3a21dcedc8bc040dd/src/lightning/node/lightning-node.ts#L17396) assumes an existing receiver payment record. A settled voucher must produce a durable, correctly attributed Activity receipt even when the receiver never created its invoice locally.

**Required issuer hardening.** Existing [issuer-service.ts:334](https://github.com/coreyphillips/beignet/blob/4c95e330faa1e24feb1b89c3a21dcedc8bc040dd/src/lightning/ffor/issuer-service.ts#L334) indexes retries by payer key and metadata hash, then returns cached invoice bytes. Persist a commitment to the complete accepted non-signature invoice request; reject changed amount, quantity or other request fields under the same reservation key. Enforce atomic uniqueness of both request keys and slot ownership across offers/mailboxes. For an eligible exact retry, refuse or create a fresh response using the current authorized arrival path's signing key, the same reserved hash and amount, and an expiry capped by the original absolute deadline. Do not replay cached invoice bytes: these offers omit `offer_issuer_id`, so BOLT 12 does not permit that replay. A different authorized transport path alone is not a changed request. Preserve reservation/expiry constraints across crashes; never extend its lifetime or recycle a slot after abandonment. These are implementation gaps to close before enabling the broader product flow, not changes achieved by this documentation PR.

**Reusable-book recovery.** The current [automatic receive recovery](https://github.com/coreyphillips/beignet/blob/4c95e330faa1e24feb1b89c3a21dcedc8bc040dd/src/cli/offline-receive.ts#L310) assumes one locally minted invoice and its expiry. Replace that assumption for offers: absence of a local BOLT 11 invoice or completion of one payment must not auto-close a reusable book that still backs valid issued invoices or remains open for new reservations.

**Safe sender APIs.** [BeignetNode.payOffer:10504](https://github.com/coreyphillips/beignet/blob/4c95e330faa1e24feb1b89c3a21dcedc8bc040dd/src/cli/beignet-node.ts#L10504) requests and pays an invoice in one call; it accepts no reviewed fee cap. Add resolve/validate invoice, estimate, and explicitly submit the same reviewed invoice with a fee ceiling. Bind amount, invoice identity, offer/request, expiry and review to prevent a fresh invoice or changed terms at submission. This work is included separately in the estimate below.

**Umbrel.** [manager/server/wallet-manager.js:2965](https://github.com/coreyphillips/beignet-umbrel/blob/c6f5420816ed894e8d6df36b900010696375f13f/manager/server/wallet-manager.js#L2965) already omits the offer amount for a nonuniform prepared book; uniform books receive a fixed offer amount. Add an explicit payer-chooses mode for either book, capability gating, normal Receive integration and inventory/offer lifecycle display. Update `manager/ui/src/pages/tabs/ReceiveTab.jsx`, FFOR setup/provisioning, mocks and tests. [SendTab.jsx:1223](https://github.com/coreyphillips/beignet-umbrel/blob/c6f5420816ed894e8d6df36b900010696375f13f/manager/ui/src/pages/tabs/SendTab.jsx#L1223) already calls `/offer/pay`; migrate its offer branch to the reviewed sender APIs.

Preserve the existing topology requirement in [manager/server/ffor.js:315](https://github.com/coreyphillips/beignet-umbrel/blob/c6f5420816ed894e8d6df36b900010696375f13f/manager/server/ffor.js#L315): the issuer is a distinct receipt witness upstream of the settlement peer. Detect that capability and provision it explicitly; a single primary with only the settlement role does not make this offer flow available.

**Portable engine.** Port the Beignet changes once, then replace the fixed single-invoice assumption in [portable/offline-receive.ts:64](https://github.com/coreyphillips/beignet-portable-engine/blob/aeff6c00bdf3c7c65c65efb6e30140f7858165f2/portable/offline-receive.ts#L64). [portable/runtime.ts:818](https://github.com/coreyphillips/beignet-portable-engine/blob/aeff6c00bdf3c7c65c65efb6e30140f7858165f2/portable/runtime.ts#L818) currently exposes basic FFOR lifecycle operations but no issuer/witness provisioning or offer-payment endpoints. Expose only the required operations and capabilities, and add durable multi-slot/offer coordination. Preserve reservations through process termination and reconcile issued, paid, expired and unused states on restart.

**Shared wallet core.** [src/index.js:1645](https://github.com/coreyphillips/beignet-wallet-core/blob/c60669198e8f14ae3c44655157b9926b8fc1b31a/src/index.js#L1645) rejects an absent amount for offline receive; line 1185 rejects all BOLT 12 sends. Add capability-driven receive selection and the reviewed offer-payment flow. The URI parser already recognizes `lno1`, including inside BIP21; parsing alone is not payment support. Keep unsupported providers from silently falling back to an online-only invoice.

**Request/history model shared by both apps.** [ReceiveRequest](https://github.com/coreyphillips/beignet-wallet-core/blob/c60669198e8f14ae3c44655157b9926b8fc1b31a/src/index.d.ts#L138) currently requires one `bolt11` and one `paymentHash`. [portable/receive-requests.ts:19](https://github.com/coreyphillips/beignet-portable-engine/blob/aeff6c00bdf3c7c65c65efb6e30140f7858165f2/portable/receive-requests.ts#L19) validates and binds that exact invoice. Introduce a distinct offer request kind with durable offer identity and an offer-to-issued-invoices relationship. A reusable offer must survive its first payment, display each actual received amount once, and distinguish availability/exhaustion from the status of individual invoices. Preserve existing BOLT 11 records and Bitcoin-address tracking during migration.

**RN and web.** [Chicory Payments.tsx:362](https://github.com/coreyphillips/chicory/blob/721a3a79f2b610008a042f14943e97732a48eeed/src/screens/Payments.tsx#L362) and web `app/page.tsx:1518` always require an amount for an embedded wallet. Replace the class-based gate with the new capability, add offer QR/share/details and payer amount review, and explain supported amounts without revealing private book state in protocol errors. Existing ordinary amountless BOLT 11 UI and sender amount input are reusable. Update dependency pins/builds, receipt/history views and native/browser lifecycle tests.

## Validation and interoperability

- Retain fixed-amount regressions; test blank/zero creation normalization without accepting zero payer amounts, vouchers or invoice amounts.
- Test supported positive denominations, generic rejection of unsupported amounts, no rounding, exhaustion, concurrent requests, duplicate/conflicting retries, original expiry, signing-path validation and crash-before-invoice-storage recovery.
- Test stale/changed reviews, fee ceilings, issuer/provider outage, no downgrade, correct invoice/request association, multi-payment offer history and restart deduplication.
- Extend `portable-tests/offline-receive.test.cjs`, `shared/test/wallet.test.js`, RN `__tests__/ReceiveParity.test.tsx` and `native-tests/OfflineReceive.tsx`, and web `tests/worker-ffor-regtest.mjs` / UI tests. Pay while the receiver process/worker is stopped, then verify recovery after two restarts.
- Run funded regtest with an unmodified BOLT 12-capable payer: offer retrieval, positive `invreq_amount`, fixed final invoice, blinded payment path and settlement. Do not infer stock interoperability from model vectors or mocks, and do not imply that BOLT 11-only wallets can pay an `lno1` offer. Keep the fixed BOLT 11 receive option for them.

## Effort and delivery slices

Estimates are engineer-days for implementation and focused regression/interoperability testing by an engineer familiar with these repositories. Shared components are counted once. They exclude infrastructure deployment, app-store/release waits and an independent external security audit.

| Component | Engineer-days | Included boundary |
| --- | ---: | --- |
| Beignet | 9–16 | 7–12 receiving/issuer hardening plus 2–4 safe sender APIs |
| Beignet Umbrel | 4–6 | Manager/Receive integration, offer review/send, mocks/tests |
| Portable engine | 5–8 | Upstream integration, runtime/coordinator, persistence tests |
| Shared wallet core | 4–6 | Request/history model, receive/send workflows, tests |
| RN / Chicory | 2–4 | UI, dependency updates, native lifecycle tests |
| Web | 2–3 | UI, dependency updates, worker lifecycle tests |
| **Full integration** | **26–43** | **Approximately 5–9 working weeks sequentially for one engineer** |

A smaller **prepared-book slice** is approximately **5–8 days**: Beignet issuer hardening/explicit API behavior **3–5**, plus Umbrel configuration/UI **2–3**. It assumes an operator has already prepared the exact voucher denominations and issuer/witness topology, uses an external compatible payer, and excludes automatic normal Receive integration, RN/web support and the new reviewed sender APIs. This is an alternative first slice, not an additional line to sum into the full estimate.

Sequence: harden/test the core issuer and finalize the API contract; integrate Umbrel and portable/shared in parallel where possible; then update both apps and complete stock-payer/native/browser acceptance tests. Truly arbitrary amountless BOLT 11 requires a separate claim/settlement protocol design and security analysis; it is excluded from these estimates.
