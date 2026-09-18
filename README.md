# FFOR: Fast-Forward Offline Receive

A draft Lightning protocol extension for bounded, non-custodial offline receive:
the payer's payment can finish while the recipient's wallet is offline, and the
recipient later redeems an enforceable channel claim using the payment preimage.
Recovery depends on returning before the claim deadline and obtaining that preimage
from an available recovery source. The same-hash reuse limitation remains open.

The current reference implementation uses **Variant D**, the pre-signed voucher
book. While online, the recipient `R` and its settlement peer `S` commit a finite
set of fixed-amount HTLC vouchers in both channel commitment views. They activate
the epoch with a signed, durable handshake. During the offline period, `S` settles
eligible incoming payments upstream without sending per-payment channel updates to
`R`. On return, `R` obtains the preimages and claims the paid vouchers cooperatively
or on-chain. The older Variants A/B instead mint vouchers during the epoch through
unilateral fast-forward updates.

**D-R** adds receipt witnesses on the payment path. A witness normally stores an
encrypted preimage record durably before propagating fulfilment, giving `R` another
recovery source. Its barrier is bounded; deadline fallback can propagate first and
later mark the record `unbarriered`. An optional BOLT 12 issuer answers new invoice
requests while `R` is offline, using unconsumed slots from the same fixed-amount book.

**Receiving without entering an amount:** draft v0.9.5 defines a payer-chosen
receive interface using an amountless BOLT 12 offer. The payer chooses a positive
amount and gets a fixed invoice only if an exact matching voucher is available.
Blank or zero can be a wallet input for this mode; no zero-valued invoice or voucher
is created. This does not support arbitrary-amount BOLT 11 offline invoices.
[Scope and integration plan](AMOUNTLESS-RECEIVE.md) describes the existing issuer
support, remaining implementation work and per-app estimates.

No Bitcoin consensus change is required. Ordinary compatible payers and ordinary
routing nodes need no FFOR extension. The receiver, settlement peer, and any chosen
receipt witnesses or issuer must implement their respective roles.

## Contents

| File | What it is |
|---|---|
| [`ffor-offline-receive.md`](ffor-offline-receive.md) | Draft v0.9.5: lifecycle, variants, amount/fee rules, wire messages, enforcement, recovery and security limits |
| [`AMOUNTLESS-RECEIVE.md`](AMOUNTLESS-RECEIVE.md) | Payer-chosen request design, downstream implementation scope and effort estimates |
| [`IMPLEMENTATION.md`](IMPLEMENTATION.md) | Pinned reference revision, implementation/test matrix, verification scope and porting checklist |
| [`ffor-variant-d-vectors.md`](ffor-variant-d-vectors.md) | Appendix D: Variant D setup transcript, both commitment views, activation hashes and claim paths |
| [`ffor-test-vectors.md`](ffor-test-vectors.md) | Appendix A: older fast-forward `C_i^R` commitments and amount/fee arithmetic; not a substitute for Appendix D |
| [`tools/`](tools/) | Vector generators using a sibling Beignet checkout; regeneration instructions in `IMPLEMENTATION.md` |

## Reference implementation

The current source baseline is Beignet `master` at
[`9ea018b6371c8b22366a133bc504679ac04b830e`](https://github.com/coreyphillips/beignet/tree/9ea018b6371c8b22366a133bc504679ac04b830e),
inspected on 2026-09-17. It contains Variant D, the D-R witness service/client,
BOLT 12 issuance, public APIs, and daemon configuration for the corresponding roles.
[Implementation status and verification](IMPLEMENTATION.md) links each area to its
source and tests and records which checks have actually been run.

The older [`feat/ffor`](https://github.com/coreyphillips/beignet/tree/feat/ffor)
prototype covers the A/B, tower and escape work described by M1-M7. It is historical
context, not the implementation baseline for the current Variant D port. Appendix C's
Variant B tower transport remains separately specified and unimplemented in the
inspected baseline; Appendix F's implemented D-R witness transport is a different
protocol.

The cross-implementation and mobile work is tracked in
[ldk-node #117](https://github.com/synonymdev/ldk-node/issues/117). It targets offline
receives in Bitkit Android and Bitkit iOS, with compatible Blocktank settlement
support. That tracker is planned work, not evidence of existing LDK/LND interoperability.

## Recovery assumptions and limits

- **Finite capacity and amounts.** Variant D precommits a bounded set of fixed-amount
  vouchers and reserves channel liquidity. Single-part payments, negotiated HTLC
  limits, dust rules and fees constrain what can be received. An issuer does not
  make the book unlimited or support arbitrary amounts automatically.
- **Bounded offline window.** `R` must retrieve evidence and reconcile or enforce
  before the voucher expiry with enough claim margin. No indefinite recovery or
  seed-only recovery guarantee is made.
- **Chain watching.** A sufficiently long `to_self_delay` on `S`'s outputs can allow
  `R` to punish a revoked broadcast after returning (§5.1). That delay is negotiated
  at channel opening; existing channels must be checked against the intended window.
  Otherwise the deployment needs suitable chain watching.
- **Receipt availability.** Plain Variant D relies on an available source among
  `S`, payers and any mailbox. D-R adds chosen witnesses. At least one usable source
  must retain and return the needed preimage before the deadline. Witness receipts
  do not prove unconditional availability.
- **Hash reuse.** A malicious party holding a preimage can settle another payment
  on the same hash without another receiver credit (§13.7). Honest duplicate checks
  and single-use invoice distribution mitigate exposure but do not cryptographically
  prevent it. BOLT 12 issuance alone does not close it.

The deferred terminal one-shot recovery proposal is tracked in
[FFOR #32](https://github.com/coreyphillips/ffor/issues/32). The separate Variant B
tower provisioning authentication issue remains tracked in
[FFOR #18](https://github.com/coreyphillips/ffor/issues/18).

## Specification status

**Draft v0.9.5.** The signed activation/abort/close lifecycle arrived in v0.9;
v0.9.1 added D-R witnesses and issuer provisions; v0.9.2 clarified implementation
errata including witness encryption; v0.9.3 added authenticated witness-fetch paging.
v0.9.4 changes public plaintext Variant D fee acceptance without changing wire
formats. A v0.9.3 settlement peer can reject the lower public fee accepted by
v0.9.4; deployments must confirm support or cover the book fee. v0.9.5 specifies the
optional payer-chosen request interface and tightens issuer reservation/retry rules,
including fresh BOLT 12 responses for path-terminal issuers. Existing wire formats
and voucher amounts stay unchanged. The pinned implementation is not yet qualified
against these new rules. See §17 for the exact compatibility history.

The 2026-09-17 documentation refresh aligns the reference/status descriptions with
Beignet and the existing normative rules. It does not allocate new wire identifiers
or change the protocol version. Feature bits and message numbers remain provisional
pending bLIP assignment. Existing implementation and tests are not a substitute for
independent review or cross-implementation qualification.

## Prior art

ZmnSCPxj's fast forwards, Lloyd Fournier's offline-receive observation, and the async
payments track provide the background. See §2 and §16 for references and differences,
including the distinction between holding a payment until the recipient returns and
completing the payer's payment during the recipient's absence.

## License

MIT.
