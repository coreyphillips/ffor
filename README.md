# FFOR: Fast-Forward Offline Receive

A draft Lightning Network protocol extension for **non-custodial offline payments**:
the payer's payment fully settles while the recipient is offline, and the recipient's
funds are secured by channel mechanics rather than trust.

Before going offline, the recipient delegates bounded settlement authority to any
direct channel peer. When a payment arrives, that peer settles it upstream instantly
(the payer sees an ordinary completed payment) and simultaneously credits the recipient
via a unilateral, strictly-recipient-favoring commitment update, made safe by the peer
first revoking its own current state. The credit is a long-dated HTLC "voucher" the
recipient claims on return, cooperatively or on-chain.

No consensus changes. No changes to payers or routing nodes. The settlement peer is a
role, not a node class: any implementing peer with balance and uptime can serve.

## Contents

| File | What it is |
|---|---|
| [`ffor-offline-receive.md`](ffor-offline-receive.md) | The spec (draft v0.3): motivation, trust model, wire messages, voucher commitments, tower mediation, escapes, reconciliation, security analysis |
| [`ffor-test-vectors.md`](ffor-test-vectors.md) | Appendix A: canonical `C_i^R` test vectors, computed and independently verified (byte-exact reconstruction, bitcoind-decoded) |
| [`tools/`](tools/) | Reproducible test-vector generator (runs against a beignet checkout) |

## Reference implementation

Prototyped in [beignet](https://github.com/coreyphillips/beignet) on the
[`feat/ffor`](https://github.com/coreyphillips/beignet/tree/feat/ffor) branch.
Milestones M1 (epoch setup, state machine, persistence) and M2 (variant-A settlement,
reestablish, reconciliation) are complete: a payer's payment completes end-to-end while
the recipient is offline, verified in tests at the built-package boundary, with the
spec's test vectors reproduced byte-exactly by the implementation.

## Status

Draft. Wire details reflect what the prototype actually implements; message type and
feature bit numbers are provisional pending bLIP assignment. Remaining prototype
milestones: on-chain enforcement (M3), tower (M4), escapes (M5), liquidity
integration + chaos testing (M6).

## Prior art

ZmnSCPxj's fast forwards, Lloyd Fournier's offline-receive observation, and the async
payments track (BOLT 12 static invoices / trampoline hold). See §2 and §16 of the spec
for how FFOR differs: it is the only point in the design space where the payer-side
payment completes while the recipient is offline.

## License

MIT.
