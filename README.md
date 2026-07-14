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
   budget) and **evidence-free** (nothing the recipient or a tower ever observes
   distinguishes one payment on a hash from two). No shipping variant's cryptography closes
   it. **PTLCs can close it, but only with an always-online tower plus a change to payers,
   on channels that don't yet exist** (§13.5), so they're a future option for one case, not
   the fix. v0.8 claimed PTLCs were the fix outright; that was wrong.

**But (2) is closed by one line of deployment policy.** A second payer only ever appears if
somebody hands them an invoice signed by the recipient, and the settlement peer cannot forge
that signature. The peer gets those invoices from exactly one optional message,
`ff_invoices`, which it does not otherwise need: it matches payments by hash, not by
invoice. **Don't send it, and the attack is unconstructable.** Distribution then falls to the
recipient itself, or to any party that isn't the peer.

So:

| Who hands out the invoices | Theft vector | Needs a server | Handles unknown payers |
|---|---|---|---|
| The recipient, before going offline | **none** | no | no |
| A tower / mailbox the recipient chooses | **none** | yes | yes |
| **The settlement peer** (`ff_invoices` sent) | **unbounded** | no | yes |

Pick either of the first two and FFOR has no theft vector at all. The honest residual is
that **"no server, arbitrary unknown payers, no theft" is unreachable**. Someone online has
to hand out single-use invoices and remember that they did, and that is a stateful
always-online role by definition. If you're already running a tower to close withholding,
it's the same box, so closing this costs you nothing.

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

**Yes, if you know your payers in advance. No, if you want to receive from anyone.** Those
are two different limits, they come from two different arguments, and v0.8 ran them
together.

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

**§5.1 and §9.5 remove the *mediator*. They do not remove the *distributor*.** Hash reuse is
a separate problem, and it is closed by policy rather than by cryptography: don't let `S`
hold your invoices (§7.3.0). If `R` knows its payers in advance it distributes them itself,
and then FFOR is server-free **and** theft-free. If `R` wants to receive from anyone, some
online party has to hand out single-use invoices, and **no cryptography removes that role**:
PTLCs can move the gate onto that party (§13.5) but cannot delete it, and BOLT 12 and
covenants do not touch it (§13.5, §12.5).

So the design space has two always-online roles, not one, and v0.8 only noticed the first.
The good news is that the second is cheap: it holds no funds and no keys, just an invoice
list and a record of what it has served, and if you're already running a tower it *is* the
tower.

(This is also why v0.9 downgrades the hash-chained voucher construction of §9.5.4 from
RECOMMENDED to OPTIONAL: it only works if `S` serves the invoices, so it is structurally
incompatible with the fix.)

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
