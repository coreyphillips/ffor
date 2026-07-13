# FFOR: Fast-Forward Offline Receive

A draft Lightning Network protocol extension for offline payments: the payer's payment
**fully settles** while the recipient is offline, which no other design in this space does.

Before going offline, the recipient delegates bounded settlement authority to any
direct channel peer. When a payment arrives, that peer settles it upstream instantly
(the payer sees an ordinary completed payment) and simultaneously credits the recipient
via a unilateral, strictly-recipient-favoring commitment update, made safe by the peer
first revoking its own current state. The credit is a long-dated HTLC "voucher" the
recipient claims on return, cooperatively or on-chain.

No consensus changes. No changes to payers or routing nodes. The settlement peer is a
role, not a node class: any implementing peer with balance and uptime can serve.

## Read this before anything else

**The recipient's existing channel balance is safe.** Every state the settlement peer can
broadcast is either revoked and penalizable or strictly better for the recipient, and the
recipient's `to_remote` is always claimable. The peer cannot take the recipient's money.

**Payments arriving while the recipient is away are not fully safe.** There are two
exposures, and they are different in kind:

1. **Withholding.** The peer settles a payment upstream and never credits the recipient.
   This is *bounded and evidenced*, it is *impossible* in the tower-mediated variant, and
   §12.5 proves that removing it entirely without an always-online party is impossible.
   That is a theorem. The design is allowed to hit it.
2. **Hash reuse (§13.7).** A preimage is a bearer token. Once the peer has it, it can
   redeem the *same* payment hash against as many payers as it can find, crediting the
   recipient once and pocketing the rest. This is **unbounded** (not capped by the epoch
   budget), **evidence-free** (nothing the recipient or a tower ever observes distinguishes
   one payment on a hash from two), and **closed by no variant**: not by the tower, not by
   Variant D. It is an **open problem, not a theorem.**

The only mitigation for (2) today is to keep invoice distribution away from the settlement
peer: the recipient hands out its own invoices, one per payer, before going offline. That
works, and v0.9 fixes the settlement-ordering rule that previously made it unusable. But it
requires the recipient to **know its payers in advance**. An `R` that wants to receive from
an arbitrary unknown payer with no server has no mitigation available today and is trusting
its peer not to reuse a hash. BOLT 12 or PTLC payer-and-amount binding closes this properly;
until then, it bounds what FFOR should be deployed for.

## Contents

| File | What it is |
|---|---|
| [`ffor-offline-receive.md`](ffor-offline-receive.md) | The spec (draft v0.9): motivation, trust model, wire messages, voucher commitments, tower mediation, escapes, reconciliation, security analysis, and the server-free variant |
| [`ffor-test-vectors.md`](ffor-test-vectors.md) | Appendix A: canonical `C_i^R` test vectors, computed and independently verified (byte-exact reconstruction, bitcoind-decoded) |
| [`tools/`](tools/) | Reproducible test-vector generator (runs against a beignet checkout) |

## Reference implementation

Prototyped in [beignet](https://github.com/coreyphillips/beignet) on the
[`feat/ffor`](https://github.com/coreyphillips/beignet/tree/feat/ffor) branch. **All
six prototype milestones are complete** and every gate is validated against live
regtest bitcoind:

- **M1/M2** — epoch setup, variant-A settlement, reconciliation: a payer's payment
  completes end-to-end while the recipient is offline; the spec's test vectors are
  reproduced byte-exactly by the implementation.
- **M3** — on-chain enforcement: recipient force-close with voucher sweeps, and the
  revoked-state justice path.
- **M4** — the Variant B tower: settlement is gated on tower-held preimages; the
  recipient recovers all funds from the tower alone after the settlement peer vanishes.
- **M5** — escapes: the full pre-signed escape lifecycle (broadcast, seed-only voucher
  claim, timeout refund, stale-escape penalty); Appendix B's script and weight tables
  confirmed exact on-chain.
- **M6** — liquidity integration and chaos: bLIP-51 lease-then-epoch, advertised terms,
  splice-on-return, and a 21-case crash matrix covering every protocol arrow.

## Can it be trustless with no server at all?

**For the withholding problem: yes, and the spec says exactly how far. For hash reuse: no,
and that is the honest limit of the result.**

The tower was doing two jobs. **Watching** for a revoked broadcast is removable outright:
open the channel with a `to_self_delay` on `S` longer than the offline window, and `S`'s
only revocable state is locked behind a CSV that outlives `R`'s absence, so `R` penalizes
on return with nobody watching (§5.1). **Mediating** the settlement is removable too, via
**Variant D** (§9.5): commit the whole voucher book at setup in one ordinary channel
update, and `S` sends no message to anyone for the entire epoch. Payments settle by
preimage revelation alone, and because BOLT 2 forces `S` to publish that preimage upstream
to take the money, the payer necessarily ends up holding the key to `R`'s voucher. `R`'s
recourse becomes a 1-of-N availability assumption over `{S, the payers, any mailbox}`
rather than trust in one chosen agent.

Within the withholding problem, what is **not** removable is the last increment: an `S`
that settles and withholds, whose payer is also unreachable, still costs `R` that voucher.
§12.5 proves this is a bound rather than a gap. Fair exchange without a trusted third party
is impossible, `R` is offline by construction so its half of the swap must be pre-played,
and pre-playing it moves the exposure onto `S` instead of eliminating it. Script cannot
force a message to be sent, cannot prove a negative, and cannot force `S` on-chain;
covenants and taproot do not change any of that.

**But §5.1 and §9.5 do not touch §13.7.** Hash reuse is a different problem, it is
unbounded where withholding is bounded, and its only mitigation is to take invoice
distribution away from `S`, which, for an `R` that wants to receive from an *arbitrary,
unknown* payer, means putting an always-online party back in the picture to serve invoices
and enforce single use. **The intersection of "no server" and "receive from anyone" is not
covered by this spec.** It is covered by an `R` that knows its payers in advance, and it
will be covered generally by BOLT 12 / PTLC binding. Do not read the server-free result as
broader than it is.

(This is also why v0.9 downgrades the hash-chained voucher construction of §9.5.4 from
RECOMMENDED to OPTIONAL: it only works if `S` serves the invoices, so it is structurally
incompatible with the one mitigation §13.7 has.)

## Status

Draft. Wire details reflect what the prototype actually implements; message type and
feature bit numbers are provisional pending bLIP assignment. **Variant D, §5.1, and the
v0.9 unordered settlement profile are specified but not yet prototyped** (M8, §15.1).
`ff_init` gained a `settlement_order` byte in v0.9, a breaking layout change against v0.8,
taken while the message numbers are still unassigned.

## Prior art

ZmnSCPxj's fast forwards, Lloyd Fournier's offline-receive observation, and the async
payments track (BOLT 12 static invoices / trampoline hold). See §2 and §16 of the spec
for how FFOR differs: it is the only point in the design space where the payer-side
payment completes while the recipient is offline.

## License

MIT.
