# FFOR Appendix D: Variant D setup transcript and both-view commitment vectors

Deterministic, byte-exact test vectors for the Variant D setup of
[FFOR](ffor-offline-receive.md): the signed `ff_init` / `ff_accept` exchange
(7.1, 7.2), the transcript hashes and the voucher book (7.5.2, 7.5.3), the
`update_add_htlc` messages with their onions and BOTH commitment views after
the voucher round (9.5.1), `H_commit`, the signed `ff_activate` /
`ff_activate_ack` pair and `H_act` (7.5.4), and the force-close claim paths of
voucher 1 from both views. Every message, transaction and signature was built,
signed and verified by running the beignet Lightning library (BOLT 3
commitment builder and signer, BOLT 4 onion construction and processing,
script helpers), not written by hand. All hex is lowercase; all signatures are
deterministic (RFC 6979, low-S), so this file regenerates byte-identically.

Six scenarios share one fixture (D.0). Each scenario is a complete transcript:

| Scenario | K | Funder | Amounts (msat) | `s_htlc_id_base` | R pre-round balance (msat) |
|---|---|---|---|---|---|
| D.1 | 1 | `S` | 1000000 | 0 | 3000000000 |
| D.2 | 3 | `S` | 994000, 546250, 49749000 | 7 | 3000000000 |
| D.3 | 3 | `R` | 994000, 546250, 49749000 | 0 | 3000000000 |
| D.4 | 1 | `S` | 546000 | 0 | 3000000000 |
| D.5 | 483 | `S` | 483 x 546000 | 0 | 3000000000 |
| D.6 | 1 | `S` | 1000000 | 0 | 0 |

Conventions used throughout, where the spec leaves the byte layout to the
implementer (each is also listed in D.8 for the spec author):

- **Signed message body.** `body` in 7's `SHA256("ffor/msg" || type || body_excluding_the_signature)`
  is everything after the 2-byte type: `channel_id`, `epoch_id`, the fixed
  fields, then the TLV stream. The 32-byte digest is signed directly with
  ECDSA (no second hash) and carried as a 64-byte compact `r || s`.
- **TLV stream.** BOLT 1 encoding (BigSize type, BigSize length, value),
  strictly increasing types, no length prefix: the stream runs from the end of
  the fixed fields to the start of the final 64-byte signature. A message with
  no TLVs has an empty stream (`ff_activate`, `ff_activate_ack`).
- **"Wire bytes"** of a message (the input of `T_init` and `T_setup`) are the
  complete message as sent: `[2: type] || body || signature`.
- **Voucher onion.** Single hop to `R`'s node key, associated data =
  `payment_hash = H_k` (BOLT 4), session key seeded as
  `SHA256("ffor/vector/onion-session" || epoch_id || [2: k])` (the spec says
  "fresh random"; a vector must be reproducible).
- **`epoch_id`** is `SHA256("ffor/vector/<scenario>/epoch_id")` and preimage
  `t_k` is `SHA256("ffor/vector/<scenario>/preimage" || [2: k])`; both are
  random in a real run.
- **`channel_id`** is BOLT 2's `funding_txid XOR funding_output_index` over the
  Appendix C funding outpoint.

## D.0 Shared fixture

### Channel

| Parameter | Value |
|---|---|
| channel type | `option_static_remotekey` + `option_anchors_zero_fee_htlc_tx` |
| `channel_type` bits (hex) | `401000` (bits 12, 22) |
| funding outpoint | `8984484a580b825b9972d7adb15050b3ab624ccd731946b3eeddb92f4e7ef6be:0` (BOLT 3 Appendix C) |
| funding txid (internal byte order) | `bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489` |
| `channel_id` | `bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489` |
| funding amount | 10000000 sat |
| pre-round balance `S` | 7000000000 msat (D.1 to D.5); 10000000000 msat (D.6) |
| pre-round balance `R` | 3000000000 msat (D.1 to D.5); 0 msat (D.6) |
| `dust_limit_satoshis` (both sides) | 546 |
| `to_self_delay` (both sides) | 144 |
| `channel_reserve_satoshis` (both sides) | 10000 |
| `max_accepted_htlcs` (both sides; R's binds the vouchers) | 483 |
| `max_htlc_value_in_flight_msat` (both sides) | 5000000000 |
| `htlc_minimum_msat` (both sides) | 1 |
| frozen `feerate_per_kw` | 2500 |

### Epoch parameters common to every scenario (7.1)

| Parameter | Value |
|---|---|
| `variant` | 4 (D) |
| `profile` (book byte, 7.5.3) | 1 (fixed-amount: TLV 9 present) |
| `n_R` / `n0` (commitment numbers before the round) | 42 / 42 |
| `n_R^act` / `n_S^act` (at activation, after the round) | 43 / 43 |
| `T_exp` (`voucher_expiry`, uniform `cltv_expiry`) | 800000 |
| `D` (`settlement_deadline`) | 798992 (= T_exp - 1008) |
| `epoch_start_height` (`ff_activate`) | 790000 |
| `fee_base_msat` | 1000 |
| `fee_proportional_millionths` | 5000 |
| `min_payment_msat` (= voucher dust floor, 546 sat) | 546000 |
| `G` (`escape_granularity_msat`) | 0 (mandatory in Variant D) |
| TLVs 1, 3, 5 in `ff_init` | absent (mandatory in Variant D) |
| nominal fee of the direct on-chain claims (D.x.8) | 200 sat |

### Secrets and seeds

Identical to Appendix A.1 (BOLT 3 Appendix C material reused verbatim;
`R` = Appendix C *local*, `S` = Appendix C *remote*; each side's HTLC basepoint
equals its payment basepoint), plus node keys and sweep keys that Appendix A
does not need.

| Secret | Value | Source |
|---|---|---|
| `R` funding privkey | `30ff4956bbdd3222d44cc5e8a1261dab1e07957bdac5ae88fe3261ef321f3749` | Appendix C `local_funding_privkey` |
| `S` funding privkey | `1552dfba4f6cf29a62a0af13c8d6981d36d0ef8d61ba10fb0fe90da7634d7e13` | Appendix C `remote_funding_privkey` |
| `R` payment+HTLC basepoint secret | `1111111111111111111111111111111111111111111111111111111111111111` | Appendix C `local_payment_basepoint_secret` |
| `R` delayed-payment basepoint secret | `3333333333333333333333333333333333333333333333333333333333333333` | Appendix C `local_delayed_payment_basepoint_secret` |
| `S` payment+HTLC basepoint secret | `4444444444444444444444444444444444444444444444444444444444444444` | Appendix C `remote_payment_basepoint_secret` |
| `S` revocation basepoint secret | `2222222222222222222222222222222222222222222222222222222222222222` | Appendix C `remote_revocation_basepoint_secret` |
| `R` revocation basepoint secret | `22d7c03f8e4e651a458909640a0135370da51690cb898f617507882bf5bea7cf` | `SHA256("ffor/R/revocation-basepoint-secret")` |
| `S` delayed-payment basepoint secret | `878079f5b4c8d9fa978d8979131e45c88098297a7bde9c6f9e6f1b58cd916f73` | `SHA256("ffor/S/delayed-payment-basepoint-secret")` |
| `R` per-commitment seed | `27e3929f8b5e6113cb1ebc2ff34f40804cde35a4950f93cc3301ba9d8ad19dcf` | `SHA256("ffor/R/per-commitment-seed")` |
| `S` per-commitment seed | `f793e351fd16582073b781cba6d84ed97001364a9655235e2e57ecab7414e9fd` | `SHA256("ffor/S/per-commitment-seed")` |
| `R` node privkey (signs `ff_init`, `ff_activate`; decrypts voucher onions) | `cb6efe791d4df7da0ff22d350797306bde98b8470e852f6fe65f243046fc4797` | `SHA256("ffor/R/node-key")` |
| `S` node privkey (signs `ff_accept`, `ff_activate_ack`) | `6e31250bb60671640df7bf80a978181f0d2d45723c57ac3b1a3f6f144fb8fd7b` | `SHA256("ffor/S/node-key")` |
| `R` sweep privkey (P2WPKH destination of R's direct claim) | `c1ffd5458708d157b1c2c0efdd1269e8deb42005fc17b6ce5304521f9b6caa2b` | `SHA256("ffor/R/sweep-key")` |
| `S` sweep privkey (P2WPKH destination of S's direct claim) | `7db520fb39a034c5257c6ff7796c77758917d85986c713101cad87e3bdc6287b` | `SHA256("ffor/S/sweep-key")` |

Per-commitment secrets use the BOLT 3 shachain: the secret for commitment
number `n` is `generate_from_seed(seed, 2^48 - 1 - n)`; the point is `secret * G`.

### Public keys (derived)

| Key | Value |
|---|---|
| `R` node id | `039fca7f8157aa768708894ffd92550fe970edd18526a5f936583ea3b54dab3228` |
| `S` node id | `02087b7d1b4789170f6e374f0a0e58a1b7a899e34929795314ab6964e69609e9c0` |
| `R` funding pubkey | `023da092f6980e58d2c037173180e9a465476026ee50f96695963e8efe436f54eb` |
| `S` funding pubkey | `030e9f7b623d2ccc7c9bd44d66d5ce21ce504c0acf6385a132cec6d3c39fa711c1` |
| `R` payment (= HTLC) basepoint | `034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa` |
| `R` delayed-payment basepoint | `023c72addb4fdf09af94f0c94d7fe92a386a7e70cf8a1d85916386bb2535c7b1b1` |
| `R` revocation basepoint | `038e38ad35420958328d6533fce5a5892fc68c79dfcf07c6ff072200ecec228556` |
| `S` payment (= HTLC) basepoint | `032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991` |
| `S` delayed-payment basepoint | `0294fba20d6360f72e340ac592b96d68b54499138bcb868dcafedf2c7b3510ecae` |
| `S` revocation basepoint | `02466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27` |
| funding witness script | `5221023da092f6980e58d2c037173180e9a465476026ee50f96695963e8efe436f54eb21030e9f7b623d2ccc7c9bd44d66d5ce21ce504c0acf6385a132cec6d3c39fa711c152ae` |
| `R` sweep scriptPubKey | `00142912535a2c1e5ff06a41e0e70341c839d40cfbd3` |
| `S` sweep scriptPubKey | `001414dc9d213971a3b25a3d6ee821b7bb9c5881f93b` |
| `per_commitment_point_R[43]` (R's view, every scenario) | `03dcd6df1422406c9e57514174169f8219e69e77605ee0de483f5c3bac773d6a58` |
| `per_commitment_point_S[43]` (S's view, every scenario) | `03b8e3a5a49272d52e232ce62d0ff46700f79509f62923a3f73244986410abc346` |
| `per_commitment_secret_S[42]` (revealed by the setup `revoke_and_ack`; no `H_k` may equal its hash) | `ab002fc41c2817140d1384ccdfb6e7f4da730edeac39c08375b2b35eb8654b77` |

### Wire layouts

```
ff_init (55001)         [2: 0xd6d9][32: channel_id][32: epoch_id][1: variant][8: budget_msat]
                        [2: max_payments K][8: min_payment_msat][4: settlement_deadline D]
                        [4: voucher_expiry T_exp][4: fee_base_msat][4: fee_proportional_millionths]
                        [8: escape_granularity_msat G][2: 0] (r_per_commitment_points, empty under Variant D)
                        [TLV 9: K*8 voucher_amounts_msat][64: R node-key sig]
ff_accept (55003)       [2: 0xd6db][32: channel_id][32: epoch_id][8: s_commitment_number n0]
                        [TLV 1: K*32 payment_hashes][TLV 7: 8 s_htlc_id_base]
                        [TLV 9: K*8 voucher_amounts_msat][TLV 11: 32 init_hash][64: S node-key sig]
ff_activate (55045)     [2: 0xd705][32: channel_id][32: epoch_id][32: setup_hash][32: book_hash]
                        [32: commit_hash][4: epoch_start_height][TLV stream: empty][64: R node-key sig]
ff_activate_ack (55047) [2: 0xd707][32: channel_id][32: epoch_id][32: activation_hash]
                        [TLV stream: empty][64: S node-key sig]
update_add_htlc (128)   [2: 0x0080][32: channel_id][8: id][8: amount_msat][32: payment_hash]
                        [4: cltv_expiry][1366: onion_routing_packet]

digest(msg) = SHA256("ffor/msg" || [2: type] || body_excluding_signature)
T_init      = SHA256("ffor/tr/init"  || ff_init wire bytes)
T_setup     = SHA256("ffor/tr/setup" || T_init || ff_accept wire bytes)
entry_k     = [2: k][32: H_k][8: d_k][4: T_exp][4: D][8: s_htlc_id_k]
book        = [32: epoch_id][1: variant][1: profile][2: K] || entry_1 || ... || entry_K
H_book      = SHA256("ffor/book" || book)
H_commit    = SHA256("ffor/commit" || [8: n_R^act] || txid(C^R) internal || [8: n_S^act] || txid(C^S) internal)
H_act       = SHA256("ffor/activate" || T_setup || H_book || H_commit || [4: epoch_start_height])
```

## D.1 K = 1, S opener and funder

The minimal transcript: one voucher of 1,000,000 msat on a channel `S`
opened and funds. `s_htlc_id_base = 0`: `S` has never offered an HTLC on
this channel, so its next offered id is 0.

### D.1.1 Parameters

| Parameter | Value |
|---|---|
| funder / opener | `S` |
| `epoch_id` | `fc4bc36f402d396fe452db96030f1563fd554e9c9f9313ef4cdd6299d21dff15` |
| `K` (`max_payments`) | 1 |
| `voucher_amounts_msat` (TLV 9, `d_1..d_1`) | 1000000 |
| `budget_msat` (= sum) | 1000000 |
| `min_payment_msat` | 546000 |
| `T_exp` / `D` | 800000 / 798992 |
| `fee_base_msat` / `fee_proportional_millionths` | 1000 / 5000 |
| `G` / `variant` / `profile` | 0 / 4 / 1 |
| `s_htlc_id_base` (`ff_accept` TLV 7) | 0 |
| `n0` (`ff_accept`) | 42 |
| commitment fee at the frozen rate, 1 outputs (paid by `S`) | 3240 sat (+ 660 sat anchors) |
| pre-round balance `S` / `R` | 7000000000 / 3000000000 msat |
| `S` balance after the round | 6999000000 msat |

Vouchers (`fee_S` and `gross_into_S` per 7.6 are what the payer's HTLC must deliver; they never appear on the channel):

| k | d_k (msat) | output (sat) | fee_S(d_k) | gross_into_S(d_k) | s_htlc_id_k | preimage t_k (S only) | H_k |
|---|---|---|---|---|---|---|---|
| 1 | 1000000 | 1000 | 6000 | 1006000 | 0 | `8ae4a313bd01bcfcce12b797ed20603ed56b0f0b9194e7c000e5cbd6fe376517` | `a0a62adc5092cd3c202aaea0900b5826c242194c5f9984070e833e58b273eda5` |

`r_per_commitment_points` is empty under Variant D (7.1: count 0). `R`'s per-commitment point for commitment number 43, which `S` holds from `R`'s last `revoke_and_ack`, is `03dcd6df1422406c9e57514174169f8219e69e77605ee0de483f5c3bac773d6a58`.

### D.1.2 Setup checks (7.1, 7.2, 7.5.3, 7.6, 8, 9.5.1 bounds)

All checked at `ff_accept` and rechecked at `ff_activate`; every row is a hard assertion in the generator.

| Check | Values | Result |
|---|---|---|
| variant == 4, G == 0, TLVs 1/3/5 absent from ff_init | variant 4, G 0 | pass |
| sum(d_k) == budget_msat | 1000000 msat | pass |
| K <= 483 and K <= R max_accepted_htlcs | K = 1 | pass |
| sum(d_k) <= R max_htlc_value_in_flight_msat | 1000000 <= 5000000000 | pass |
| every d_k >= min_payment_msat | min d_k = 1000000 >= 546000 | pass |
| every d_k >= htlc_minimum_msat | min d_k = 1000000 >= 1 | pass |
| no d_k trims (floor(d_k/1000) >= dust_limit, zero second-level fee under anchors) | min output 1000 sat >= 546 | pass |
| no overflow: d_k * fee_ppm and gross_into_S(d_k) <= 2^64 - 1 | max d_k * ppm = 5000000000 | pass |
| S holds budget + S channel_reserve spendable | 7000000 sat >= 1000 + 10000 | pass |
| funder (S) covers fee(K=1) + anchors at the frozen rate above its reserve | 6999000 - 10000 >= 3240 + 660 | pass |
| funder (S) fee-spike buffer: fee(K=1) at 2 x feerate + anchors above its reserve | 6999000 - 10000 >= 6480 + 660 | pass |
| S post-round balance >= S channel_reserve; R post-round balance >= R channel_reserve only when R funds | S 6995100 sat, R 3000000 sat (S funds: R not applied), reserve 10000 | pass |
| T_exp - D >= claim_margin (1008) | 800000 - 798992 = 1008 | pass |
| s_htlc_id_k = s_htlc_id_base + k - 1 | ids 0 .. 0 | pass |

### D.1.3 `ff_init` and `ff_accept` (7.1, 7.2)

**`ff_init` (type 55001, 185 bytes, signed by `R`)**

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `2d408de65a6391d9399873b07f4d756e882286323bb046911e51dd446b8c965b` |
| signature (final 64 bytes) | `b650a5af1658bafe768dc0d5b07af4556ee5776b010bd4da19cd64aefd40f1a0184923774f95b2d3d9e024283db263075e8ed6f793ba4553b9960e638fd90933` |
| SHA256(wire bytes) | `a714370c47b0851d7c96e218db2673cb7c9eaa8cff435c80bb71efdbe131e62c` |

Wire bytes:

```
d6d9bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489fc4bc36f402d396fe452db96030f1563fd554e9c9f9313ef4cdd6299d21dff150400000000000f4240000100000000000854d0000c3110000c3500000003e80000138800000000000000000000090800000000000f4240b650a5af1658bafe768dc0d5b07af4556ee5776b010bd4da19cd64aefd40f1a0184923774f95b2d3d9e024283db263075e8ed6f793ba4553b9960e638fd90933
```

| Field | Value |
|---|---|
| `T_init` | `343331edc28e500ea03cbce26983583e66fff33dc9f096a3d6924b8239f68eb8` |

**`ff_accept` (type 55003, 226 bytes, signed by `S`)** (TLV 1 hashes, TLV 7 `s_htlc_id_base`, TLV 9 byte-identical to `ff_init`'s, TLV 11 = `T_init`)

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `cbf0df7d79e747c1363d64fbed8c9ba33000eea4a5f1ad666ca90e778ec33e89` |
| signature (final 64 bytes) | `98fbd933af0a181f69b015f155a48608d1295327607d85bdb03a9598b54dc58f6ac01b0421309cebbbaa596e62113de7e6fe2aafaccc281f535eda535525b3ba` |
| SHA256(wire bytes) | `9d532e9b5d95331e0234481ea4db5546b34a4a80a275147dc865c9195beaeea8` |

Wire bytes:

```
d6dbbef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489fc4bc36f402d396fe452db96030f1563fd554e9c9f9313ef4cdd6299d21dff15000000000000002a0120a0a62adc5092cd3c202aaea0900b5826c242194c5f9984070e833e58b273eda507080000000000000000090800000000000f42400b20343331edc28e500ea03cbce26983583e66fff33dc9f096a3d6924b8239f68eb898fbd933af0a181f69b015f155a48608d1295327607d85bdb03a9598b54dc58f6ac01b0421309cebbbaa596e62113de7e6fe2aafaccc281f535eda535525b3ba
```

| Field | Value |
|---|---|
| `T_setup` | `ba34be8afe89e4457543a6e7279f86054f1d6e9038234b786b740e9c905c001f` |

### D.1.4 The voucher book (7.5.3)

`book` is 94 bytes (`36 + 58 K`): `[32: epoch_id][1: 0x04][1: 0x01][2: K]` then one 58-byte entry per slot.

```
fc4bc36f402d396fe452db96030f1563fd554e9c9f9313ef4cdd6299d21dff15040100010001a0a62adc5092cd3c202aaea0900b5826c242194c5f9984070e833e58b273eda500000000000f4240000c3500000c31100000000000000000
```

| Field | Value |
|---|---|
| `H_book` | `8ae276dd460c7b2030287a608677bc51eb9cdef5b7cfc1f73d005e463076510a` |
| SHA256(book) (for cross-checking an encoder without the tag) | `c4fa70a4b0723dadf20d32b5d321a59e977a4af179770f165f92bd2200a4dc88` |

### D.1.5 `update_add_htlc` and the voucher onions (9.5.1 step 3)

`S` sends one stock `update_add_htlc` per slot in `k` order. `R` recognises a
voucher by `(id, amount_msat, payment_hash, cltv_expiry)` matching the book and
parks it; the onion is decodable but never acted on.

| k | id | amount_msat | payment_hash | cltv_expiry | payment_secret (final payload) | onion session key | onion ephemeral pubkey |
|---|---|---|---|---|---|---|---|
| 1 | 0 | 1000000 | `a0a62adc5092cd3c202aaea0900b5826c242194c5f9984070e833e58b273eda5` | 800000 | `8b85975abbc66f6c888e98520b2483c9dd7db4a6bde4365784e31a99f741bf26` | `4315bab9f33eed8ecc8a810d5516c248ab5d6dffc429a7371fd334c692149fe3` | `02344218e0161cb82979280a8b155b93a7c901b409e987d9ca893bd025fb9774a3` |

Voucher 1's complete `update_add_htlc` (1452 bytes; the final 1366 bytes are the onion packet, whose first byte is the version 0x00 and whose next 33 are the ephemeral pubkey above). Final hop payload: `{amt_to_forward = 1000000, outgoing_cltv_value = 800000, payment_data = {payment_secret, total_msat = 1000000}}`, TLV types 2, 4, 8.

```
0080bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489000000000000000000000000000f4240a0a62adc5092cd3c202aaea0900b5826c242194c5f9984070e833e58b273eda5000c35000002344218e0161cb82979280a8b155b93a7c901b409e987d9ca893bd025fb9774a3b525a0e3df021d1ac2607b5a71fd13707d9c9c3c75d57b0b35382ad2727768dd9faca9c6a0a852b38553bd182babaf5812fa040266c5383784bf6cc5fe79fdda0a47fef26e1ad1ae82d25020d32f51859d9510d949008f4161595fd88e8d393ed10f5b345242d91b818b9385ceccbee4afa0d9d0163141a2de86a824aefdd34a2a40613f394837666af59e2da116a7887f86107c5e23ce6001f4ab30c1dbc1b52ce9087fbf9fde48ccec923d7eba58dfe4ef66dce494fd13d25b128bd5a4d96110d88867c8389c8c9ef29ed31255c6d64508377dbd6a8307b2fb2eb0a3465bb2e485577797111da1a17479ed4448f9976d04c8d0a201719db979fc5d70a602804e3cf60a3f274ef3f4a4682bf28eb1965ae5274fadb915e6f95b129eb93bb6d12ab85ac996642ea0353e5bf3d40c8427894c0a43aae83fdfbd1243ef796dab2cc0dcb8bd33a725cb231f41a778d9ba72744708deb81f9025183e72dd2f524954993a66ccdd3ef54b7e6cbf84a05e29741605c11fbc461e012cb44e4d75f3d4faab91860f2c1994d993b42411feeeaefae27880c4e749fcaeb33d9a7d377d19f390c1758d05da1e43112a14e36b9ed47cb9f8fa81109af38b30f8b63d62da037bec9da2bdda8507f2fa8ada1ffebb9e4085d8697c2b6751ab8d9b976b3ff9d29fb37f5c175f63245329890f2965c2e6d730986f3491820c80ce5c6a63c151a3e18d0926478ed99b3b79b770ede0683170012c7e8f6a9a6c0faec95682f525d9b0a4907637dd45769eb8192158adfe2ff7e9edd6ac1935225c087b5644c6241d33bf0faa8a32c56a9c7ce1c91a02508984b34baad40eeda9dfac5295a6ad424d121b6496049bef44cf664921f0a61595ab2c948ba955781d7d15b75f286557e600ca68ff754e90b1293e75dd2f6b8f36fac0d03070e8fc19dff839323071aebd31754b45c6176997cffebe1bba2b1c5ec16af3040eee260dd3d8097dc6c3d960964bd898d2c5b2fb416407fd061bde37052e79b5dbd7bd520d3a67bf7c893d71efcfdf1a65d288bbb87eb2479006ad7cef391d73b6bbe0cca75ecf9f62098261f5b6fe850b7d66564ae7c907b03c6709f0ad23b5fda932ec70e1a6768e7e079857ce98ce7e22e4009646d9d344a1edfcf40061ee6494fff2dba8e118ca2829dbe75ec8f081541fa350ea6378df6bcba0415d6dbacc6c48b438df77554ba3191618565c378d8b7f72695bbbf5ec2ef701305f4e73a05437b3dfb23b0df614139263363b4932f8433cec57f60397447e130c854d4fbf59c77b4dd4cc44b2a7dff8dfe0d12c8ea4ee10c4bb3295c7c033c85b26ce1702ac610ad86c142431f5ce09eaf00cd928474257aa977c14fffe90a44586649899751e7c4f8bcc4c61f2812d46ce0c49e14484f74b414804b61fcbf6b1e0745a2429247bddd791b1d9d8c7ae005574e0b445ea9b1a2c0474a744944b34b5c3ef74c9fc5ab36fa510aa047fbdd3b3543b6f2a2a39bc293564717e7ada2a17725dc8a1cc39d2f54841d439aa6013a5421800593b599092a0f0b8ea2652ed84927bdc590931d94923d713f99a4126a7846377eab415bfd84311f28b6935192d0eff28d7594d1f1d32d7ba6afdf4183203e1d03948dc2518620435faa46f28602f088f975069ffe8d0ff79b9df1bbefbe86904fbb5cc9816641b445d66887b90346648fe36e5b714815302135c64a0afc78f63ad07cbd5823e6c097c518b17f7d6ae42de6d00532cd330e95a14b4babd53b01a3f9f972bdb17a8f2dfdbeae66a6300a8981d3d4ba491d0ab0c9400af5949a7ed397ce02437a667be89b1294fad6c984eb02937013e5ad9257d7709f4d63318c6dac84dcf6212b5aa80a3bb7158b128fc
```

### D.1.6 Both commitment views after the round (9.5.1 steps 4 and 5)

#### D.1.6.1 `R`'s view: commitment 43, 1 received HTLC (S-offered), signed by `S`

| Field | Value |
|---|---|
| commitment number (R) | 43 |
| `per_commitment_point_R[43]` | `03dcd6df1422406c9e57514174169f8219e69e77605ee0de483f5c3bac773d6a58` |
| obscured commitment number | `0xb9c570f08182` |
| commitment fee (paid by `S`) | 3240 sat + 660 sat anchors |
| txid | `9b1569ce47c87fb81d18fa202b010c3205968d947dfee2780d29af8c554762c5` |
| txid (internal byte order, as hashed into `H_commit`) | `c56247558caf290d78e2fe7d948d9605320c012b20fa181db87fc847ce69159b` |
| SHA256(tx bytes) | `dfb0bfc14714674e5460acc62e8b8d202b69f892728d529f704177181b5b7854` |
| revocation pubkey | `026b4fc56f8fe8e877de96e178e7ca33106e876168a18e785f0b6d212a46a5408d` |
| R delayed pubkey (`to_local`) | `02f2ce48e632060212999887dbc79d7b51a6f186ad35d4030df3e827fa2fa741c3` |
| R HTLC pubkey | `034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea` |
| S HTLC pubkey | `02b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b4892` |
| `to_remote` key (static, = S payment basepoint) | `032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991` |

Outputs (BOLT 3 order):

| # | Output | Amount (sat) | scriptPubKey |
|---|---|---|---|
| 0 | anchor (R) | 330 | `00202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f` |
| 1 | anchor (S) | 330 | `0020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994` |
| 2 | voucher_1 (received HTLC, S-offered) | 1000 | `002096ff0fd0d009591a4143b5eba0d8e49bda7268238219ea2899b090a9ac6f51bb` |
| 3 | to_local (R) | 3000000 | `00202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce47` |
| 4 | to_remote (S) | 6995100 | `0020f3394e1e619b0eca1f91be2fb5ab4dfc59ba5b84ebe014ad1d43a564d012994a` |

Transaction (unsigned funding input, as signed by both parties):

```
0200000001bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489000000000070c5b980054a010000000000002200202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f4a01000000000000220020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994e80300000000000022002096ff0fd0d009591a4143b5eba0d8e49bda7268238219ea2899b090a9ac6f51bbc0c62d00000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce479cbc6a0000000000220020f3394e1e619b0eca1f91be2fb5ab4dfc59ba5b84ebe014ad1d43a564d012994a8281f020
```

`S` commitment signature (`commitment_signed.signature`):

- compact: `fc6f3e0643bb13df8e0a2b734c9276d22437b9fe32786b717a73c0cf055f8f7d3f3e4322082efe935e60e52564ec176a7504241db0dafd54bd8f8830b1823394`
- DER + `SIGHASH_ALL`: `3045022100fc6f3e0643bb13df8e0a2b734c9276d22437b9fe32786b717a73c0cf055f8f7d02203f3e4322082efe935e60e52564ec176a7504241db0dafd54bd8f8830b182339401`

`S` HTLC signatures (`commitment_signed.htlc_signature`, 1 sig in BOLT 3 output order, `SIGHASH_SINGLE|ANYONECANPAY` over each voucher's HTLC-success transaction, anchor rules: zero fee, input `nSequence = 1`):

**htlc_signature for voucher 1 (output 2, 1000 sat, position 0 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (received HTLC, `cltv_expiry` 800000) | `76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91481b4d2b51876a3d725df38666837b5189361a59488527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568` |
| HTLC-success tx (unsigned) | `0200000001c56247558caf290d78e2fe7d948d9605320c012b20fa181db87fc847ce69159b02000000000100000001e8030000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4700000000` |
| HTLC-success txid | `66238b9b25511d52bfa1dde69ea48a0dccf6f9859dbd6f1056e3e124d5172bcf` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `a182f60320a6381745a4f8848dd973b89e67e97fc15da20c4c2f43563c52309b` |
| `S` sig (compact) | `f7bd287775c2dd7ca95aba29bcb15a2d627394c9261687ae010d5211229c6d122a8646bb730048ecd1964ba0c985a78a939d9ea51721193ccfa078cb322f88e5` |
| `S` sig (DER + `0x83`) | `3045022100f7bd287775c2dd7ca95aba29bcb15a2d627394c9261687ae010d5211229c6d1202202a8646bb730048ecd1964ba0c985a78a939d9ea51721193ccfa078cb322f88e583` |

#### D.1.6.2 `S`'s view: commitment 43, 1 offered HTLC, signed by `R`

| Field | Value |
|---|---|
| commitment number (S) | 43 |
| `per_commitment_point_S[43]` | `03b8e3a5a49272d52e232ce62d0ff46700f79509f62923a3f73244986410abc346` |
| obscured commitment number | `0xb9c570f08182` |
| commitment fee (paid by `S`) | 3240 sat + 660 sat anchors |
| txid | `b949c3832780e9192e8dc990fe7d24b375dd0f39b775afcba6dd1c3774af3ad2` |
| txid (internal byte order, as hashed into `H_commit`) | `d23aaf74371cdda6cbaf75b7390fdd75b3247dfe90c98d2e19e9802783c349b9` |
| SHA256(tx bytes) | `5d0557abbb25fc74ffbc6002d0412e2c2ed86bab5ac4ab2a6f91bd6f8a207a78` |
| revocation pubkey | `03087846de1985dbf9947be7a2ceafa799eecb09eb5da03744b4ed66eefeca7d16` |
| S delayed pubkey (`to_local`) | `02eb5d86711bb1e6a3bb08d8787e0bb334995bb75172a1599c0dc91436448eaa50` |
| S HTLC pubkey | `02f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c` |
| R HTLC pubkey | `0249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c` |
| `to_remote` key (static, = R payment basepoint) | `034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa` |

Outputs (BOLT 3 order):

| # | Output | Amount (sat) | scriptPubKey |
|---|---|---|---|
| 0 | anchor (R) | 330 | `00202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f` |
| 1 | anchor (S) | 330 | `0020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994` |
| 2 | voucher_1 (offered HTLC) | 1000 | `0020fde971d119e6f42f577ea2127ce99c100628d8cc6ba707ddbd297af84e61649e` |
| 3 | to_remote (R) | 3000000 | `002032e8da66b7054d40832c6a7a66df79d8d7bcccd5ffa53f5dd1772cb9cb9f3283` |
| 4 | to_local (S) | 6995100 | `0020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db686` |

Transaction (unsigned funding input, as signed by both parties):

```
0200000001bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489000000000070c5b980054a010000000000002200202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f4a01000000000000220020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994e803000000000000220020fde971d119e6f42f577ea2127ce99c100628d8cc6ba707ddbd297af84e61649ec0c62d000000000022002032e8da66b7054d40832c6a7a66df79d8d7bcccd5ffa53f5dd1772cb9cb9f32839cbc6a0000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db6868281f020
```

`R` commitment signature (`commitment_signed.signature`):

- compact: `af1acf12557e3adb26d85dd9d22a5875de461214be9c02c1fdc5fcce986b33997e8c8c010cd40982b20e1658893700fce9afb784b396903ee321fc43a8f56823`
- DER + `SIGHASH_ALL`: `3045022100af1acf12557e3adb26d85dd9d22a5875de461214be9c02c1fdc5fcce986b339902207e8c8c010cd40982b20e1658893700fce9afb784b396903ee321fc43a8f5682301`

`R` HTLC signatures (`commitment_signed.htlc_signature`, 1 sig in BOLT 3 output order, `SIGHASH_SINGLE|ANYONECANPAY` over each voucher's HTLC-timeout transaction, anchor rules: zero fee, input `nSequence = 1`, `nLockTime = T_exp`):

**htlc_signature for voucher 1 (output 2, 1000 sat, position 0 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (offered HTLC) | `76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91481b4d2b51876a3d725df38666837b5189361a59488ac6851b27568` |
| HTLC-timeout tx (unsigned) | `0200000001d23aaf74371cdda6cbaf75b7390fdd75b3247dfe90c98d2e19e9802783c349b902000000000100000001e803000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db68600350c00` |
| HTLC-timeout txid | `f880bb8d07433797aff5ac6bf31b6cad56809fc2d9d1dc308a232613b63df7d4` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `f15d85ac777102bc89bc180c69be156716fd81c0e581118c02b693870f4e084f` |
| `R` sig (compact) | `3a4626510473d943fbfac72d7038a903d2f343b1242928904d8dcd0cda6893ee7dfd6588fe52877c6036d72892403ec764bc0de0a495b64da69d2e70e7d322f3` |
| `R` sig (DER + `0x83`) | `304402203a4626510473d943fbfac72d7038a903d2f343b1242928904d8dcd0cda6893ee02207dfd6588fe52877c6036d72892403ec764bc0de0a495b64da69d2e70e7d322f383` |

### D.1.7 `H_commit`, `ff_activate`, `H_act`, `ff_activate_ack` (7.5.2, 7.5.4)

| Field | Value |
|---|---|
| `n_R^act` / `txid(C^R)` internal byte order | 43 / `c56247558caf290d78e2fe7d948d9605320c012b20fa181db87fc847ce69159b` |
| `n_S^act` / `txid(C^S)` internal byte order | 43 / `d23aaf74371cdda6cbaf75b7390fdd75b3247dfe90c98d2e19e9802783c349b9` |
| `H_commit` | `723024696ad20b4758b228284620d18fd30750b7051cc64efca23a1417cf1321` |

**`ff_activate` (type 55045, 230 bytes, signed by `R`)** (`setup_hash = T_setup`, `book_hash = H_book`, `commit_hash = H_commit`, `epoch_start_height = 790000`)

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `678df08e2efce5c2ac54c389dbf8df5e3846ccbd6ca78301e2bf6ac925716ebc` |
| signature (final 64 bytes) | `03aa4c0c160338dfb3783120761fb4a6053836307e196fe3597032f28715b9a021074ec06ceb9c5f06af9854f8b21ff1b6b74ff3ae326a049de8270f2c8dc559` |
| SHA256(wire bytes) | `bfcb0d72e13c21547d6b7c2f83120f82ab669ef5ed4c62c0d9682eb3ae6e964e` |

Wire bytes:

```
d705bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489fc4bc36f402d396fe452db96030f1563fd554e9c9f9313ef4cdd6299d21dff15ba34be8afe89e4457543a6e7279f86054f1d6e9038234b786b740e9c905c001f8ae276dd460c7b2030287a608677bc51eb9cdef5b7cfc1f73d005e463076510a723024696ad20b4758b228284620d18fd30750b7051cc64efca23a1417cf1321000c0df003aa4c0c160338dfb3783120761fb4a6053836307e196fe3597032f28715b9a021074ec06ceb9c5f06af9854f8b21ff1b6b74ff3ae326a049de8270f2c8dc559
```

| Field | Value |
|---|---|
| `H_act` | `580a4a958e8131b32452741e51d724e0f231cb518896c743fa59de236ac6e716` |

**`ff_activate_ack` (type 55047, 162 bytes, signed by `S`)** (`activation_hash = H_act`)

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `dd6442863175cedc8c4c60df18acf0c612308cb3504ad816a4cc1d5d2f78a0c9` |
| signature (final 64 bytes) | `1a20d93b0e00046483cffe0d9b54b0747a351ccaa3971a92aaf9245eb7cde5734f20a6ed584ccd30d81e833d9e89d9d9e42878b541cce5913a647b5ffc1ca9a3` |
| SHA256(wire bytes) | `42bb5550e44f03bb868f446201464fc3632d68faf9e54465e4dfe8811e493515` |

Wire bytes:

```
d707bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489fc4bc36f402d396fe452db96030f1563fd554e9c9f9313ef4cdd6299d21dff15580a4a958e8131b32452741e51d724e0f231cb518896c743fa59de236ac6e7161a20d93b0e00046483cffe0d9b54b0747a351ccaa3971a92aaf9245eb7cde5734f20a6ed584ccd30d81e833d9e89d9d9e42878b541cce5913a647b5ffc1ca9a3
```

### D.1.8 Force-close claim paths for voucher 1 (9.5.1)

#### D.1.8.1 R's view: HTLC-success transaction for voucher 1 (R claims with t_1)

Spends output 2 of R's commitment (1000 sat, received-HTLC script). Zero fee,
`nSequence = 1`, `nLockTime = 0`, single output of the full amount to the CSV-delayed script
(revocation key or R's delayed key after `to_self_delay = 144`). S's signature is the
`htlc_signature` from the setup `commitment_signed` (9.5.3): R needs nothing from S at claim time.

| Field | Value |
|---|---|
| txid | `66238b9b25511d52bfa1dde69ea48a0dccf6f9859dbd6f1056e3e124d5172bcf` |
| sighash type | R: `SIGHASH_ALL` (0x01); S: `SIGHASH_SINGLE|ANYONECANPAY` (0x83), sighash in the R-view table above |
| sighash signed here | `964054b866c92cf5e7dde99601ea5b39b10cdd254fb2bea4e5d7ffa229c2d80b` |
| witness layout | `0 <S htlc sig, DER+0x83> <R htlc sig, DER+0x01> <t_1> <received-HTLC witness script>` |
| R HTLC privkey on this commitment | `29b220f1273050a7c38323ce52e79dc9b44953e6fd8d6f44d39db98bee09644d` |
| R signature (compact) | `0a06a33723b8f08cc4de97f8d2bdddc7703de2f2f63bc2a75a4ab7385223d7267470c86b4901624332e76d0172f44e58a7618f901f0b28c18f8b74f0fab244b3` |
| R signature (DER + 0x01) | `304402200a06a33723b8f08cc4de97f8d2bdddc7703de2f2f63bc2a75a4ab7385223d72602207470c86b4901624332e76d0172f44e58a7618f901f0b28c18f8b74f0fab244b301` |
| S signature (DER + 0x83) | `3045022100f7bd287775c2dd7ca95aba29bcb15a2d627394c9261687ae010d5211229c6d1202202a8646bb730048ecd1964ba0c985a78a939d9ea51721193ccfa078cb322f88e583` |

Unsigned:

```
0200000001c56247558caf290d78e2fe7d948d9605320c012b20fa181db87fc847ce69159b02000000000100000001e8030000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4700000000
```

Witness stack (space-separated; `<>` is the empty element):

```
<> 3045022100f7bd287775c2dd7ca95aba29bcb15a2d627394c9261687ae010d5211229c6d1202202a8646bb730048ecd1964ba0c985a78a939d9ea51721193ccfa078cb322f88e583 304402200a06a33723b8f08cc4de97f8d2bdddc7703de2f2f63bc2a75a4ab7385223d72602207470c86b4901624332e76d0172f44e58a7618f901f0b28c18f8b74f0fab244b301 8ae4a313bd01bcfcce12b797ed20603ed56b0f0b9194e7c000e5cbd6fe376517 76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91481b4d2b51876a3d725df38666837b5189361a59488527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568
```

Fully signed (serialized with witness):

```
02000000000101c56247558caf290d78e2fe7d948d9605320c012b20fa181db87fc847ce69159b02000000000100000001e8030000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce470500483045022100f7bd287775c2dd7ca95aba29bcb15a2d627394c9261687ae010d5211229c6d1202202a8646bb730048ecd1964ba0c985a78a939d9ea51721193ccfa078cb322f88e58347304402200a06a33723b8f08cc4de97f8d2bdddc7703de2f2f63bc2a75a4ab7385223d72602207470c86b4901624332e76d0172f44e58a7618f901f0b28c18f8b74f0fab244b301208ae4a313bd01bcfcce12b797ed20603ed56b0f0b9194e7c000e5cbd6fe3765178e76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91481b4d2b51876a3d725df38666837b5189361a59488527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b2756800000000
```

#### D.1.8.2 R's view: S's direct timeout spend of voucher 1 after T_exp

Spends the same output 2 through the received-HTLC script's timeout branch:
`nLockTime = T_exp`, `nSequence = 1` (the anchor CSV; also what makes CLTV enforceable),
200 sat nominal fee, remainder to S's sweep P2WPKH. No second-level transaction and no
signature from R: this is how S recovers an unclaimed voucher if R never returns (9.5.1).
beignet builder: `buildRemoteHtlcTimeoutClaimTx` + `buildRemoteHtlcTimeoutWitness`.

| Field | Value |
|---|---|
| txid | `f657225470911d50682760a0c0a873f8730f4c8d746cdb02f9506ef7637085a5` |
| sighash type | `SIGHASH_ALL` (0x01) |
| sighash signed here | `a3aeb137e890f6b1059b913905a35fac42cb72b569595f3b8b7c75d5397e8bcd` |
| witness layout | `<S htlc sig, DER+0x01> <> <received-HTLC witness script>` (the empty element fails `OP_SIZE 32 OP_EQUAL`, selecting the timeout branch) |
| S HTLC privkey on this commitment | `3bff71454cc58337552426935ac5a512513695b46bdce52b6874db50d67e30fc` |
| S signature (compact) | `9e7be8ce742cbeab10b7b9afa658b4fdd97a98b3f89cfeae6213f4896206a2b94f0bea0c24860597c59935487118943193c5d8a322f8375c163dd772cf390374` |
| destination (S sweep P2WPKH) | `001414dc9d213971a3b25a3d6ee821b7bb9c5881f93b` |

Unsigned:

```
0200000001c56247558caf290d78e2fe7d948d9605320c012b20fa181db87fc847ce69159b02000000000100000001200300000000000016001414dc9d213971a3b25a3d6ee821b7bb9c5881f93b00350c00
```

Witness stack (space-separated; `<>` is the empty element):

```
30450221009e7be8ce742cbeab10b7b9afa658b4fdd97a98b3f89cfeae6213f4896206a2b902204f0bea0c24860597c59935487118943193c5d8a322f8375c163dd772cf39037401 <> 76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91481b4d2b51876a3d725df38666837b5189361a59488527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568
```

Fully signed (serialized with witness):

```
02000000000101c56247558caf290d78e2fe7d948d9605320c012b20fa181db87fc847ce69159b02000000000100000001200300000000000016001414dc9d213971a3b25a3d6ee821b7bb9c5881f93b034830450221009e7be8ce742cbeab10b7b9afa658b4fdd97a98b3f89cfeae6213f4896206a2b902204f0bea0c24860597c59935487118943193c5d8a322f8375c163dd772cf39037401008e76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91481b4d2b51876a3d725df38666837b5189361a59488527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b2756800350c00
```

#### D.1.8.3 S's view: R's direct preimage claim of voucher 1

Spends output 2 of S's commitment (1000 sat, offered-HTLC script) through the
preimage branch with R's own key and `t_1`: no second-stage signature is needed (9.5.1).
`nSequence = 1` (anchor CSV), `nLockTime = 0`, 200 sat nominal fee, remainder to R's sweep P2WPKH.
beignet builder: `buildRemoteHtlcPreimageClaimTx` + `buildRemoteHtlcPreimageWitness`.

| Field | Value |
|---|---|
| txid | `e294abe1a6733340f33bd41f7eb9180556e5d273225491b1bb9fdae9f1fdd410` |
| sighash type | `SIGHASH_ALL` (0x01) |
| sighash signed here | `f7fce9b45a51d5315137c5039bc33bf13a4ea111ab89599b64219c260cc69a08` |
| witness layout | `<R htlc sig, DER+0x01> <t_1> <offered-HTLC witness script>` |
| R HTLC privkey on this commitment | `50fc1cf359e5cb8cf5cd0cab20c32ef9b97514332ec8672ec30d8bb408d5a1e0` |
| R signature (compact) | `245be7c14143cdd9c94d64f5712d80d602f066d24cb84e4c478d90fede08af6b4793ae8fce63d9419617b4359b20d3baf7767aa5e26deee84c03ff367ed46b51` |
| destination (R sweep P2WPKH) | `00142912535a2c1e5ff06a41e0e70341c839d40cfbd3` |

Unsigned:

```
0200000001d23aaf74371cdda6cbaf75b7390fdd75b3247dfe90c98d2e19e9802783c349b90200000000010000000120030000000000001600142912535a2c1e5ff06a41e0e70341c839d40cfbd300000000
```

Witness stack (space-separated; `<>` is the empty element):

```
30440220245be7c14143cdd9c94d64f5712d80d602f066d24cb84e4c478d90fede08af6b02204793ae8fce63d9419617b4359b20d3baf7767aa5e26deee84c03ff367ed46b5101 8ae4a313bd01bcfcce12b797ed20603ed56b0f0b9194e7c000e5cbd6fe376517 76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91481b4d2b51876a3d725df38666837b5189361a59488ac6851b27568
```

Fully signed (serialized with witness):

```
02000000000101d23aaf74371cdda6cbaf75b7390fdd75b3247dfe90c98d2e19e9802783c349b90200000000010000000120030000000000001600142912535a2c1e5ff06a41e0e70341c839d40cfbd3034730440220245be7c14143cdd9c94d64f5712d80d602f066d24cb84e4c478d90fede08af6b02204793ae8fce63d9419617b4359b20d3baf7767aa5e26deee84c03ff367ed46b5101208ae4a313bd01bcfcce12b797ed20603ed56b0f0b9194e7c000e5cbd6fe3765178876a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91481b4d2b51876a3d725df38666837b5189361a59488ac6851b2756800000000
```

#### D.1.8.4 S's view: HTLC-timeout transaction for voucher 1 (S recovers after T_exp)

Spends output 2 of S's commitment. Zero fee, `nSequence = 1`, `nLockTime = T_exp = 800000`,
single output of the full amount to the CSV-delayed script (revocation key or S's delayed key
after `to_self_delay = 144`). R's signature is the `htlc_signature` R sent in its setup
`commitment_signed` (9.5.1 step 4).

| Field | Value |
|---|---|
| txid | `f880bb8d07433797aff5ac6bf31b6cad56809fc2d9d1dc308a232613b63df7d4` |
| sighash type | S: `SIGHASH_ALL` (0x01); R: `SIGHASH_SINGLE|ANYONECANPAY` (0x83), sighash in the S-view table above |
| sighash signed here | `829f5de9253459c447251a3168b6e70f71f2d77476cf6a083ff4133fc20f9c61` |
| witness layout | `0 <R htlc sig, DER+0x83> <S htlc sig, DER+0x01> <> <offered-HTLC witness script>` |
| S HTLC privkey on this commitment | `fe4bbc9895cc32b31c294b8d763a8637b413f591d4f020982b06e293c8c135b1` |
| S signature (compact) | `eb1c2d8d6d4a796b47d57b89c413f4de201a033ef4abee78cf757ff9dda791554dc3a26f83a75a16eafa83caf4d7a9b154a5122728fcf095cb2bb9c3d9a0c598` |
| S signature (DER + 0x01) | `3045022100eb1c2d8d6d4a796b47d57b89c413f4de201a033ef4abee78cf757ff9dda7915502204dc3a26f83a75a16eafa83caf4d7a9b154a5122728fcf095cb2bb9c3d9a0c59801` |
| R signature (DER + 0x83) | `304402203a4626510473d943fbfac72d7038a903d2f343b1242928904d8dcd0cda6893ee02207dfd6588fe52877c6036d72892403ec764bc0de0a495b64da69d2e70e7d322f383` |

Unsigned:

```
0200000001d23aaf74371cdda6cbaf75b7390fdd75b3247dfe90c98d2e19e9802783c349b902000000000100000001e803000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db68600350c00
```

Witness stack (space-separated; `<>` is the empty element):

```
<> 304402203a4626510473d943fbfac72d7038a903d2f343b1242928904d8dcd0cda6893ee02207dfd6588fe52877c6036d72892403ec764bc0de0a495b64da69d2e70e7d322f383 3045022100eb1c2d8d6d4a796b47d57b89c413f4de201a033ef4abee78cf757ff9dda7915502204dc3a26f83a75a16eafa83caf4d7a9b154a5122728fcf095cb2bb9c3d9a0c59801 <> 76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91481b4d2b51876a3d725df38666837b5189361a59488ac6851b27568
```

Fully signed (serialized with witness):

```
02000000000101d23aaf74371cdda6cbaf75b7390fdd75b3247dfe90c98d2e19e9802783c349b902000000000100000001e803000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db686050047304402203a4626510473d943fbfac72d7038a903d2f343b1242928904d8dcd0cda6893ee02207dfd6588fe52877c6036d72892403ec764bc0de0a495b64da69d2e70e7d322f383483045022100eb1c2d8d6d4a796b47d57b89c413f4de201a033ef4abee78cf757ff9dda7915502204dc3a26f83a75a16eafa83caf4d7a9b154a5122728fcf095cb2bb9c3d9a0c59801008876a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91481b4d2b51876a3d725df38666837b5189361a59488ac6851b2756800350c00
```

## D.2 K = 3, S opener and funder, the Appendix A amounts

The three payee amounts of Appendix A (`994,000`, `546,250`, `49,749,000`
msat) added in ONE voucher round. `R`'s view is therefore its commitment
`n_R + 1 = 43` carrying all three vouchers, whereas Appendix A's `C_3` is
commitment `n_R + 3 = 45` reached by adding them one at a time. The two
commitments have the same output layout (same amounts, same BOLT 3 order:
voucher 2 at 546 sat sorts before voucher 1 at 994 sat, then voucher 3,
then `to_remote`, then `to_local`), the same `to_local`/`to_remote` values
and the same commitment fee, but different per-commitment keys, so every
scriptPubKey, txid and signature differs from Appendix A's `C_3`.
`s_htlc_id_base = 7`: `S` has offered seven HTLCs before this epoch, all
resolved, so voucher `k` gets id `6 + k`.

### D.2.1 Parameters

| Parameter | Value |
|---|---|
| funder / opener | `S` |
| `epoch_id` | `2436d73f6fdf469b68bedbbd9c90aa51871d491fadf862d815853b27f13f62d6` |
| `K` (`max_payments`) | 3 |
| `voucher_amounts_msat` (TLV 9, `d_1..d_3`) | 994000, 546250, 49749000 |
| `budget_msat` (= sum) | 51289250 |
| `min_payment_msat` | 546000 |
| `T_exp` / `D` | 800000 / 798992 |
| `fee_base_msat` / `fee_proportional_millionths` | 1000 / 5000 |
| `G` / `variant` / `profile` | 0 / 4 / 1 |
| `s_htlc_id_base` (`ff_accept` TLV 7) | 7 |
| `n0` (`ff_accept`) | 42 |
| commitment fee at the frozen rate, 3 outputs (paid by `S`) | 4100 sat (+ 660 sat anchors) |
| pre-round balance `S` / `R` | 7000000000 / 3000000000 msat |
| `S` balance after the round | 6948710750 msat |

Vouchers (`fee_S` and `gross_into_S` per 7.6 are what the payer's HTLC must deliver; they never appear on the channel):

| k | d_k (msat) | output (sat) | fee_S(d_k) | gross_into_S(d_k) | s_htlc_id_k | preimage t_k (S only) | H_k |
|---|---|---|---|---|---|---|---|
| 1 | 994000 | 994 | 5970 | 999970 | 7 | `9ac2111ef6621b1e5a5e2045b1811e3fbed11db86124fe4b7d6f0589fe69765e` | `24e4e3ab2a0cbbe957d5dc41c688721d956cf7babe8f304ad24b4589787bd993` |
| 2 | 546250 | 546 | 3731 | 549981 | 8 | `4190c6e6e079c8575ea0a17d450565ec47ea99662b118c34b6608a7105d3b35e` | `a7334c46d83bba22364ed8b863d3052fe24f62b973072776b537aaf707132596` |
| 3 | 49749000 | 49749 | 249745 | 49998745 | 9 | `8f3b529ca4bb18dc2b26ba4b0902f272f6aa9cf95b0e8c1464e54b14054b5f40` | `934cbfbc3fdfea5fc984e1270f06ebb219beb18ee02e8441acafa05ec7d928f6` |

`r_per_commitment_points` is empty under Variant D (7.1: count 0). `R`'s per-commitment point for commitment number 43, which `S` holds from `R`'s last `revoke_and_ack`, is `03dcd6df1422406c9e57514174169f8219e69e77605ee0de483f5c3bac773d6a58`.

### D.2.2 Setup checks (7.1, 7.2, 7.5.3, 7.6, 8, 9.5.1 bounds)

All checked at `ff_accept` and rechecked at `ff_activate`; every row is a hard assertion in the generator.

| Check | Values | Result |
|---|---|---|
| variant == 4, G == 0, TLVs 1/3/5 absent from ff_init | variant 4, G 0 | pass |
| sum(d_k) == budget_msat | 51289250 msat | pass |
| K <= 483 and K <= R max_accepted_htlcs | K = 3 | pass |
| sum(d_k) <= R max_htlc_value_in_flight_msat | 51289250 <= 5000000000 | pass |
| every d_k >= min_payment_msat | min d_k = 546250 >= 546000 | pass |
| every d_k >= htlc_minimum_msat | min d_k = 546250 >= 1 | pass |
| no d_k trims (floor(d_k/1000) >= dust_limit, zero second-level fee under anchors) | min output 546 sat >= 546 | pass |
| no overflow: d_k * fee_ppm and gross_into_S(d_k) <= 2^64 - 1 | max d_k * ppm = 248745000000 | pass |
| S holds budget + S channel_reserve spendable | 7000000 sat >= 51289 + 10000 | pass |
| funder (S) covers fee(K=3) + anchors at the frozen rate above its reserve | 6948710 - 10000 >= 4100 + 660 | pass |
| funder (S) fee-spike buffer: fee(K=3) at 2 x feerate + anchors above its reserve | 6948710 - 10000 >= 8200 + 660 | pass |
| S post-round balance >= S channel_reserve; R post-round balance >= R channel_reserve only when R funds | S 6943950 sat, R 3000000 sat (S funds: R not applied), reserve 10000 | pass |
| T_exp - D >= claim_margin (1008) | 800000 - 798992 = 1008 | pass |
| s_htlc_id_k = s_htlc_id_base + k - 1 | ids 7 .. 9 | pass |

### D.2.3 `ff_init` and `ff_accept` (7.1, 7.2)

**`ff_init` (type 55001, 201 bytes, signed by `R`)**

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `6abcc88cc3f3f11c378582e0a8046a7f06d8bcc00a997a6f8b95072f1ee93d06` |
| signature (final 64 bytes) | `1950e84703f6ab745d5e93ed17fadd4cb4750b1b4bc04b01b18dd4051b0fc58114f5b24aa52b2a1c5c391d98621ce6a37512049c6dac1cbf048f61cb52868547` |
| SHA256(wire bytes) | `b904e7944d94b3336287a3ebdb21222a70322eb227bbc35c3304bef81caa061c` |

Wire bytes:

```
d6d9bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a4884892436d73f6fdf469b68bedbbd9c90aa51871d491fadf862d815853b27f13f62d60400000000030e9ca2000300000000000854d0000c3110000c3500000003e80000138800000000000000000000091800000000000f2ad000000000000855ca0000000002f71c081950e84703f6ab745d5e93ed17fadd4cb4750b1b4bc04b01b18dd4051b0fc58114f5b24aa52b2a1c5c391d98621ce6a37512049c6dac1cbf048f61cb52868547
```

| Field | Value |
|---|---|
| `T_init` | `19644c62830070c3d7ca623b582f274e6e94669d4938e54262a1c6e6e6ed1791` |

**`ff_accept` (type 55003, 306 bytes, signed by `S`)** (TLV 1 hashes, TLV 7 `s_htlc_id_base`, TLV 9 byte-identical to `ff_init`'s, TLV 11 = `T_init`)

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `f2ac3716612bd92c4b6ce785d9f880b102d86050ab90fea367a107056e5bd472` |
| signature (final 64 bytes) | `05ec065a191d90cbb8a6adbeb0d1fd2838be33fa511588e2a3ccb83ce7313a0a1946d43ead676cd1be4a6780b5dd6feb03dc71f0c8d98056ce61304ab243d91b` |
| SHA256(wire bytes) | `25a8b2da07d035a1c61c87b2219b222bac8233f6a2612f495140496a6eaf8ba5` |

Wire bytes:

```
d6dbbef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a4884892436d73f6fdf469b68bedbbd9c90aa51871d491fadf862d815853b27f13f62d6000000000000002a016024e4e3ab2a0cbbe957d5dc41c688721d956cf7babe8f304ad24b4589787bd993a7334c46d83bba22364ed8b863d3052fe24f62b973072776b537aaf707132596934cbfbc3fdfea5fc984e1270f06ebb219beb18ee02e8441acafa05ec7d928f607080000000000000007091800000000000f2ad000000000000855ca0000000002f71c080b2019644c62830070c3d7ca623b582f274e6e94669d4938e54262a1c6e6e6ed179105ec065a191d90cbb8a6adbeb0d1fd2838be33fa511588e2a3ccb83ce7313a0a1946d43ead676cd1be4a6780b5dd6feb03dc71f0c8d98056ce61304ab243d91b
```

| Field | Value |
|---|---|
| `T_setup` | `8465b03bd1ab3001129cd91fffb6e5129460cf82fb396cad2ebbb0ede8916396` |

### D.2.4 The voucher book (7.5.3)

`book` is 210 bytes (`36 + 58 K`): `[32: epoch_id][1: 0x04][1: 0x01][2: K]` then one 58-byte entry per slot.

```
2436d73f6fdf469b68bedbbd9c90aa51871d491fadf862d815853b27f13f62d604010003000124e4e3ab2a0cbbe957d5dc41c688721d956cf7babe8f304ad24b4589787bd99300000000000f2ad0000c3500000c311000000000000000070002a7334c46d83bba22364ed8b863d3052fe24f62b973072776b537aaf70713259600000000000855ca000c3500000c311000000000000000080003934cbfbc3fdfea5fc984e1270f06ebb219beb18ee02e8441acafa05ec7d928f60000000002f71c08000c3500000c31100000000000000009
```

| Field | Value |
|---|---|
| `H_book` | `09e4e3f8cef88225f7401bdcf539cf557932eeb035a265d602afba2083125eec` |
| SHA256(book) (for cross-checking an encoder without the tag) | `1453f12126300fd0e4a9c0c3f35b301c9ffca91d735a28495622499578b5c3bb` |

### D.2.5 `update_add_htlc` and the voucher onions (9.5.1 step 3)

`S` sends one stock `update_add_htlc` per slot in `k` order. `R` recognises a
voucher by `(id, amount_msat, payment_hash, cltv_expiry)` matching the book and
parks it; the onion is decodable but never acted on.

| k | id | amount_msat | payment_hash | cltv_expiry | payment_secret (final payload) | onion session key | onion ephemeral pubkey |
|---|---|---|---|---|---|---|---|
| 1 | 7 | 994000 | `24e4e3ab2a0cbbe957d5dc41c688721d956cf7babe8f304ad24b4589787bd993` | 800000 | `e7d429d7d3d7930dd554f1d8a689465c10342b369ac025f4209c2427c3ffb471` | `de5e5b57133fe0724fac9d8e69bdeffb8286ee6d76676017882d1917dc086840` | `0397b9bafa57a8474cf8e200992008cff7853f83e0ed538465194e7aae5854c2ab` |
| 2 | 8 | 546250 | `a7334c46d83bba22364ed8b863d3052fe24f62b973072776b537aaf707132596` | 800000 | `bc53e3fc00fe36fb5179e2a13c89c4b4bf8494a47fc8ed52c553e37eb0bb2535` | `a2abad2bda815ce3aa1b8000e8f8883a4bec50ec654e378d0d719d667205f14d` | `03794eea76b9951ee7342dfd7d810aa4cfefa586fe3f7ce357629075549ddeab67` |
| 3 | 9 | 49749000 | `934cbfbc3fdfea5fc984e1270f06ebb219beb18ee02e8441acafa05ec7d928f6` | 800000 | `87d056b3b938a3c4c9795e9645b39144c1a5c0667c10e6922d4866487149628c` | `48bc1d811517e1433bef7cd109358680803a00a207f789e330b0ee6e379a5434` | `031b3c46fc3f3c255f4cf5fe7fbf99957e52e0c756c22e0ed5b2d0eca30dfe7609` |

Voucher 1's complete `update_add_htlc` (1452 bytes; the final 1366 bytes are the onion packet, whose first byte is the version 0x00 and whose next 33 are the ephemeral pubkey above). Final hop payload: `{amt_to_forward = 994000, outgoing_cltv_value = 800000, payment_data = {payment_secret, total_msat = 994000}}`, TLV types 2, 4, 8.

```
0080bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489000000000000000700000000000f2ad024e4e3ab2a0cbbe957d5dc41c688721d956cf7babe8f304ad24b4589787bd993000c3500000397b9bafa57a8474cf8e200992008cff7853f83e0ed538465194e7aae5854c2abbafcf3514fff50b27756c2ebbede0dc74fb553f19054349292c16a240595d896389b4891084f90f0eae16a2c1e7550b3394639e4411f0d89445ebcd1d9f073a8b047291ed32579a7d1ec21aa786fbddae5a05486ed059bb7e5902bed48c3060ae3c9655b1fceeb610cb39cd564f898768190391b90887e81cd2aea9245bcd775eacff828383887c9c5944341f193c3c6756ec8034c47052f16dfa13cf5bfafbc5bc99946d0832ee126375dffefe154b4ab7798700a1be71197957936f10be01cd925d9aad169518786851bf86746c6666c9af5fb753c4589a2e99c1d68429e5bde682e37071b76760713e608f14c0bf73eadb8bfe782f7b6ba695f8d0548fd7ee050d057d34afab878830e7e7e501f9493e0c194d9725a1d079a15a1caa5265edc01c1afd33470f06695bbceda2be7e1400c027b0c028f196535e9587d2d8a93b9aa8fac29497014e28e0d53d5214522223466b576cb70b4d9ec50c004e7c7a9836f7c35a9f673ab7749533f46dfed52d2e088ee900cdfaab063e6cf76672a8b880576c374f0e9cbfa2728f12d0d801eb6acd468a563eee4ce8381c30890e7ac01a73703efcfe0f6bba9fe4c669ce484aa8c49cfc60f2a0fd6311da3c0b768a879657a8dd37616755903e2f67e7eb5e877e2f843b2544e21b9330995db2306a53687c60f9c5ff0487c2985d6134ebfc3a19b46fe65ccf3dcc68e460160c681f2dc984964b959db1cb823c00b44141efb3fa3683bc14587e51b603bd34727d1d08cfcecfb8fea0e4d00fa66e13e2e6b0659cee26edd95418f40405134fe0e00b9be73990c3faebf4f9a916eeb1bafa04688c97e19154c26bcac4636843f57a1b71aeaecc92c71f4818b051ef236f7cfa3197cc20f9372101a2ff615314df0d1687bd16f55cd544e54cea4f970a340acbbe5f7b1c1546a2bb70a6c2eb09504b675b94e3fb7e107bde08d93387b1614729c82f476dfcf382dc54f13aa46b91c497a54606e8a95cf3a66e3cb98ba4ade42f8a0ffd1c4cb7fc5167d824d64dc39f33865ecb54df7e5a21654e9974bf9d390b4e077bedafa61158093ee46d5b1f3e6461cc9aa1f0bf9a0bea0d0971ff8f82568709ca3b0c66e44574d725b5463670ff51e38151d312a6856a74d74962a039bc2b51e326f97562c94756b06424d789eb567db057f6abed8ff15f0ac82ed902d91f31f1cbc55618952caf6b3ab2420ae425242bfc1bc8b68eff78f2d7daf0d88be4b193eeb48c059618d9abc96b1bc82a62c4c1f96790b78b100fc47acb8255518d6477c44cd1a21571b8559da001efab83643cb9c5f18685b898b2858bf043177958de984a9f0e227610c772199fc5f398ff1cf972da1edda0e2cc7c969d3106cb0658af79db987dc45741788606f65a011d961771e6509894cd1eebe11e470c66020afe92b8853dde55cdd4f266fb797dd774ec0578b76b900955041594c5de69e2e744c21ee980d2cb85e0d5ccf12c05fabf14f336b1bfe27d6b996fd14549e8c39bd0a0882733a8036dfadac668cd17a90f240a0ed9defc2c63d6a1fd06db21426ea6eb4528e72e5426bd16040676b57610a315f6d28aa1613699e64a3f5b656764509c99955fe7f00ce9ee00e1626aa136f4ee86d86ca9241526570b910cb295641d66a2486a4454643bf233ecb301efb0dcc5efd3b3c77bc2bab142a7736aaf90e5228f93c0da19c3f732a06235774565a93917359d91cbc58f97a965fe64d6c2c977c80e2b7f577789a147aa93ccf3fb9598dbdee8fe8e02f45d8be3c2130519670da1fdf4d8020eb45439cb5f44acee17b1d927361c4373fe8158e34c225c5cd7fb74a9e880f8f6400958577fa60e0e0986438b408b7fa66bdcac7339e999ede7e
```

### D.2.6 Both commitment views after the round (9.5.1 steps 4 and 5)

#### D.2.6.1 `R`'s view: commitment 43, 3 received HTLCs (S-offered), signed by `S`

| Field | Value |
|---|---|
| commitment number (R) | 43 |
| `per_commitment_point_R[43]` | `03dcd6df1422406c9e57514174169f8219e69e77605ee0de483f5c3bac773d6a58` |
| obscured commitment number | `0xb9c570f08182` |
| commitment fee (paid by `S`) | 4100 sat + 660 sat anchors |
| txid | `830b3222b80d7f02972038d2331c5b87eee008537e326d420011c3a350f5c92c` |
| txid (internal byte order, as hashed into `H_commit`) | `2cc9f550a3c31100426d327e5308e0ee875b1c33d2382097027f0db822320b83` |
| SHA256(tx bytes) | `6ebd66d176ba64f0a82f522a08d55ff6e1ff87add5a4272bb68aef20b01ec2af` |
| revocation pubkey | `026b4fc56f8fe8e877de96e178e7ca33106e876168a18e785f0b6d212a46a5408d` |
| R delayed pubkey (`to_local`) | `02f2ce48e632060212999887dbc79d7b51a6f186ad35d4030df3e827fa2fa741c3` |
| R HTLC pubkey | `034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea` |
| S HTLC pubkey | `02b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b4892` |
| `to_remote` key (static, = S payment basepoint) | `032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991` |

Outputs (BOLT 3 order):

| # | Output | Amount (sat) | scriptPubKey |
|---|---|---|---|
| 0 | anchor (R) | 330 | `00202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f` |
| 1 | anchor (S) | 330 | `0020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994` |
| 2 | voucher_2 (received HTLC, S-offered) | 546 | `0020f08f3a46a4316fac4d3bc29bec147a3d0ce11a06b3f5e529d2d92589becdc7e2` |
| 3 | voucher_1 (received HTLC, S-offered) | 994 | `002045d69aeb8417e384877bc9f90feba5a7c0cf5f8c3f95eae1715110fd087e4a9d` |
| 4 | voucher_3 (received HTLC, S-offered) | 49749 | `002016bffa5fa9dce06611406d2d6a1f036af8c2ab54fb91195e496ae1014778f439` |
| 5 | to_local (R) | 3000000 | `00202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce47` |
| 6 | to_remote (S) | 6943950 | `0020f3394e1e619b0eca1f91be2fb5ab4dfc59ba5b84ebe014ad1d43a564d012994a` |

Transaction (unsigned funding input, as signed by both parties):

```
0200000001bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489000000000070c5b980074a010000000000002200202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f4a01000000000000220020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb39942202000000000000220020f08f3a46a4316fac4d3bc29bec147a3d0ce11a06b3f5e529d2d92589becdc7e2e20300000000000022002045d69aeb8417e384877bc9f90feba5a7c0cf5f8c3f95eae1715110fd087e4a9d55c200000000000022002016bffa5fa9dce06611406d2d6a1f036af8c2ab54fb91195e496ae1014778f439c0c62d00000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce47cef4690000000000220020f3394e1e619b0eca1f91be2fb5ab4dfc59ba5b84ebe014ad1d43a564d012994a8281f020
```

`S` commitment signature (`commitment_signed.signature`):

- compact: `92c278e36c901e20bf49bf1cb47c7edd3bfad7782a74f793eb005631211396801053673903571b61b39b3af5770202724434c5ed7aa360c7111d43a26623dc20`
- DER + `SIGHASH_ALL`: `304502210092c278e36c901e20bf49bf1cb47c7edd3bfad7782a74f793eb0056312113968002201053673903571b61b39b3af5770202724434c5ed7aa360c7111d43a26623dc2001`

`S` HTLC signatures (`commitment_signed.htlc_signature`, 3 sigs in BOLT 3 output order, `SIGHASH_SINGLE|ANYONECANPAY` over each voucher's HTLC-success transaction, anchor rules: zero fee, input `nSequence = 1`):

**htlc_signature for voucher 2 (output 2, 546 sat, position 0 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (received HTLC, `cltv_expiry` 800000) | `76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91452409008b97c6ef1ec3fc79fb133194b138a9a2588527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568` |
| HTLC-success tx (unsigned) | `02000000012cc9f550a3c31100426d327e5308e0ee875b1c33d2382097027f0db822320b830200000000010000000122020000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4700000000` |
| HTLC-success txid | `3c0c1edea1ca57af381f2321fcb137fa3622d6e806a361d0a399a939e7862f92` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `4ac1e8aeb23d9a6ab9c593798b59e528d25d9a50ab1c084fe5ef1da59c1bd707` |
| `S` sig (compact) | `bb125d75fd9475f6f33a232250079b01ac2a97d7c306c44fc1a6ed14a1156b8e5fe725672d029f88b5bf87b6e22f7e4cfaed8194b2776a2d951701aa778eee07` |
| `S` sig (DER + `0x83`) | `3045022100bb125d75fd9475f6f33a232250079b01ac2a97d7c306c44fc1a6ed14a1156b8e02205fe725672d029f88b5bf87b6e22f7e4cfaed8194b2776a2d951701aa778eee0783` |

**htlc_signature for voucher 1 (output 3, 994 sat, position 1 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (received HTLC, `cltv_expiry` 800000) | `76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91416c9b574b67c5019ba26ebf48e8132f59a08ffa288527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568` |
| HTLC-success tx (unsigned) | `02000000012cc9f550a3c31100426d327e5308e0ee875b1c33d2382097027f0db822320b8303000000000100000001e2030000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4700000000` |
| HTLC-success txid | `b427cf8aab50b88662636b2c2d285038f474b23a4c0b677f7d398469ddfab3b8` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `b2182f6c381829fb7604e370b3092b76aecb98dcf87cb097b9ed176ba1950901` |
| `S` sig (compact) | `543a94aa7b24311c204539b89bfd8c04625acd5dc0d2c06d33502d42801e4ed05858224553145a82d02b18cc068ccd1766686666c85a744322a5cbd1f2de1095` |
| `S` sig (DER + `0x83`) | `30440220543a94aa7b24311c204539b89bfd8c04625acd5dc0d2c06d33502d42801e4ed002205858224553145a82d02b18cc068ccd1766686666c85a744322a5cbd1f2de109583` |

**htlc_signature for voucher 3 (output 4, 49749 sat, position 2 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (received HTLC, `cltv_expiry` 800000) | `76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a9145630752c93e9e7d0c445cede1640524be41f915e88527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568` |
| HTLC-success tx (unsigned) | `02000000012cc9f550a3c31100426d327e5308e0ee875b1c33d2382097027f0db822320b830400000000010000000155c20000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4700000000` |
| HTLC-success txid | `2f8a8a407ea885b6a999605cb08d17f825c58a279effafd82c47c06657dae1f1` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `775c4945e96ae56dc271d5de1671fab2ba62edff0b051e81b032183fee318468` |
| `S` sig (compact) | `be6e3a4807e125d49bee4ddc7261991ff83824d5d65ee63d2a1b9a94fa95e2ff477009a82e9cd3499795766673873549654b8f93660f64ba467a7e67a50df1ba` |
| `S` sig (DER + `0x83`) | `3045022100be6e3a4807e125d49bee4ddc7261991ff83824d5d65ee63d2a1b9a94fa95e2ff0220477009a82e9cd3499795766673873549654b8f93660f64ba467a7e67a50df1ba83` |

#### D.2.6.2 `S`'s view: commitment 43, 3 offered HTLCs, signed by `R`

| Field | Value |
|---|---|
| commitment number (S) | 43 |
| `per_commitment_point_S[43]` | `03b8e3a5a49272d52e232ce62d0ff46700f79509f62923a3f73244986410abc346` |
| obscured commitment number | `0xb9c570f08182` |
| commitment fee (paid by `S`) | 4100 sat + 660 sat anchors |
| txid | `2c2e551bbbc00e9f19953e95c65b6d2d11a11b16f3e4cddde43f7af93433e769` |
| txid (internal byte order, as hashed into `H_commit`) | `69e73334f97a3fe4ddcde4f3161ba1112d6d5bc6953e95199f0ec0bb1b552e2c` |
| SHA256(tx bytes) | `0efa8d80037ee884deabc339976e7767359b1456e5afa1f5ea8c58eaafc86014` |
| revocation pubkey | `03087846de1985dbf9947be7a2ceafa799eecb09eb5da03744b4ed66eefeca7d16` |
| S delayed pubkey (`to_local`) | `02eb5d86711bb1e6a3bb08d8787e0bb334995bb75172a1599c0dc91436448eaa50` |
| S HTLC pubkey | `02f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c` |
| R HTLC pubkey | `0249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c` |
| `to_remote` key (static, = R payment basepoint) | `034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa` |

Outputs (BOLT 3 order):

| # | Output | Amount (sat) | scriptPubKey |
|---|---|---|---|
| 0 | anchor (R) | 330 | `00202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f` |
| 1 | anchor (S) | 330 | `0020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994` |
| 2 | voucher_2 (offered HTLC) | 546 | `0020c14c6d0514f5fc7f9de66ebda35229cb3520ad01a82ee830afd45cb9a42f2a72` |
| 3 | voucher_1 (offered HTLC) | 994 | `0020d13bcbca77befec558009fcd924f874e3812b231496cc2e5b70150f7a7f5740f` |
| 4 | voucher_3 (offered HTLC) | 49749 | `0020559950358ba1c2098546ed849fd74355bd9373ffbbebada38a667e959c9af0b4` |
| 5 | to_remote (R) | 3000000 | `002032e8da66b7054d40832c6a7a66df79d8d7bcccd5ffa53f5dd1772cb9cb9f3283` |
| 6 | to_local (S) | 6943950 | `0020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db686` |

Transaction (unsigned funding input, as signed by both parties):

```
0200000001bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489000000000070c5b980074a010000000000002200202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f4a01000000000000220020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb39942202000000000000220020c14c6d0514f5fc7f9de66ebda35229cb3520ad01a82ee830afd45cb9a42f2a72e203000000000000220020d13bcbca77befec558009fcd924f874e3812b231496cc2e5b70150f7a7f5740f55c2000000000000220020559950358ba1c2098546ed849fd74355bd9373ffbbebada38a667e959c9af0b4c0c62d000000000022002032e8da66b7054d40832c6a7a66df79d8d7bcccd5ffa53f5dd1772cb9cb9f3283cef4690000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db6868281f020
```

`R` commitment signature (`commitment_signed.signature`):

- compact: `275cfb1344cd85ff0d0e6bbafc44f611c1723f2e35944ed58fd4bebe41b1f66d01fa9c47a071fcd480f77742d7a1cd0f158fd5d19ec3ef28c4673d540e2611de`
- DER + `SIGHASH_ALL`: `30440220275cfb1344cd85ff0d0e6bbafc44f611c1723f2e35944ed58fd4bebe41b1f66d022001fa9c47a071fcd480f77742d7a1cd0f158fd5d19ec3ef28c4673d540e2611de01`

`R` HTLC signatures (`commitment_signed.htlc_signature`, 3 sigs in BOLT 3 output order, `SIGHASH_SINGLE|ANYONECANPAY` over each voucher's HTLC-timeout transaction, anchor rules: zero fee, input `nSequence = 1`, `nLockTime = T_exp`):

**htlc_signature for voucher 2 (output 2, 546 sat, position 0 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (offered HTLC) | `76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91452409008b97c6ef1ec3fc79fb133194b138a9a2588ac6851b27568` |
| HTLC-timeout tx (unsigned) | `020000000169e73334f97a3fe4ddcde4f3161ba1112d6d5bc6953e95199f0ec0bb1b552e2c020000000001000000012202000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db68600350c00` |
| HTLC-timeout txid | `f7ad964d313f19ea666df0cbf69692a7012f6a4a9541caf267a6a4d12abe5423` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `8daa7601cb8d48e0b1d88c41520a410180455e44a7ed4baf4547ea769e5a7733` |
| `R` sig (compact) | `294a7c7550c6646ec572c0bcf852e797a78e206585ad67d1ce366a38e8749d1978b01b45f68f07ea3224dd9b422a504644cf367eb3585531bcfdadac5bf62373` |
| `R` sig (DER + `0x83`) | `30440220294a7c7550c6646ec572c0bcf852e797a78e206585ad67d1ce366a38e8749d19022078b01b45f68f07ea3224dd9b422a504644cf367eb3585531bcfdadac5bf6237383` |

**htlc_signature for voucher 1 (output 3, 994 sat, position 1 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (offered HTLC) | `76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91416c9b574b67c5019ba26ebf48e8132f59a08ffa288ac6851b27568` |
| HTLC-timeout tx (unsigned) | `020000000169e73334f97a3fe4ddcde4f3161ba1112d6d5bc6953e95199f0ec0bb1b552e2c03000000000100000001e203000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db68600350c00` |
| HTLC-timeout txid | `6dcba63e9412c9e884c686278efe2f114ed2d730810369003cdddc99da7e3c55` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `6ba21dbacf3bea96f7db84bff8da66a50c58c0c2160ad5cab3c059ca46f6cfb6` |
| `R` sig (compact) | `1b316d92d0ac3bbb7534abdfda785e99c6d2f09a72f49d5cd20a83eebab055de0394e4aa234194b607ee16e25bcfda08d9d5a75f88cb60d18bb58b6dee72e113` |
| `R` sig (DER + `0x83`) | `304402201b316d92d0ac3bbb7534abdfda785e99c6d2f09a72f49d5cd20a83eebab055de02200394e4aa234194b607ee16e25bcfda08d9d5a75f88cb60d18bb58b6dee72e11383` |

**htlc_signature for voucher 3 (output 4, 49749 sat, position 2 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (offered HTLC) | `76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a9145630752c93e9e7d0c445cede1640524be41f915e88ac6851b27568` |
| HTLC-timeout tx (unsigned) | `020000000169e73334f97a3fe4ddcde4f3161ba1112d6d5bc6953e95199f0ec0bb1b552e2c0400000000010000000155c2000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db68600350c00` |
| HTLC-timeout txid | `50250f9eaad0fdaaa9cd993fc0de764e9ad98d931e2f618940159f8b4b216a94` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `e7e6abc51e06200b93b5d802bf32427b278dd089ad1a97b8fb4e336e1f5eaf5b` |
| `R` sig (compact) | `bf9f017d2501cba9662d72714bc1f4144f1ca3f3594e80c71c17617467694da673888b61d694aeada34953d5b85ebd01a4bf2745a236b33f46f4a4b36f2170e1` |
| `R` sig (DER + `0x83`) | `3045022100bf9f017d2501cba9662d72714bc1f4144f1ca3f3594e80c71c17617467694da6022073888b61d694aeada34953d5b85ebd01a4bf2745a236b33f46f4a4b36f2170e183` |

### D.2.7 `H_commit`, `ff_activate`, `H_act`, `ff_activate_ack` (7.5.2, 7.5.4)

| Field | Value |
|---|---|
| `n_R^act` / `txid(C^R)` internal byte order | 43 / `2cc9f550a3c31100426d327e5308e0ee875b1c33d2382097027f0db822320b83` |
| `n_S^act` / `txid(C^S)` internal byte order | 43 / `69e73334f97a3fe4ddcde4f3161ba1112d6d5bc6953e95199f0ec0bb1b552e2c` |
| `H_commit` | `e7e996cb809a52736589d78d22b1a7c2a76b2ba07a8ac1f957aabc2651b0b9c5` |

**`ff_activate` (type 55045, 230 bytes, signed by `R`)** (`setup_hash = T_setup`, `book_hash = H_book`, `commit_hash = H_commit`, `epoch_start_height = 790000`)

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `38afd698ca151e18cc146a39d0084180c9146afeaa304a49837b4835ac286b4a` |
| signature (final 64 bytes) | `1b5ca88c942d833703ab7702576abcbe1694524b37ef6b762f61358c9e2c31710cd2d600c69ef3a810d29a4b25705759de647e7b666909f0baec2a7af766eca4` |
| SHA256(wire bytes) | `fac9ff2295db3814988ee47a572ee8ffea11ce185e22cf81addb304f2e4d7029` |

Wire bytes:

```
d705bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a4884892436d73f6fdf469b68bedbbd9c90aa51871d491fadf862d815853b27f13f62d68465b03bd1ab3001129cd91fffb6e5129460cf82fb396cad2ebbb0ede891639609e4e3f8cef88225f7401bdcf539cf557932eeb035a265d602afba2083125eece7e996cb809a52736589d78d22b1a7c2a76b2ba07a8ac1f957aabc2651b0b9c5000c0df01b5ca88c942d833703ab7702576abcbe1694524b37ef6b762f61358c9e2c31710cd2d600c69ef3a810d29a4b25705759de647e7b666909f0baec2a7af766eca4
```

| Field | Value |
|---|---|
| `H_act` | `1d561fb397d1ac599cf6876a4f390d6bd81de4cd425b30383b14a5de4b4b61d4` |

**`ff_activate_ack` (type 55047, 162 bytes, signed by `S`)** (`activation_hash = H_act`)

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `6950e7ecb0246810f3fac656340871f2dc934e2710ece02477d1234184a22e70` |
| signature (final 64 bytes) | `0e976c39f969145764a509691cd84aafedaddd873be2e3b35fbb42b55d43087b79aadcd67eb097ea539931314d7b8aee65758147094f78cd43736c0e496d2e66` |
| SHA256(wire bytes) | `bcde669e38e05cb563ae9d043e6b4f3e5b7796605e958f3cb9928e63cb0feba6` |

Wire bytes:

```
d707bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a4884892436d73f6fdf469b68bedbbd9c90aa51871d491fadf862d815853b27f13f62d61d561fb397d1ac599cf6876a4f390d6bd81de4cd425b30383b14a5de4b4b61d40e976c39f969145764a509691cd84aafedaddd873be2e3b35fbb42b55d43087b79aadcd67eb097ea539931314d7b8aee65758147094f78cd43736c0e496d2e66
```

### D.2.8 Force-close claim paths for voucher 1 (9.5.1)

#### D.2.8.1 R's view: HTLC-success transaction for voucher 1 (R claims with t_1)

Spends output 3 of R's commitment (994 sat, received-HTLC script). Zero fee,
`nSequence = 1`, `nLockTime = 0`, single output of the full amount to the CSV-delayed script
(revocation key or R's delayed key after `to_self_delay = 144`). S's signature is the
`htlc_signature` from the setup `commitment_signed` (9.5.3): R needs nothing from S at claim time.

| Field | Value |
|---|---|
| txid | `b427cf8aab50b88662636b2c2d285038f474b23a4c0b677f7d398469ddfab3b8` |
| sighash type | R: `SIGHASH_ALL` (0x01); S: `SIGHASH_SINGLE|ANYONECANPAY` (0x83), sighash in the R-view table above |
| sighash signed here | `3c48316008834509b8b2122765e02c34816502f3bdb09ca04c2b7442f60831a6` |
| witness layout | `0 <S htlc sig, DER+0x83> <R htlc sig, DER+0x01> <t_1> <received-HTLC witness script>` |
| R HTLC privkey on this commitment | `29b220f1273050a7c38323ce52e79dc9b44953e6fd8d6f44d39db98bee09644d` |
| R signature (compact) | `5e6d0e092eb5f337a4139de4dd6cacc4464a0eaca573be87bc5efbcb63fc837b079fb952ef989fcdd73a514aa318f589b388f4a6064011b2db28d30fdcc63c41` |
| R signature (DER + 0x01) | `304402205e6d0e092eb5f337a4139de4dd6cacc4464a0eaca573be87bc5efbcb63fc837b0220079fb952ef989fcdd73a514aa318f589b388f4a6064011b2db28d30fdcc63c4101` |
| S signature (DER + 0x83) | `30440220543a94aa7b24311c204539b89bfd8c04625acd5dc0d2c06d33502d42801e4ed002205858224553145a82d02b18cc068ccd1766686666c85a744322a5cbd1f2de109583` |

Unsigned:

```
02000000012cc9f550a3c31100426d327e5308e0ee875b1c33d2382097027f0db822320b8303000000000100000001e2030000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4700000000
```

Witness stack (space-separated; `<>` is the empty element):

```
<> 30440220543a94aa7b24311c204539b89bfd8c04625acd5dc0d2c06d33502d42801e4ed002205858224553145a82d02b18cc068ccd1766686666c85a744322a5cbd1f2de109583 304402205e6d0e092eb5f337a4139de4dd6cacc4464a0eaca573be87bc5efbcb63fc837b0220079fb952ef989fcdd73a514aa318f589b388f4a6064011b2db28d30fdcc63c4101 9ac2111ef6621b1e5a5e2045b1811e3fbed11db86124fe4b7d6f0589fe69765e 76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91416c9b574b67c5019ba26ebf48e8132f59a08ffa288527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568
```

Fully signed (serialized with witness):

```
020000000001012cc9f550a3c31100426d327e5308e0ee875b1c33d2382097027f0db822320b8303000000000100000001e2030000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4705004730440220543a94aa7b24311c204539b89bfd8c04625acd5dc0d2c06d33502d42801e4ed002205858224553145a82d02b18cc068ccd1766686666c85a744322a5cbd1f2de10958347304402205e6d0e092eb5f337a4139de4dd6cacc4464a0eaca573be87bc5efbcb63fc837b0220079fb952ef989fcdd73a514aa318f589b388f4a6064011b2db28d30fdcc63c4101209ac2111ef6621b1e5a5e2045b1811e3fbed11db86124fe4b7d6f0589fe69765e8e76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91416c9b574b67c5019ba26ebf48e8132f59a08ffa288527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b2756800000000
```

#### D.2.8.2 R's view: S's direct timeout spend of voucher 1 after T_exp

Spends the same output 3 through the received-HTLC script's timeout branch:
`nLockTime = T_exp`, `nSequence = 1` (the anchor CSV; also what makes CLTV enforceable),
200 sat nominal fee, remainder to S's sweep P2WPKH. No second-level transaction and no
signature from R: this is how S recovers an unclaimed voucher if R never returns (9.5.1).
beignet builder: `buildRemoteHtlcTimeoutClaimTx` + `buildRemoteHtlcTimeoutWitness`.

| Field | Value |
|---|---|
| txid | `52c3a950747e54526125e02041098c8e9c126c0066f4ddbe9d3deabbd4092761` |
| sighash type | `SIGHASH_ALL` (0x01) |
| sighash signed here | `5a6d811e2e5df705bbf8994441dcf77aea4e13991bc97dcd2c56c088dca65e40` |
| witness layout | `<S htlc sig, DER+0x01> <> <received-HTLC witness script>` (the empty element fails `OP_SIZE 32 OP_EQUAL`, selecting the timeout branch) |
| S HTLC privkey on this commitment | `3bff71454cc58337552426935ac5a512513695b46bdce52b6874db50d67e30fc` |
| S signature (compact) | `193410e1a232bf9f4a511b154695380f5c4dd8fd317fec45259f532f9108b1e75a0521d783a8a44b7a48230b30ee680fb375e08a0f836732e5bd8359d8189e34` |
| destination (S sweep P2WPKH) | `001414dc9d213971a3b25a3d6ee821b7bb9c5881f93b` |

Unsigned:

```
02000000012cc9f550a3c31100426d327e5308e0ee875b1c33d2382097027f0db822320b83030000000001000000011a0300000000000016001414dc9d213971a3b25a3d6ee821b7bb9c5881f93b00350c00
```

Witness stack (space-separated; `<>` is the empty element):

```
30440220193410e1a232bf9f4a511b154695380f5c4dd8fd317fec45259f532f9108b1e702205a0521d783a8a44b7a48230b30ee680fb375e08a0f836732e5bd8359d8189e3401 <> 76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91416c9b574b67c5019ba26ebf48e8132f59a08ffa288527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568
```

Fully signed (serialized with witness):

```
020000000001012cc9f550a3c31100426d327e5308e0ee875b1c33d2382097027f0db822320b83030000000001000000011a0300000000000016001414dc9d213971a3b25a3d6ee821b7bb9c5881f93b034730440220193410e1a232bf9f4a511b154695380f5c4dd8fd317fec45259f532f9108b1e702205a0521d783a8a44b7a48230b30ee680fb375e08a0f836732e5bd8359d8189e3401008e76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91416c9b574b67c5019ba26ebf48e8132f59a08ffa288527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b2756800350c00
```

#### D.2.8.3 S's view: R's direct preimage claim of voucher 1

Spends output 3 of S's commitment (994 sat, offered-HTLC script) through the
preimage branch with R's own key and `t_1`: no second-stage signature is needed (9.5.1).
`nSequence = 1` (anchor CSV), `nLockTime = 0`, 200 sat nominal fee, remainder to R's sweep P2WPKH.
beignet builder: `buildRemoteHtlcPreimageClaimTx` + `buildRemoteHtlcPreimageWitness`.

| Field | Value |
|---|---|
| txid | `9eaddf57daad702363f3ddc8f758885f78a231cec16e69545dfa613d636c7003` |
| sighash type | `SIGHASH_ALL` (0x01) |
| sighash signed here | `ad12af0ab2aa975a515772dc4abbcb18e74d84d89f515771c3eb0bc30266b8dd` |
| witness layout | `<R htlc sig, DER+0x01> <t_1> <offered-HTLC witness script>` |
| R HTLC privkey on this commitment | `50fc1cf359e5cb8cf5cd0cab20c32ef9b97514332ec8672ec30d8bb408d5a1e0` |
| R signature (compact) | `9afbd77ff47f3e3880213b418b4e79be187dd764927b0988c6bb9d2817bce1f0713e6d399ad0a2e013a08b2f1cf40560bb1f884153be4f099b5739c6393a5f43` |
| destination (R sweep P2WPKH) | `00142912535a2c1e5ff06a41e0e70341c839d40cfbd3` |

Unsigned:

```
020000000169e73334f97a3fe4ddcde4f3161ba1112d6d5bc6953e95199f0ec0bb1b552e2c030000000001000000011a030000000000001600142912535a2c1e5ff06a41e0e70341c839d40cfbd300000000
```

Witness stack (space-separated; `<>` is the empty element):

```
30450221009afbd77ff47f3e3880213b418b4e79be187dd764927b0988c6bb9d2817bce1f00220713e6d399ad0a2e013a08b2f1cf40560bb1f884153be4f099b5739c6393a5f4301 9ac2111ef6621b1e5a5e2045b1811e3fbed11db86124fe4b7d6f0589fe69765e 76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91416c9b574b67c5019ba26ebf48e8132f59a08ffa288ac6851b27568
```

Fully signed (serialized with witness):

```
0200000000010169e73334f97a3fe4ddcde4f3161ba1112d6d5bc6953e95199f0ec0bb1b552e2c030000000001000000011a030000000000001600142912535a2c1e5ff06a41e0e70341c839d40cfbd3034830450221009afbd77ff47f3e3880213b418b4e79be187dd764927b0988c6bb9d2817bce1f00220713e6d399ad0a2e013a08b2f1cf40560bb1f884153be4f099b5739c6393a5f4301209ac2111ef6621b1e5a5e2045b1811e3fbed11db86124fe4b7d6f0589fe69765e8876a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91416c9b574b67c5019ba26ebf48e8132f59a08ffa288ac6851b2756800000000
```

#### D.2.8.4 S's view: HTLC-timeout transaction for voucher 1 (S recovers after T_exp)

Spends output 3 of S's commitment. Zero fee, `nSequence = 1`, `nLockTime = T_exp = 800000`,
single output of the full amount to the CSV-delayed script (revocation key or S's delayed key
after `to_self_delay = 144`). R's signature is the `htlc_signature` R sent in its setup
`commitment_signed` (9.5.1 step 4).

| Field | Value |
|---|---|
| txid | `6dcba63e9412c9e884c686278efe2f114ed2d730810369003cdddc99da7e3c55` |
| sighash type | S: `SIGHASH_ALL` (0x01); R: `SIGHASH_SINGLE|ANYONECANPAY` (0x83), sighash in the S-view table above |
| sighash signed here | `f65d634cb9cb6d528620b32d4c3d362791376e1c2b552eb347afa99881f5ed70` |
| witness layout | `0 <R htlc sig, DER+0x83> <S htlc sig, DER+0x01> <> <offered-HTLC witness script>` |
| S HTLC privkey on this commitment | `fe4bbc9895cc32b31c294b8d763a8637b413f591d4f020982b06e293c8c135b1` |
| S signature (compact) | `361b26ef773b849a6c613551ccdb5126c6d0bfdeac635c2f1247a546b271f2f07acaed3e427354cc1d8b40fea2c03adaa627772ddfb628d8e150fe17e9596567` |
| S signature (DER + 0x01) | `30440220361b26ef773b849a6c613551ccdb5126c6d0bfdeac635c2f1247a546b271f2f002207acaed3e427354cc1d8b40fea2c03adaa627772ddfb628d8e150fe17e959656701` |
| R signature (DER + 0x83) | `304402201b316d92d0ac3bbb7534abdfda785e99c6d2f09a72f49d5cd20a83eebab055de02200394e4aa234194b607ee16e25bcfda08d9d5a75f88cb60d18bb58b6dee72e11383` |

Unsigned:

```
020000000169e73334f97a3fe4ddcde4f3161ba1112d6d5bc6953e95199f0ec0bb1b552e2c03000000000100000001e203000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db68600350c00
```

Witness stack (space-separated; `<>` is the empty element):

```
<> 304402201b316d92d0ac3bbb7534abdfda785e99c6d2f09a72f49d5cd20a83eebab055de02200394e4aa234194b607ee16e25bcfda08d9d5a75f88cb60d18bb58b6dee72e11383 30440220361b26ef773b849a6c613551ccdb5126c6d0bfdeac635c2f1247a546b271f2f002207acaed3e427354cc1d8b40fea2c03adaa627772ddfb628d8e150fe17e959656701 <> 76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91416c9b574b67c5019ba26ebf48e8132f59a08ffa288ac6851b27568
```

Fully signed (serialized with witness):

```
0200000000010169e73334f97a3fe4ddcde4f3161ba1112d6d5bc6953e95199f0ec0bb1b552e2c03000000000100000001e203000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db686050047304402201b316d92d0ac3bbb7534abdfda785e99c6d2f09a72f49d5cd20a83eebab055de02200394e4aa234194b607ee16e25bcfda08d9d5a75f88cb60d18bb58b6dee72e113834730440220361b26ef773b849a6c613551ccdb5126c6d0bfdeac635c2f1247a546b271f2f002207acaed3e427354cc1d8b40fea2c03adaa627772ddfb628d8e150fe17e959656701008876a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91416c9b574b67c5019ba26ebf48e8132f59a08ffa288ac6851b2756800350c00
```

## D.3 K = 3, R opener and funder, S acceptor

The same three amounts and the same balances as D.2 (`S` 7,000,000 sat,
`R` 3,000,000 sat), but `R` opened and funds the channel. BOLT 3 charges
the commitment fee and both anchors to the funder, so here they come out of
`R`'s `to_local` on `R`'s view and `R`'s `to_remote` on `S`'s view, the
obscured commitment number uses `R`'s payment basepoint as the opener's,
and the 7.6 funder obligations (reserve, fee at the frozen rate for K
outputs, fee-spike buffer at twice the rate, anchors) are checked against
`R`. Diff this section against D.2 to see exactly what moves.

### D.3.1 Parameters

| Parameter | Value |
|---|---|
| funder / opener | `R` |
| `epoch_id` | `8685960c118c83535c1bcc47e33666a775e26e9d1ca6cbca79aade33f9fe3ecb` |
| `K` (`max_payments`) | 3 |
| `voucher_amounts_msat` (TLV 9, `d_1..d_3`) | 994000, 546250, 49749000 |
| `budget_msat` (= sum) | 51289250 |
| `min_payment_msat` | 546000 |
| `T_exp` / `D` | 800000 / 798992 |
| `fee_base_msat` / `fee_proportional_millionths` | 1000 / 5000 |
| `G` / `variant` / `profile` | 0 / 4 / 1 |
| `s_htlc_id_base` (`ff_accept` TLV 7) | 0 |
| `n0` (`ff_accept`) | 42 |
| commitment fee at the frozen rate, 3 outputs (paid by `R`) | 4100 sat (+ 660 sat anchors) |
| pre-round balance `S` / `R` | 7000000000 / 3000000000 msat |
| `S` balance after the round | 6948710750 msat |

Vouchers (`fee_S` and `gross_into_S` per 7.6 are what the payer's HTLC must deliver; they never appear on the channel):

| k | d_k (msat) | output (sat) | fee_S(d_k) | gross_into_S(d_k) | s_htlc_id_k | preimage t_k (S only) | H_k |
|---|---|---|---|---|---|---|---|
| 1 | 994000 | 994 | 5970 | 999970 | 0 | `ad7d3f3daebc0ed34454033f88de67df1e2281c3d3d66edaa8aa379725d5457d` | `21f2705152e9753f5d63b5a0bdbb1d3cd0da4d56d83e3d3853cd44c12dfe6f84` |
| 2 | 546250 | 546 | 3731 | 549981 | 1 | `2436f5dbf9f9b2cf2681dd99f89640d158c3aa94ea880c97a95bc4d103155442` | `58bdb1620d8f37d85a846d3f80a4e43ca084cbe1743d043d429de8dcfb0843c0` |
| 3 | 49749000 | 49749 | 249745 | 49998745 | 2 | `09bda50251c61692cc3a1c32155c03bc415ed08d6ca22aca8e837986931b5acf` | `dfe77b118b59852036e38b7409770e502899c35e8aced4a5d405ebecc167d0ea` |

`r_per_commitment_points` is empty under Variant D (7.1: count 0). `R`'s per-commitment point for commitment number 43, which `S` holds from `R`'s last `revoke_and_ack`, is `03dcd6df1422406c9e57514174169f8219e69e77605ee0de483f5c3bac773d6a58`.

### D.3.2 Setup checks (7.1, 7.2, 7.5.3, 7.6, 8, 9.5.1 bounds)

All checked at `ff_accept` and rechecked at `ff_activate`; every row is a hard assertion in the generator.

| Check | Values | Result |
|---|---|---|
| variant == 4, G == 0, TLVs 1/3/5 absent from ff_init | variant 4, G 0 | pass |
| sum(d_k) == budget_msat | 51289250 msat | pass |
| K <= 483 and K <= R max_accepted_htlcs | K = 3 | pass |
| sum(d_k) <= R max_htlc_value_in_flight_msat | 51289250 <= 5000000000 | pass |
| every d_k >= min_payment_msat | min d_k = 546250 >= 546000 | pass |
| every d_k >= htlc_minimum_msat | min d_k = 546250 >= 1 | pass |
| no d_k trims (floor(d_k/1000) >= dust_limit, zero second-level fee under anchors) | min output 546 sat >= 546 | pass |
| no overflow: d_k * fee_ppm and gross_into_S(d_k) <= 2^64 - 1 | max d_k * ppm = 248745000000 | pass |
| S holds budget + S channel_reserve spendable | 7000000 sat >= 51289 + 10000 | pass |
| funder (R) covers fee(K=3) + anchors at the frozen rate above its reserve | 3000000 - 10000 >= 4100 + 660 | pass |
| funder (R) fee-spike buffer: fee(K=3) at 2 x feerate + anchors above its reserve | 3000000 - 10000 >= 8200 + 660 | pass |
| S post-round balance >= S channel_reserve; R post-round balance >= R channel_reserve only when R funds | S 6948710 sat, R 2995240 sat (R funds: checked), reserve 10000 | pass |
| T_exp - D >= claim_margin (1008) | 800000 - 798992 = 1008 | pass |
| s_htlc_id_k = s_htlc_id_base + k - 1 | ids 0 .. 2 | pass |

### D.3.3 `ff_init` and `ff_accept` (7.1, 7.2)

**`ff_init` (type 55001, 201 bytes, signed by `R`)**

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `2393e483b58212363a3a12f6a6858f3761c11e5c3d6b5504c5a308fd286a7c71` |
| signature (final 64 bytes) | `b1ab264efb4d47b962fe9f5aeb72b5c1d67e5f0cd7709835f07a6bd58450fa9a048758571653c17a8c91eacd8750cbc7efe0bd648caca5c1861ed14ccad2c885` |
| SHA256(wire bytes) | `a582ea67e64b6c52fc505c6fa356fcde75773c34424519258e36c8ceb9cf9100` |

Wire bytes:

```
d6d9bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a4884898685960c118c83535c1bcc47e33666a775e26e9d1ca6cbca79aade33f9fe3ecb0400000000030e9ca2000300000000000854d0000c3110000c3500000003e80000138800000000000000000000091800000000000f2ad000000000000855ca0000000002f71c08b1ab264efb4d47b962fe9f5aeb72b5c1d67e5f0cd7709835f07a6bd58450fa9a048758571653c17a8c91eacd8750cbc7efe0bd648caca5c1861ed14ccad2c885
```

| Field | Value |
|---|---|
| `T_init` | `196ce823fe02a2daea0a6a544f05f7b1c51520c0c323836663b31af3318a9cf0` |

**`ff_accept` (type 55003, 306 bytes, signed by `S`)** (TLV 1 hashes, TLV 7 `s_htlc_id_base`, TLV 9 byte-identical to `ff_init`'s, TLV 11 = `T_init`)

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `16b4727916a9bfc351fb0e373d22f68f9ee8aedc7fe5406909c628682885b9e9` |
| signature (final 64 bytes) | `25b2bb680e71adfd82af8c7ff8a10a871775112ca01901a0dc56895b5e1217567c4f5dada7a4da2f3e4211d7faf6db8664f59d1062d31b31ba83d4233462b07d` |
| SHA256(wire bytes) | `c53ba231be91339dcc271b289bf7f8627fcb4512a867decb4c1a38fce23772da` |

Wire bytes:

```
d6dbbef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a4884898685960c118c83535c1bcc47e33666a775e26e9d1ca6cbca79aade33f9fe3ecb000000000000002a016021f2705152e9753f5d63b5a0bdbb1d3cd0da4d56d83e3d3853cd44c12dfe6f8458bdb1620d8f37d85a846d3f80a4e43ca084cbe1743d043d429de8dcfb0843c0dfe77b118b59852036e38b7409770e502899c35e8aced4a5d405ebecc167d0ea07080000000000000000091800000000000f2ad000000000000855ca0000000002f71c080b20196ce823fe02a2daea0a6a544f05f7b1c51520c0c323836663b31af3318a9cf025b2bb680e71adfd82af8c7ff8a10a871775112ca01901a0dc56895b5e1217567c4f5dada7a4da2f3e4211d7faf6db8664f59d1062d31b31ba83d4233462b07d
```

| Field | Value |
|---|---|
| `T_setup` | `43bce577aa29c966a8c9a8bc614a9edfc4994f8ee4954414bc635cb6dcd745ff` |

### D.3.4 The voucher book (7.5.3)

`book` is 210 bytes (`36 + 58 K`): `[32: epoch_id][1: 0x04][1: 0x01][2: K]` then one 58-byte entry per slot.

```
8685960c118c83535c1bcc47e33666a775e26e9d1ca6cbca79aade33f9fe3ecb04010003000121f2705152e9753f5d63b5a0bdbb1d3cd0da4d56d83e3d3853cd44c12dfe6f8400000000000f2ad0000c3500000c31100000000000000000000258bdb1620d8f37d85a846d3f80a4e43ca084cbe1743d043d429de8dcfb0843c000000000000855ca000c3500000c311000000000000000010003dfe77b118b59852036e38b7409770e502899c35e8aced4a5d405ebecc167d0ea0000000002f71c08000c3500000c31100000000000000002
```

| Field | Value |
|---|---|
| `H_book` | `5bb093a59800241c8f94a2ab083fadadda85a5d08e81b046e0dcf4623310819b` |
| SHA256(book) (for cross-checking an encoder without the tag) | `71214c58424da6f6286982cc7184355d61b9b89145f41ca07f6b30098d0d514f` |

### D.3.5 `update_add_htlc` and the voucher onions (9.5.1 step 3)

`S` sends one stock `update_add_htlc` per slot in `k` order. `R` recognises a
voucher by `(id, amount_msat, payment_hash, cltv_expiry)` matching the book and
parks it; the onion is decodable but never acted on.

| k | id | amount_msat | payment_hash | cltv_expiry | payment_secret (final payload) | onion session key | onion ephemeral pubkey |
|---|---|---|---|---|---|---|---|
| 1 | 0 | 994000 | `21f2705152e9753f5d63b5a0bdbb1d3cd0da4d56d83e3d3853cd44c12dfe6f84` | 800000 | `d66567c2dff330edf9bb92e5730713a4ca0f8ca39de63c97c24f71d092f9e93f` | `bef2abfd858b76d54efc63ab51792378ddb8a175456e777a1ac2e818bfb7ae01` | `0219da29b122f833b91660359273b4abda8d4c526b000a93814caac8b60d84dc27` |
| 2 | 1 | 546250 | `58bdb1620d8f37d85a846d3f80a4e43ca084cbe1743d043d429de8dcfb0843c0` | 800000 | `f6a8c3abd32c25024f473f405879ef3409cbf818184bd93daf2f50c057d325e1` | `5c2e65bbe883f3f4f589a28ce30127340cff13d1dfdc7c624ead7d3897aad53f` | `031b12ce19b79e362d73b2d90089d6a46cd20a5ca1dfc6792f7f97b073b248fe1d` |
| 3 | 2 | 49749000 | `dfe77b118b59852036e38b7409770e502899c35e8aced4a5d405ebecc167d0ea` | 800000 | `4a877de8770b25f1da43106831f4ecbf8ca3788e17067f9926be0d440b73c9bb` | `c07121377bb891ac1bf2ce18ca3c41950e4b16042b475e120bffa09e501a475d` | `02bc169c2af2e4d8a711b0d87684ec6040d7823f12a2a4c2c056168c034149d0a2` |

Voucher 1's complete `update_add_htlc` (1452 bytes; the final 1366 bytes are the onion packet, whose first byte is the version 0x00 and whose next 33 are the ephemeral pubkey above). Final hop payload: `{amt_to_forward = 994000, outgoing_cltv_value = 800000, payment_data = {payment_secret, total_msat = 994000}}`, TLV types 2, 4, 8.

```
0080bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489000000000000000000000000000f2ad021f2705152e9753f5d63b5a0bdbb1d3cd0da4d56d83e3d3853cd44c12dfe6f84000c3500000219da29b122f833b91660359273b4abda8d4c526b000a93814caac8b60d84dc276ecc63a39d252e06a9799d50b79efdfa5809869e4547a95a1fda69a60e3767765adb146372402c5958f4e33f436054cf80c16a89053f601c381cd94064a4ddda154b6bf3c588e70fcf500956a97224f8a4be9a15f48943e03c28a7cd4b8a42fb38b8461b3fa17721a51a561b5915fb20f43c822cdf2d69884d2d0e47176fed9b5f48b31e67d80ace44c7b957a8c40782dddbdee3d07fbed8f7a0782ca64b0f92fdc31e0aab780adae299ce351d3e932e497831adb4a4daeb3ef76d4732306a346bc41e97f559b6e2f4a194060a6b4dd439079dbc92360efb37beff0ac9acaf899fa778c61f36428828b2ef3e59b186fcd6d8f602c96697bb45b3048f2f038e8b07beb182c5aaa717f2309aef9d1a8e214cb17bae215acaef617409c7524b579ca5460026730988934f772d65016508c5a743ea83252dd859a927b4a081d63caf8893fcd16db84fdbd5195529dae84a632b6e99e84009931de7ad3c3c83c9764888f28261c7dab25f8bea0333d2bd39f642a901964209bc0e94f80bdecb46aad85a2c1bfba89d6f59803ad9b88bdb60f35c386eb5799f5ae45f7eaa034bf72df1e840cd36ca148bce3c7ddbf34a59fd90670618f0ce59b81d9ec94ef36bb560a7e99a9e1266abde4fa3f84a05e66d23746109d6e889486ca0b8311afea185e9efa2383906ac01ab13a288f9c2446953b9066fa2b48ddde06289be3422effef4522c3e07d2a22a92e8f5adc2e6a2bfd89e9b867ccf167516755fca73b6e138d1d23225401bc075990daa720fe396cab0d81bd7a31f7e807ff4ba1ca6c72d14dfbbb8db96f92075fb1d904c350e7805dd8c970249525099156a6fd8c6ef25295e7528ba3403cc71a3f1a085472f6f3e739ebcd6cb693c9b2164c05c3012d6c586fc0b1c4ce3b6c96f67f6209355db7b0b73067db51d6aa67c1630011ab3b9e544d0220ad6720d0df1c939da2c90429f8eaa2034fca7135fd5afda59ff54899f638e2962668b7009a02d7dba42d4458820bd753ea5876924b25130702f894930edc1ca3779ca1871fae57e9e7e1f4560e8d0c3d49cf40218c7e663ca597dd66c6803d76b307858fc4c1dde975675f0c5de537f994e695e04593631fda7413639a587410b4059716949766f084c9370a57970373fed504578291314703682223693dd53a6844c0114f4a90e36df9690c5696e635c269d44d2ddb4c2558a01bc89dbd0b788d7a1703ebd59322064827970fde7d516f03073b9fafdfe2d308c644502f12b0e34f5ea6f65ab5eab66a6c6b48127f7ac01ae776c7891ebd8266340fa52724de73e61ff4944c0374f181f2f91ec21940d78fc5e8e7142a2c2418392f375b3bc8a815f8eb59db3b916577ec5f678ba09febf268f4c7ff991889c34707da4f28703c9c7c702d2903e33962e39778704dec35dd1e9028ea7bd75875ff17a5c0efb3606c74b3b376b7348e30a38222a30f41c5c1d060450f2169540ca98d588c68534c006ec9739a0075f26277ec9f2af3e41bddf26e9efae4cf7ba3865657ab6c2856a76c4f631edade566b114904badd69b0b69599919d70b9a1e32bff36111c33a2ffce63ea0cab32277a17b010bd036c32ce3e11f380ed7c41f622f1c10a449a61b2bd76e47bbca795908bdaed997c1cbaf4072a92502ca11c178a383d445c4376bfd6ce42e516cfb88c9356d4f80525a3392211fb345a04d65f2e41fd94f6577ae22cd33138b4b58be038fde98334aa1297fac5b45e2ae93117ef3c56c57bfd34b81f544d7f9b4147caf71802b408e2efd7d44c82fb05e59a2d7031a1ab142f0f41528445bb3f6f0ff646d76847354f39661768fd73b5eac7cdf1faf06f477706b89bb2bc70569364ca577f103e3e6689afb
```

### D.3.6 Both commitment views after the round (9.5.1 steps 4 and 5)

#### D.3.6.1 `R`'s view: commitment 43, 3 received HTLCs (S-offered), signed by `S`

| Field | Value |
|---|---|
| commitment number (R) | 43 |
| `per_commitment_point_R[43]` | `03dcd6df1422406c9e57514174169f8219e69e77605ee0de483f5c3bac773d6a58` |
| obscured commitment number | `0x2bb03852193f` |
| commitment fee (paid by `R`) | 4100 sat + 660 sat anchors |
| txid | `c66874ea4e49a0d2a27a592fc340bbeb4a68c4a806611be609a981b0b1e351a3` |
| txid (internal byte order, as hashed into `H_commit`) | `a351e3b1b081a909e61b6106a8c4684aebbb40c32f597aa2d2a0494eea7468c6` |
| SHA256(tx bytes) | `0d66b36a99cce7a858532fb92b4c240ecb6891a6af0d6bb03557111b9cc4148f` |
| revocation pubkey | `026b4fc56f8fe8e877de96e178e7ca33106e876168a18e785f0b6d212a46a5408d` |
| R delayed pubkey (`to_local`) | `02f2ce48e632060212999887dbc79d7b51a6f186ad35d4030df3e827fa2fa741c3` |
| R HTLC pubkey | `034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea` |
| S HTLC pubkey | `02b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b4892` |
| `to_remote` key (static, = S payment basepoint) | `032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991` |

Outputs (BOLT 3 order):

| # | Output | Amount (sat) | scriptPubKey |
|---|---|---|---|
| 0 | anchor (R) | 330 | `00202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f` |
| 1 | anchor (S) | 330 | `0020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994` |
| 2 | voucher_2 (received HTLC, S-offered) | 546 | `0020289aed0abf096b100c2a46fe1cfa4aaf02174c0ea450ec66612a3bc8cbf52ec5` |
| 3 | voucher_1 (received HTLC, S-offered) | 994 | `00205ffbef672006169d8088ba331066d18fcd7beec67ae79fb4cbe49d3150e2d1eb` |
| 4 | voucher_3 (received HTLC, S-offered) | 49749 | `0020597ca4e403e40d0ae2c9115f026d20f318c7171ced4e48aa6df8ede373972530` |
| 5 | to_local (R) | 2995240 | `00202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce47` |
| 6 | to_remote (S) | 6948710 | `0020f3394e1e619b0eca1f91be2fb5ab4dfc59ba5b84ebe014ad1d43a564d012994a` |

Transaction (unsigned funding input, as signed by both parties):

```
0200000001bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489000000000038b02b80074a010000000000002200202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f4a01000000000000220020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb39942202000000000000220020289aed0abf096b100c2a46fe1cfa4aaf02174c0ea450ec66612a3bc8cbf52ec5e2030000000000002200205ffbef672006169d8088ba331066d18fcd7beec67ae79fb4cbe49d3150e2d1eb55c2000000000000220020597ca4e403e40d0ae2c9115f026d20f318c7171ced4e48aa6df8ede37397253028b42d00000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4766076a0000000000220020f3394e1e619b0eca1f91be2fb5ab4dfc59ba5b84ebe014ad1d43a564d012994a3f195220
```

`S` commitment signature (`commitment_signed.signature`):

- compact: `b57ef954b02973379279ff14c16999fd3914199dfd058be0bef2850a26de895e2361355c3f7ca067c613c62c78200e6200d26e3b174d824ba2e9840bd9a98c26`
- DER + `SIGHASH_ALL`: `3045022100b57ef954b02973379279ff14c16999fd3914199dfd058be0bef2850a26de895e02202361355c3f7ca067c613c62c78200e6200d26e3b174d824ba2e9840bd9a98c2601`

`S` HTLC signatures (`commitment_signed.htlc_signature`, 3 sigs in BOLT 3 output order, `SIGHASH_SINGLE|ANYONECANPAY` over each voucher's HTLC-success transaction, anchor rules: zero fee, input `nSequence = 1`):

**htlc_signature for voucher 2 (output 2, 546 sat, position 0 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (received HTLC, `cltv_expiry` 800000) | `76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a914043ef49514426f6df6a379480f75b25671cabf2688527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568` |
| HTLC-success tx (unsigned) | `0200000001a351e3b1b081a909e61b6106a8c4684aebbb40c32f597aa2d2a0494eea7468c60200000000010000000122020000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4700000000` |
| HTLC-success txid | `6f662f2b064232e8a0f2cbf1e2ada48bffdb719c343f83da3c5d092bc35a8284` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `d57928f74a14ee9f0349cd1f10ecf995ac15cc624fdbeb0bdda2d5e88f376137` |
| `S` sig (compact) | `a550b563e299e9fb581cb54a3d28c41ba8ba08c8645afc9d72e78dae9427a21f28c60c269836f7c6f4e079bcab98033e9e89af7f7d515e7b9a82460f4d0cad28` |
| `S` sig (DER + `0x83`) | `3045022100a550b563e299e9fb581cb54a3d28c41ba8ba08c8645afc9d72e78dae9427a21f022028c60c269836f7c6f4e079bcab98033e9e89af7f7d515e7b9a82460f4d0cad2883` |

**htlc_signature for voucher 1 (output 3, 994 sat, position 1 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (received HTLC, `cltv_expiry` 800000) | `76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91454b1084f7baa1d922c8a4d875d1799529047bb1988527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568` |
| HTLC-success tx (unsigned) | `0200000001a351e3b1b081a909e61b6106a8c4684aebbb40c32f597aa2d2a0494eea7468c603000000000100000001e2030000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4700000000` |
| HTLC-success txid | `d6642a36310764b47fccb067f829c8245994c466147bf3935c1bb18b03092cdc` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `cf2d364c2ad9082765cb3a1fba6c1fe72d9c2c9d1e42f245c026728a6b203ff6` |
| `S` sig (compact) | `1d67b43a1306195fc5568152516a481f48735c0db235ec004dbd63721b7e0fe87e462a479c78a75a80e4be4be4685caf3af11e0324e82185d916229db57ba273` |
| `S` sig (DER + `0x83`) | `304402201d67b43a1306195fc5568152516a481f48735c0db235ec004dbd63721b7e0fe802207e462a479c78a75a80e4be4be4685caf3af11e0324e82185d916229db57ba27383` |

**htlc_signature for voucher 3 (output 4, 49749 sat, position 2 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (received HTLC, `cltv_expiry` 800000) | `76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a914521b24966890df6a266a14282cb86425766c736a88527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568` |
| HTLC-success tx (unsigned) | `0200000001a351e3b1b081a909e61b6106a8c4684aebbb40c32f597aa2d2a0494eea7468c60400000000010000000155c20000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4700000000` |
| HTLC-success txid | `5d6a01ee751e1217a549c052e16e8b107da5c95b3a6a76eedb13614ae49909e8` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `2fed11ca4fcac83606b9f024fb57028f021168266b8e24330e102af4a8fa40e6` |
| `S` sig (compact) | `89904998b085b9d1fa5752adff79caf19137aafdf42f040e253a50937eb596f93307a5133e88c106a72c85c6c4a668c72dc0474a504fa3aea109346bf01762aa` |
| `S` sig (DER + `0x83`) | `304502210089904998b085b9d1fa5752adff79caf19137aafdf42f040e253a50937eb596f902203307a5133e88c106a72c85c6c4a668c72dc0474a504fa3aea109346bf01762aa83` |

#### D.3.6.2 `S`'s view: commitment 43, 3 offered HTLCs, signed by `R`

| Field | Value |
|---|---|
| commitment number (S) | 43 |
| `per_commitment_point_S[43]` | `03b8e3a5a49272d52e232ce62d0ff46700f79509f62923a3f73244986410abc346` |
| obscured commitment number | `0x2bb03852193f` |
| commitment fee (paid by `R`) | 4100 sat + 660 sat anchors |
| txid | `dadabe1d3b06bf6b5be8a078f650f554a24017b952c4869a04b49d45ed99f437` |
| txid (internal byte order, as hashed into `H_commit`) | `37f499ed459db4049a86c452b91740a254f550f678a0e85b6bbf063b1dbedada` |
| SHA256(tx bytes) | `f4bd747c8a6b0cdbdd33248ec8800d4bcada3c3ced12a1958751ec90f1ff7aa4` |
| revocation pubkey | `03087846de1985dbf9947be7a2ceafa799eecb09eb5da03744b4ed66eefeca7d16` |
| S delayed pubkey (`to_local`) | `02eb5d86711bb1e6a3bb08d8787e0bb334995bb75172a1599c0dc91436448eaa50` |
| S HTLC pubkey | `02f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c` |
| R HTLC pubkey | `0249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c` |
| `to_remote` key (static, = R payment basepoint) | `034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa` |

Outputs (BOLT 3 order):

| # | Output | Amount (sat) | scriptPubKey |
|---|---|---|---|
| 0 | anchor (R) | 330 | `00202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f` |
| 1 | anchor (S) | 330 | `0020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994` |
| 2 | voucher_2 (offered HTLC) | 546 | `002095e146de1ea68e01f560350a385cbb5b34743775f0b50119d315243080bccaca` |
| 3 | voucher_1 (offered HTLC) | 994 | `0020b5b26cb30a0f2dc9911e33c8c2019fb5f14ae230c6b7f443f0b8cac3ed2f667b` |
| 4 | voucher_3 (offered HTLC) | 49749 | `0020d14fa87f3fff160b536c40c0299a72f3d9aeef12efbd69c44201899ebf098e82` |
| 5 | to_remote (R) | 2995240 | `002032e8da66b7054d40832c6a7a66df79d8d7bcccd5ffa53f5dd1772cb9cb9f3283` |
| 6 | to_local (S) | 6948710 | `0020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db686` |

Transaction (unsigned funding input, as signed by both parties):

```
0200000001bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489000000000038b02b80074a010000000000002200202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f4a01000000000000220020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994220200000000000022002095e146de1ea68e01f560350a385cbb5b34743775f0b50119d315243080bccacae203000000000000220020b5b26cb30a0f2dc9911e33c8c2019fb5f14ae230c6b7f443f0b8cac3ed2f667b55c2000000000000220020d14fa87f3fff160b536c40c0299a72f3d9aeef12efbd69c44201899ebf098e8228b42d000000000022002032e8da66b7054d40832c6a7a66df79d8d7bcccd5ffa53f5dd1772cb9cb9f328366076a0000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db6863f195220
```

`R` commitment signature (`commitment_signed.signature`):

- compact: `1036b69c5c0e4097cd81d903763ffffda4d928f3d2bdf86adfaeeba732055c1e58356fa89e01b6e69bee7c36cac774db9b531c40fd69cb853b3cee9bf8d0de45`
- DER + `SIGHASH_ALL`: `304402201036b69c5c0e4097cd81d903763ffffda4d928f3d2bdf86adfaeeba732055c1e022058356fa89e01b6e69bee7c36cac774db9b531c40fd69cb853b3cee9bf8d0de4501`

`R` HTLC signatures (`commitment_signed.htlc_signature`, 3 sigs in BOLT 3 output order, `SIGHASH_SINGLE|ANYONECANPAY` over each voucher's HTLC-timeout transaction, anchor rules: zero fee, input `nSequence = 1`, `nLockTime = T_exp`):

**htlc_signature for voucher 2 (output 2, 546 sat, position 0 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (offered HTLC) | `76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a914043ef49514426f6df6a379480f75b25671cabf2688ac6851b27568` |
| HTLC-timeout tx (unsigned) | `020000000137f499ed459db4049a86c452b91740a254f550f678a0e85b6bbf063b1dbedada020000000001000000012202000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db68600350c00` |
| HTLC-timeout txid | `721516e44a6fa5ff8e8ccf966bb317dfc1dd74322bba48bf6d9952d3732f4980` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `327b4d6d35a31080d6f28665c8f853832c079156749729cec541fd1844f3c0f1` |
| `R` sig (compact) | `f321129fef269e9efc9452df1a69496db2f42d9c3b288a7da179c9add339b72d25c7ce9f346126c4da1ecbb07df1c0d89c13a56af7dcd82ad93c706ddfd01431` |
| `R` sig (DER + `0x83`) | `3045022100f321129fef269e9efc9452df1a69496db2f42d9c3b288a7da179c9add339b72d022025c7ce9f346126c4da1ecbb07df1c0d89c13a56af7dcd82ad93c706ddfd0143183` |

**htlc_signature for voucher 1 (output 3, 994 sat, position 1 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (offered HTLC) | `76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91454b1084f7baa1d922c8a4d875d1799529047bb1988ac6851b27568` |
| HTLC-timeout tx (unsigned) | `020000000137f499ed459db4049a86c452b91740a254f550f678a0e85b6bbf063b1dbedada03000000000100000001e203000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db68600350c00` |
| HTLC-timeout txid | `8838eba3df1f1e08deec41676dc6712655feff5f229d333d7301ce12e4e6b764` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `f17ee9f2416609042d681bfc6da8d3e249952ec8ad705f7d382c1acbe0175c8f` |
| `R` sig (compact) | `f66446a2cd8dc6f1754dd0f71c1e4f5564b3997f19c289ce37136227d7c8784f093994fbc4b226057f177ab268434421319291c353f63e1e2bac09e126f3dd87` |
| `R` sig (DER + `0x83`) | `3045022100f66446a2cd8dc6f1754dd0f71c1e4f5564b3997f19c289ce37136227d7c8784f0220093994fbc4b226057f177ab268434421319291c353f63e1e2bac09e126f3dd8783` |

**htlc_signature for voucher 3 (output 4, 49749 sat, position 2 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (offered HTLC) | `76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a914521b24966890df6a266a14282cb86425766c736a88ac6851b27568` |
| HTLC-timeout tx (unsigned) | `020000000137f499ed459db4049a86c452b91740a254f550f678a0e85b6bbf063b1dbedada0400000000010000000155c2000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db68600350c00` |
| HTLC-timeout txid | `80afef8aadd1131a9bf6e8da3f58b0d09f18e1e7098f60d5899e5fe2cbdb914d` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `297bdb90cc47327517508ff269e07950fadc2d2e472d8a4ed765eb17bd2823ca` |
| `R` sig (compact) | `eda4fca83e720144ab02c5853a83e9dff42be7df302c0f7f9c0e08026c8c1bf87aee6f0b768d2570e28a1f459f26773f2c1c9e1e479f9b5d8b24db56c57caa0f` |
| `R` sig (DER + `0x83`) | `3045022100eda4fca83e720144ab02c5853a83e9dff42be7df302c0f7f9c0e08026c8c1bf802207aee6f0b768d2570e28a1f459f26773f2c1c9e1e479f9b5d8b24db56c57caa0f83` |

### D.3.7 `H_commit`, `ff_activate`, `H_act`, `ff_activate_ack` (7.5.2, 7.5.4)

| Field | Value |
|---|---|
| `n_R^act` / `txid(C^R)` internal byte order | 43 / `a351e3b1b081a909e61b6106a8c4684aebbb40c32f597aa2d2a0494eea7468c6` |
| `n_S^act` / `txid(C^S)` internal byte order | 43 / `37f499ed459db4049a86c452b91740a254f550f678a0e85b6bbf063b1dbedada` |
| `H_commit` | `c034dadab45e153536220113ba43e4aeaf2a87391cda1fa33b9d7d89472ce5ad` |

**`ff_activate` (type 55045, 230 bytes, signed by `R`)** (`setup_hash = T_setup`, `book_hash = H_book`, `commit_hash = H_commit`, `epoch_start_height = 790000`)

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `527b01105c16383585853597b931c0fd348014f81a37d2fab4c2ad78c88a1464` |
| signature (final 64 bytes) | `872c5320024fbba9ee9ee119fc2b61b48107ee6aed280b508eae7d233e8bc9db501f0541eb37c0649ef9526e75f035d355a6dede257c86d1222a728814cd8d82` |
| SHA256(wire bytes) | `0cafc03c292dbd12713817ae30f9009913411949e5a7a114bd43abe1fab3ba90` |

Wire bytes:

```
d705bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a4884898685960c118c83535c1bcc47e33666a775e26e9d1ca6cbca79aade33f9fe3ecb43bce577aa29c966a8c9a8bc614a9edfc4994f8ee4954414bc635cb6dcd745ff5bb093a59800241c8f94a2ab083fadadda85a5d08e81b046e0dcf4623310819bc034dadab45e153536220113ba43e4aeaf2a87391cda1fa33b9d7d89472ce5ad000c0df0872c5320024fbba9ee9ee119fc2b61b48107ee6aed280b508eae7d233e8bc9db501f0541eb37c0649ef9526e75f035d355a6dede257c86d1222a728814cd8d82
```

| Field | Value |
|---|---|
| `H_act` | `bcb6c726241e7b35d19c5e0f952271531cf2e61b4979c61cf8c817ebcd22da03` |

**`ff_activate_ack` (type 55047, 162 bytes, signed by `S`)** (`activation_hash = H_act`)

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `dfe90beeba6d8dab54f593ab4417ca03496620b32ef8053074cf5fb60e62c6d7` |
| signature (final 64 bytes) | `b07d07776548693e5a9ceace1cca137794ef60f13c53d67ad6ac4baa64518e8576fa49931dd22c60ccd8b66d1319834cb6993d41df0b281dd45930f1b5e475b4` |
| SHA256(wire bytes) | `863db3513a0a676edc69c216245e8f4c34b0a319866b283138f2cfb157604071` |

Wire bytes:

```
d707bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a4884898685960c118c83535c1bcc47e33666a775e26e9d1ca6cbca79aade33f9fe3ecbbcb6c726241e7b35d19c5e0f952271531cf2e61b4979c61cf8c817ebcd22da03b07d07776548693e5a9ceace1cca137794ef60f13c53d67ad6ac4baa64518e8576fa49931dd22c60ccd8b66d1319834cb6993d41df0b281dd45930f1b5e475b4
```

### D.3.8 Force-close claim paths for voucher 1 (9.5.1)

#### D.3.8.1 R's view: HTLC-success transaction for voucher 1 (R claims with t_1)

Spends output 3 of R's commitment (994 sat, received-HTLC script). Zero fee,
`nSequence = 1`, `nLockTime = 0`, single output of the full amount to the CSV-delayed script
(revocation key or R's delayed key after `to_self_delay = 144`). S's signature is the
`htlc_signature` from the setup `commitment_signed` (9.5.3): R needs nothing from S at claim time.

| Field | Value |
|---|---|
| txid | `d6642a36310764b47fccb067f829c8245994c466147bf3935c1bb18b03092cdc` |
| sighash type | R: `SIGHASH_ALL` (0x01); S: `SIGHASH_SINGLE|ANYONECANPAY` (0x83), sighash in the R-view table above |
| sighash signed here | `5a4240bf82f920a768843b181dd48709823eaec32e5880a3939bffda7376ab89` |
| witness layout | `0 <S htlc sig, DER+0x83> <R htlc sig, DER+0x01> <t_1> <received-HTLC witness script>` |
| R HTLC privkey on this commitment | `29b220f1273050a7c38323ce52e79dc9b44953e6fd8d6f44d39db98bee09644d` |
| R signature (compact) | `4f799747756e86b378bc11649c900958f243d61e1ec9bd617bbb6813054085b05f9bbd173380fa9c6e8bed83af179b59de136619b21266c29a65b794c389d278` |
| R signature (DER + 0x01) | `304402204f799747756e86b378bc11649c900958f243d61e1ec9bd617bbb6813054085b002205f9bbd173380fa9c6e8bed83af179b59de136619b21266c29a65b794c389d27801` |
| S signature (DER + 0x83) | `304402201d67b43a1306195fc5568152516a481f48735c0db235ec004dbd63721b7e0fe802207e462a479c78a75a80e4be4be4685caf3af11e0324e82185d916229db57ba27383` |

Unsigned:

```
0200000001a351e3b1b081a909e61b6106a8c4684aebbb40c32f597aa2d2a0494eea7468c603000000000100000001e2030000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4700000000
```

Witness stack (space-separated; `<>` is the empty element):

```
<> 304402201d67b43a1306195fc5568152516a481f48735c0db235ec004dbd63721b7e0fe802207e462a479c78a75a80e4be4be4685caf3af11e0324e82185d916229db57ba27383 304402204f799747756e86b378bc11649c900958f243d61e1ec9bd617bbb6813054085b002205f9bbd173380fa9c6e8bed83af179b59de136619b21266c29a65b794c389d27801 ad7d3f3daebc0ed34454033f88de67df1e2281c3d3d66edaa8aa379725d5457d 76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91454b1084f7baa1d922c8a4d875d1799529047bb1988527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568
```

Fully signed (serialized with witness):

```
02000000000101a351e3b1b081a909e61b6106a8c4684aebbb40c32f597aa2d2a0494eea7468c603000000000100000001e2030000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce47050047304402201d67b43a1306195fc5568152516a481f48735c0db235ec004dbd63721b7e0fe802207e462a479c78a75a80e4be4be4685caf3af11e0324e82185d916229db57ba2738347304402204f799747756e86b378bc11649c900958f243d61e1ec9bd617bbb6813054085b002205f9bbd173380fa9c6e8bed83af179b59de136619b21266c29a65b794c389d2780120ad7d3f3daebc0ed34454033f88de67df1e2281c3d3d66edaa8aa379725d5457d8e76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91454b1084f7baa1d922c8a4d875d1799529047bb1988527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b2756800000000
```

#### D.3.8.2 R's view: S's direct timeout spend of voucher 1 after T_exp

Spends the same output 3 through the received-HTLC script's timeout branch:
`nLockTime = T_exp`, `nSequence = 1` (the anchor CSV; also what makes CLTV enforceable),
200 sat nominal fee, remainder to S's sweep P2WPKH. No second-level transaction and no
signature from R: this is how S recovers an unclaimed voucher if R never returns (9.5.1).
beignet builder: `buildRemoteHtlcTimeoutClaimTx` + `buildRemoteHtlcTimeoutWitness`.

| Field | Value |
|---|---|
| txid | `4e2ae689dce909001a2309a602acdcd58509a04ec95eab781833fa31d8fc5a11` |
| sighash type | `SIGHASH_ALL` (0x01) |
| sighash signed here | `a45f2f40eb43878205add37dd334c21c2cd550a67199b19b2ba2d0edd3d292c3` |
| witness layout | `<S htlc sig, DER+0x01> <> <received-HTLC witness script>` (the empty element fails `OP_SIZE 32 OP_EQUAL`, selecting the timeout branch) |
| S HTLC privkey on this commitment | `3bff71454cc58337552426935ac5a512513695b46bdce52b6874db50d67e30fc` |
| S signature (compact) | `e034e6fa9f8ea74bbeac30f86b516a0ecb22aae6fefb0d854438725f5c0fdbe94db1e087391e6875d5e5dd38199a6985497d0776ad198dbff8308841e35ecfc6` |
| destination (S sweep P2WPKH) | `001414dc9d213971a3b25a3d6ee821b7bb9c5881f93b` |

Unsigned:

```
0200000001a351e3b1b081a909e61b6106a8c4684aebbb40c32f597aa2d2a0494eea7468c6030000000001000000011a0300000000000016001414dc9d213971a3b25a3d6ee821b7bb9c5881f93b00350c00
```

Witness stack (space-separated; `<>` is the empty element):

```
3045022100e034e6fa9f8ea74bbeac30f86b516a0ecb22aae6fefb0d854438725f5c0fdbe902204db1e087391e6875d5e5dd38199a6985497d0776ad198dbff8308841e35ecfc601 <> 76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91454b1084f7baa1d922c8a4d875d1799529047bb1988527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568
```

Fully signed (serialized with witness):

```
02000000000101a351e3b1b081a909e61b6106a8c4684aebbb40c32f597aa2d2a0494eea7468c6030000000001000000011a0300000000000016001414dc9d213971a3b25a3d6ee821b7bb9c5881f93b03483045022100e034e6fa9f8ea74bbeac30f86b516a0ecb22aae6fefb0d854438725f5c0fdbe902204db1e087391e6875d5e5dd38199a6985497d0776ad198dbff8308841e35ecfc601008e76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91454b1084f7baa1d922c8a4d875d1799529047bb1988527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b2756800350c00
```

#### D.3.8.3 S's view: R's direct preimage claim of voucher 1

Spends output 3 of S's commitment (994 sat, offered-HTLC script) through the
preimage branch with R's own key and `t_1`: no second-stage signature is needed (9.5.1).
`nSequence = 1` (anchor CSV), `nLockTime = 0`, 200 sat nominal fee, remainder to R's sweep P2WPKH.
beignet builder: `buildRemoteHtlcPreimageClaimTx` + `buildRemoteHtlcPreimageWitness`.

| Field | Value |
|---|---|
| txid | `4179c9569f17fa702650a6176fc28f17d378ef4ee372582ebd37f08c0cc16bf3` |
| sighash type | `SIGHASH_ALL` (0x01) |
| sighash signed here | `2db6286205ec08b293ff074e015ca8f4dbd47093d7895ceeff587385c4955c50` |
| witness layout | `<R htlc sig, DER+0x01> <t_1> <offered-HTLC witness script>` |
| R HTLC privkey on this commitment | `50fc1cf359e5cb8cf5cd0cab20c32ef9b97514332ec8672ec30d8bb408d5a1e0` |
| R signature (compact) | `e527b21a451556118591ed4b60ffc140264098ae316c9841bd475f4d6b174f776cd45dd667df5b32adc1dc19b77a78c759dd9544ae2b6edb68b8895c6ad41480` |
| destination (R sweep P2WPKH) | `00142912535a2c1e5ff06a41e0e70341c839d40cfbd3` |

Unsigned:

```
020000000137f499ed459db4049a86c452b91740a254f550f678a0e85b6bbf063b1dbedada030000000001000000011a030000000000001600142912535a2c1e5ff06a41e0e70341c839d40cfbd300000000
```

Witness stack (space-separated; `<>` is the empty element):

```
3045022100e527b21a451556118591ed4b60ffc140264098ae316c9841bd475f4d6b174f7702206cd45dd667df5b32adc1dc19b77a78c759dd9544ae2b6edb68b8895c6ad4148001 ad7d3f3daebc0ed34454033f88de67df1e2281c3d3d66edaa8aa379725d5457d 76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91454b1084f7baa1d922c8a4d875d1799529047bb1988ac6851b27568
```

Fully signed (serialized with witness):

```
0200000000010137f499ed459db4049a86c452b91740a254f550f678a0e85b6bbf063b1dbedada030000000001000000011a030000000000001600142912535a2c1e5ff06a41e0e70341c839d40cfbd303483045022100e527b21a451556118591ed4b60ffc140264098ae316c9841bd475f4d6b174f7702206cd45dd667df5b32adc1dc19b77a78c759dd9544ae2b6edb68b8895c6ad414800120ad7d3f3daebc0ed34454033f88de67df1e2281c3d3d66edaa8aa379725d5457d8876a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91454b1084f7baa1d922c8a4d875d1799529047bb1988ac6851b2756800000000
```

#### D.3.8.4 S's view: HTLC-timeout transaction for voucher 1 (S recovers after T_exp)

Spends output 3 of S's commitment. Zero fee, `nSequence = 1`, `nLockTime = T_exp = 800000`,
single output of the full amount to the CSV-delayed script (revocation key or S's delayed key
after `to_self_delay = 144`). R's signature is the `htlc_signature` R sent in its setup
`commitment_signed` (9.5.1 step 4).

| Field | Value |
|---|---|
| txid | `8838eba3df1f1e08deec41676dc6712655feff5f229d333d7301ce12e4e6b764` |
| sighash type | S: `SIGHASH_ALL` (0x01); R: `SIGHASH_SINGLE|ANYONECANPAY` (0x83), sighash in the S-view table above |
| sighash signed here | `77ea4e0e44a7941e97f085d65310336e2bd2f49d068d26328d92f0df90ccd586` |
| witness layout | `0 <R htlc sig, DER+0x83> <S htlc sig, DER+0x01> <> <offered-HTLC witness script>` |
| S HTLC privkey on this commitment | `fe4bbc9895cc32b31c294b8d763a8637b413f591d4f020982b06e293c8c135b1` |
| S signature (compact) | `46353bff1d5f09b45b0005823c7a1f1e002dc60c8c7976c2f9e74394dd4199d43c51c918ab2927c8d1ac44566d342b04256bd56987d6805c39232ac206274f85` |
| S signature (DER + 0x01) | `3044022046353bff1d5f09b45b0005823c7a1f1e002dc60c8c7976c2f9e74394dd4199d402203c51c918ab2927c8d1ac44566d342b04256bd56987d6805c39232ac206274f8501` |
| R signature (DER + 0x83) | `3045022100f66446a2cd8dc6f1754dd0f71c1e4f5564b3997f19c289ce37136227d7c8784f0220093994fbc4b226057f177ab268434421319291c353f63e1e2bac09e126f3dd8783` |

Unsigned:

```
020000000137f499ed459db4049a86c452b91740a254f550f678a0e85b6bbf063b1dbedada03000000000100000001e203000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db68600350c00
```

Witness stack (space-separated; `<>` is the empty element):

```
<> 3045022100f66446a2cd8dc6f1754dd0f71c1e4f5564b3997f19c289ce37136227d7c8784f0220093994fbc4b226057f177ab268434421319291c353f63e1e2bac09e126f3dd8783 3044022046353bff1d5f09b45b0005823c7a1f1e002dc60c8c7976c2f9e74394dd4199d402203c51c918ab2927c8d1ac44566d342b04256bd56987d6805c39232ac206274f8501 <> 76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91454b1084f7baa1d922c8a4d875d1799529047bb1988ac6851b27568
```

Fully signed (serialized with witness):

```
0200000000010137f499ed459db4049a86c452b91740a254f550f678a0e85b6bbf063b1dbedada03000000000100000001e203000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db6860500483045022100f66446a2cd8dc6f1754dd0f71c1e4f5564b3997f19c289ce37136227d7c8784f0220093994fbc4b226057f177ab268434421319291c353f63e1e2bac09e126f3dd8783473044022046353bff1d5f09b45b0005823c7a1f1e002dc60c8c7976c2f9e74394dd4199d402203c51c918ab2927c8d1ac44566d342b04256bd56987d6805c39232ac206274f8501008876a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91454b1084f7baa1d922c8a4d875d1799529047bb1988ac6851b2756800350c00
```

## D.4 dust boundary: one voucher at exactly 546,000 msat

One voucher at exactly `min_payment_msat = 546,000` msat, whose output is
`546` sat = `dust_limit_satoshis`: the smallest voucher the profile admits
(section 8: under `option_anchors_zero_fee_htlc_tx` the second-level fee
term of the trim rule is zero, so the floor is exactly `dust_limit`). The
generator also asserts that `545,999` msat (a 545 sat output) fails BOTH
setup checks, `d_k >= min_payment_msat` and the section 8 trim check, so a
book carrying it is refused at step 2 and never built (see D.4.9).

### D.4.1 Parameters

| Parameter | Value |
|---|---|
| funder / opener | `S` |
| `epoch_id` | `87cb2b4c1f4e6b9246bc30f7a7cb145dff0ad8b75153061fe08a31344ec15a0d` |
| `K` (`max_payments`) | 1 |
| `voucher_amounts_msat` (TLV 9, `d_1..d_1`) | 546000 |
| `budget_msat` (= sum) | 546000 |
| `min_payment_msat` | 546000 |
| `T_exp` / `D` | 800000 / 798992 |
| `fee_base_msat` / `fee_proportional_millionths` | 1000 / 5000 |
| `G` / `variant` / `profile` | 0 / 4 / 1 |
| `s_htlc_id_base` (`ff_accept` TLV 7) | 0 |
| `n0` (`ff_accept`) | 42 |
| commitment fee at the frozen rate, 1 outputs (paid by `S`) | 3240 sat (+ 660 sat anchors) |
| pre-round balance `S` / `R` | 7000000000 / 3000000000 msat |
| `S` balance after the round | 6999454000 msat |

Vouchers (`fee_S` and `gross_into_S` per 7.6 are what the payer's HTLC must deliver; they never appear on the channel):

| k | d_k (msat) | output (sat) | fee_S(d_k) | gross_into_S(d_k) | s_htlc_id_k | preimage t_k (S only) | H_k |
|---|---|---|---|---|---|---|---|
| 1 | 546000 | 546 | 3730 | 549730 | 0 | `70dc8fdc7219f79d7e9fd225046385b269d08c4cd539a06d3de8c88cc1bd0898` | `ec5abb4d6d027af6f9bc6451f6cc98d95ad28fb9c20d67d3e51cb30614c15a6e` |

`r_per_commitment_points` is empty under Variant D (7.1: count 0). `R`'s per-commitment point for commitment number 43, which `S` holds from `R`'s last `revoke_and_ack`, is `03dcd6df1422406c9e57514174169f8219e69e77605ee0de483f5c3bac773d6a58`.

### D.4.2 Setup checks (7.1, 7.2, 7.5.3, 7.6, 8, 9.5.1 bounds)

All checked at `ff_accept` and rechecked at `ff_activate`; every row is a hard assertion in the generator.

| Check | Values | Result |
|---|---|---|
| variant == 4, G == 0, TLVs 1/3/5 absent from ff_init | variant 4, G 0 | pass |
| sum(d_k) == budget_msat | 546000 msat | pass |
| K <= 483 and K <= R max_accepted_htlcs | K = 1 | pass |
| sum(d_k) <= R max_htlc_value_in_flight_msat | 546000 <= 5000000000 | pass |
| every d_k >= min_payment_msat | min d_k = 546000 >= 546000 | pass |
| every d_k >= htlc_minimum_msat | min d_k = 546000 >= 1 | pass |
| no d_k trims (floor(d_k/1000) >= dust_limit, zero second-level fee under anchors) | min output 546 sat >= 546 | pass |
| no overflow: d_k * fee_ppm and gross_into_S(d_k) <= 2^64 - 1 | max d_k * ppm = 2730000000 | pass |
| S holds budget + S channel_reserve spendable | 7000000 sat >= 546 + 10000 | pass |
| funder (S) covers fee(K=1) + anchors at the frozen rate above its reserve | 6999454 - 10000 >= 3240 + 660 | pass |
| funder (S) fee-spike buffer: fee(K=1) at 2 x feerate + anchors above its reserve | 6999454 - 10000 >= 6480 + 660 | pass |
| S post-round balance >= S channel_reserve; R post-round balance >= R channel_reserve only when R funds | S 6995554 sat, R 3000000 sat (S funds: R not applied), reserve 10000 | pass |
| T_exp - D >= claim_margin (1008) | 800000 - 798992 = 1008 | pass |
| s_htlc_id_k = s_htlc_id_base + k - 1 | ids 0 .. 0 | pass |

### D.4.3 `ff_init` and `ff_accept` (7.1, 7.2)

**`ff_init` (type 55001, 185 bytes, signed by `R`)**

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `f85430e678acd2d94d7d66bd5bfab077688678623ad6cb24ddd6c694104b7e08` |
| signature (final 64 bytes) | `babbf4d69c60af8d49aaca2364c217375b270927d0340b18f630396bb6d9b1cd5490997cf98fc8ea3d38ef2f517e3a6e26e0ec9ce8c33ae503625e40a46fa451` |
| SHA256(wire bytes) | `fefb08c339f5bbac4c7f3ab6a0e3b8f62d1a7f254f7131a02edf420a5d26764b` |

Wire bytes:

```
d6d9bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a48848987cb2b4c1f4e6b9246bc30f7a7cb145dff0ad8b75153061fe08a31344ec15a0d0400000000000854d0000100000000000854d0000c3110000c3500000003e80000138800000000000000000000090800000000000854d0babbf4d69c60af8d49aaca2364c217375b270927d0340b18f630396bb6d9b1cd5490997cf98fc8ea3d38ef2f517e3a6e26e0ec9ce8c33ae503625e40a46fa451
```

| Field | Value |
|---|---|
| `T_init` | `b4a90a0eb194b5d7d283a45707f5778bfca2eda67c762e3f548520024f0cc257` |

**`ff_accept` (type 55003, 226 bytes, signed by `S`)** (TLV 1 hashes, TLV 7 `s_htlc_id_base`, TLV 9 byte-identical to `ff_init`'s, TLV 11 = `T_init`)

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `01be9fb5e19ac8fdc5fa9600380d26ab9e1e78886302d729a7ca77cf297edf5b` |
| signature (final 64 bytes) | `5f178313b04c050db7aa8053d8fd271677247d8058ac49f3096d0f7abc1d09f75c82c95bcb0702117007a7ca143b106392a006f81cde971644bdad587af2cc7f` |
| SHA256(wire bytes) | `b28ba7c903c3e74dbab51727ef6fa9624723896166f338d4d0ab59c8198465bd` |

Wire bytes:

```
d6dbbef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a48848987cb2b4c1f4e6b9246bc30f7a7cb145dff0ad8b75153061fe08a31344ec15a0d000000000000002a0120ec5abb4d6d027af6f9bc6451f6cc98d95ad28fb9c20d67d3e51cb30614c15a6e07080000000000000000090800000000000854d00b20b4a90a0eb194b5d7d283a45707f5778bfca2eda67c762e3f548520024f0cc2575f178313b04c050db7aa8053d8fd271677247d8058ac49f3096d0f7abc1d09f75c82c95bcb0702117007a7ca143b106392a006f81cde971644bdad587af2cc7f
```

| Field | Value |
|---|---|
| `T_setup` | `29b3ef77eec90177a34bf4d9785afd1fd6ffb2a28bad4ed571f295fe711c35a9` |

### D.4.4 The voucher book (7.5.3)

`book` is 94 bytes (`36 + 58 K`): `[32: epoch_id][1: 0x04][1: 0x01][2: K]` then one 58-byte entry per slot.

```
87cb2b4c1f4e6b9246bc30f7a7cb145dff0ad8b75153061fe08a31344ec15a0d040100010001ec5abb4d6d027af6f9bc6451f6cc98d95ad28fb9c20d67d3e51cb30614c15a6e00000000000854d0000c3500000c31100000000000000000
```

| Field | Value |
|---|---|
| `H_book` | `6beceabe7c2571353e03fdb7f82e3f4241c2467967ba67c2b9efebf32a4a6839` |
| SHA256(book) (for cross-checking an encoder without the tag) | `d051eb7043e0acef84b0e29d13a9fb584ecdcce7b3597f01e486a4cacffdfe6a` |

### D.4.5 `update_add_htlc` and the voucher onions (9.5.1 step 3)

`S` sends one stock `update_add_htlc` per slot in `k` order. `R` recognises a
voucher by `(id, amount_msat, payment_hash, cltv_expiry)` matching the book and
parks it; the onion is decodable but never acted on.

| k | id | amount_msat | payment_hash | cltv_expiry | payment_secret (final payload) | onion session key | onion ephemeral pubkey |
|---|---|---|---|---|---|---|---|
| 1 | 0 | 546000 | `ec5abb4d6d027af6f9bc6451f6cc98d95ad28fb9c20d67d3e51cb30614c15a6e` | 800000 | `31570a859c5c020ca6238c18ce1c5ac93d5158d5159ab6d5a38b4cb0f068f363` | `04ce17ad46a09675a0e98fe787bf67f6f985c37589f6cb6c48fbb42afdeaf1be` | `02d767647a4cda5ca028b8a23b9d9569662d4517873ff7deab3cefe1100f0868df` |

Voucher 1's complete `update_add_htlc` (1452 bytes; the final 1366 bytes are the onion packet, whose first byte is the version 0x00 and whose next 33 are the ephemeral pubkey above). Final hop payload: `{amt_to_forward = 546000, outgoing_cltv_value = 800000, payment_data = {payment_secret, total_msat = 546000}}`, TLV types 2, 4, 8.

```
0080bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489000000000000000000000000000854d0ec5abb4d6d027af6f9bc6451f6cc98d95ad28fb9c20d67d3e51cb30614c15a6e000c35000002d767647a4cda5ca028b8a23b9d9569662d4517873ff7deab3cefe1100f0868df47a2ea6c0ab9ad2008289d0e3774ab1062dd87c05a09cae256ecdd427d938a8efad379bced588a34608487ae731f4086239b535ca319cb227c8e0322cc511584a940c5a01863318ae0d497ff96cf1678903f4375ba7a77d57be8081db3bd033da0d690cf8960faac6b2c5dcd3c45bd27f87d0db066699800e5e46874c46a45aba883983bdcf380768d0d355ca9b14660fec06799ff591f26bdc71e876885581fa4608bbf5d1052f711a8b6189a75598d1c494d1cb6fb1e8479a4bc2ef520f4167e950378701c0119e88db34c5f3e4bfac3e3036ec75d0d16c2cb48fd272b7002eeae0b815f22a8ed7481efe849daf7847c0497afbeebdd38c45f467c586f887d669872f8c804682a8a16bef5955161ce182d7cf699d40c0bdc378aab81302b591418dd290f74caf322b8fe77d1054183d09a91e50d3ab575e7428b63751fa00834981eeec02fac655a0ef33fe667d35d549c935df8008da8c4d5cd4822c1bd940cfbfb91e0a966edb955f6c7cb7541a51710efbb8fe698ff661a6d24447b61a0d96fd9da76295e5d1499e8e27a999a869a5dfb34aebbcda9a2e61719437d79f4249b5a9731d1f9ed7fd05d0ae4fb9f5e49f81c1c80a496f7b87418f089c8f1c65b9089b0764fd34a65227d9bdc87109145ddff9290d6fc971fa144092ac969cc5fc4b3a4ba2070318bff6f564cbefeec8bfc7fd63f0d4c09d4f76376699369498a65c8d10d3d6fa5c35b7268a8c9755ac232da0a8d01cd0247e9ec962eb72df6a8d202250178fd1601cbbd19e78bf253119f6e57ea5d6ef17b72c0f3ed8e96f293801b7006218e6a550f1d44df5e3ce6ea3d72d91fd0049912e165ec40b809b028c23034a608abfcb56c7170965459d910c8dd36f4cdaf6af0a4659f1c7d612601d568e40170f286db9cf175381958651f9aff5799a46b187b0cd81e923b76b56fc010b4f011a9af1926835d083bb188f520f898df4ba48deefc56a3fe1177c9ddb86645e642dd6c090577374f93bf8d3ba6250a67b9ff29172fd469d0f37b278d37cd645430219e3b3c334d3df7061ca56628c559b9c17446da5025ccd20ca37f3f2c428141410ae03757850da32198d2d2d19d2962fd55d67bd28b9ae03d22f7f0650496809a9bc378dbd2e18950489831b4d1e95ffe83606de34863438fcbf0e1c8670839b5904bcc16be92d758aaa752cea3e94d0fccc057f035f9b491946c10e5446ea84da3254984080437e3fcde302902402b7e52fd277bf702cf82b060c52f338a393f4dc767a1b01a585d05556ba869203f6ef8abd77a7d04ebe6cb9a2ce67c272a4a77598ad46eeaf6aa0de151f6a6f944d470277f05960be02b5a40284cd18689238b53eaa50d903a655537527120e5c17ecb5a1f82dee145e7eaa646ad3406a10d445294453c294fc234209f1c69be07e9ec00d44bad6c3ca31f5fc8824d7c9dec757af044ab323c275877b16065877a283240020c1247e19f0ebe7717189bbd25f6018ee31e7693301bd05c32edcf23f0ab7aefac4237fb11489cf2e56c38b31eaa8f37577d078945a727c8120b65050da4e7fd700ef2ea53844ce384c658206521af68f590e71f8555b390bb136e5fc1226a8a5fc0db9fd777c3c618d554bbe401fe2f5194388400f80bcb4fc6b49415e0fc2dbe0bc562e20821897d6d03ebe6f65a5ba5f11e0b71ccb4d6f3a083b18fe7c3258c852a13cc7611572037971f3d7864806d629e57334f37dddaeffc4a2f11c6d437590ab299a0a407bb48f83c9522764c380aea6e5755238cdac0b78a978efc214c27267e9b490a3dbf2fac750de445f4f6d73e15799f93cf873c562628703c7d727ef9faf7e9f068d4932327063455583c4d09a36cd470316200
```

### D.4.6 Both commitment views after the round (9.5.1 steps 4 and 5)

#### D.4.6.1 `R`'s view: commitment 43, 1 received HTLC (S-offered), signed by `S`

| Field | Value |
|---|---|
| commitment number (R) | 43 |
| `per_commitment_point_R[43]` | `03dcd6df1422406c9e57514174169f8219e69e77605ee0de483f5c3bac773d6a58` |
| obscured commitment number | `0xb9c570f08182` |
| commitment fee (paid by `S`) | 3240 sat + 660 sat anchors |
| txid | `e3b8405b9350e4ed5b8c21f21a1fc94948c48c45631243a25a1079fbcd24556c` |
| txid (internal byte order, as hashed into `H_commit`) | `6c5524cdfb79105aa2431263458cc44849c91f1af2218c5bede450935b40b8e3` |
| SHA256(tx bytes) | `63a82795373c138f6045ceaee854c56c801bef180ded265f17ca6f4d5b7e9891` |
| revocation pubkey | `026b4fc56f8fe8e877de96e178e7ca33106e876168a18e785f0b6d212a46a5408d` |
| R delayed pubkey (`to_local`) | `02f2ce48e632060212999887dbc79d7b51a6f186ad35d4030df3e827fa2fa741c3` |
| R HTLC pubkey | `034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea` |
| S HTLC pubkey | `02b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b4892` |
| `to_remote` key (static, = S payment basepoint) | `032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991` |

Outputs (BOLT 3 order):

| # | Output | Amount (sat) | scriptPubKey |
|---|---|---|---|
| 0 | anchor (R) | 330 | `00202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f` |
| 1 | anchor (S) | 330 | `0020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994` |
| 2 | voucher_1 (received HTLC, S-offered) | 546 | `0020305c3d2c011ecdd2a9db747c123dc78454a9ff8495063e421bd1d17f02c62f86` |
| 3 | to_local (R) | 3000000 | `00202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce47` |
| 4 | to_remote (S) | 6995554 | `0020f3394e1e619b0eca1f91be2fb5ab4dfc59ba5b84ebe014ad1d43a564d012994a` |

Transaction (unsigned funding input, as signed by both parties):

```
0200000001bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489000000000070c5b980054a010000000000002200202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f4a01000000000000220020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb39942202000000000000220020305c3d2c011ecdd2a9db747c123dc78454a9ff8495063e421bd1d17f02c62f86c0c62d00000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4762be6a0000000000220020f3394e1e619b0eca1f91be2fb5ab4dfc59ba5b84ebe014ad1d43a564d012994a8281f020
```

`S` commitment signature (`commitment_signed.signature`):

- compact: `8e420eb09afc9e14917d109289aba738be760222ab59f798568b741e81eeaa394d371ecda81fb17a8019d2173c81eaca0341d7efa7c03662c32b58e63c725a25`
- DER + `SIGHASH_ALL`: `30450221008e420eb09afc9e14917d109289aba738be760222ab59f798568b741e81eeaa3902204d371ecda81fb17a8019d2173c81eaca0341d7efa7c03662c32b58e63c725a2501`

`S` HTLC signatures (`commitment_signed.htlc_signature`, 1 sig in BOLT 3 output order, `SIGHASH_SINGLE|ANYONECANPAY` over each voucher's HTLC-success transaction, anchor rules: zero fee, input `nSequence = 1`):

**htlc_signature for voucher 1 (output 2, 546 sat, position 0 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (received HTLC, `cltv_expiry` 800000) | `76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a9145d48935223c344b1e446ac5280c7850196cf97e088527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568` |
| HTLC-success tx (unsigned) | `02000000016c5524cdfb79105aa2431263458cc44849c91f1af2218c5bede450935b40b8e30200000000010000000122020000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4700000000` |
| HTLC-success txid | `af00ee0e852a3552ddb4ff97712926b335cb7ecfe839b52ac5207ba80fef80b7` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `9ed289e8b3baa49da5d3a7cc44bc8a641ac9bf61b7e97d7590cc262b2d032c96` |
| `S` sig (compact) | `36edb683af0955bc23cbe069cd3189b345cdc1b17a14a4503d2148bde74a3a776b9c978690971e1209de8266810ce432863cbeb890e8933ddf9df900930c345e` |
| `S` sig (DER + `0x83`) | `3044022036edb683af0955bc23cbe069cd3189b345cdc1b17a14a4503d2148bde74a3a7702206b9c978690971e1209de8266810ce432863cbeb890e8933ddf9df900930c345e83` |

#### D.4.6.2 `S`'s view: commitment 43, 1 offered HTLC, signed by `R`

| Field | Value |
|---|---|
| commitment number (S) | 43 |
| `per_commitment_point_S[43]` | `03b8e3a5a49272d52e232ce62d0ff46700f79509f62923a3f73244986410abc346` |
| obscured commitment number | `0xb9c570f08182` |
| commitment fee (paid by `S`) | 3240 sat + 660 sat anchors |
| txid | `95d95e5340d8a4f65edf2e47b8a1294c033af76cc5e65d4b9132cf69cb05d46f` |
| txid (internal byte order, as hashed into `H_commit`) | `6fd405cb69cf32914b5de6c56cf73a034c29a1b8472edf5ef6a4d840535ed995` |
| SHA256(tx bytes) | `091129e048f12cea680702ac6345024540004899993f41af50b410d24a4d1d74` |
| revocation pubkey | `03087846de1985dbf9947be7a2ceafa799eecb09eb5da03744b4ed66eefeca7d16` |
| S delayed pubkey (`to_local`) | `02eb5d86711bb1e6a3bb08d8787e0bb334995bb75172a1599c0dc91436448eaa50` |
| S HTLC pubkey | `02f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c` |
| R HTLC pubkey | `0249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c` |
| `to_remote` key (static, = R payment basepoint) | `034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa` |

Outputs (BOLT 3 order):

| # | Output | Amount (sat) | scriptPubKey |
|---|---|---|---|
| 0 | anchor (R) | 330 | `00202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f` |
| 1 | anchor (S) | 330 | `0020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994` |
| 2 | voucher_1 (offered HTLC) | 546 | `0020a7ad36344b7ed2edf404f505e99b9ff161fc6939e122b956995a4ac5d5fed707` |
| 3 | to_remote (R) | 3000000 | `002032e8da66b7054d40832c6a7a66df79d8d7bcccd5ffa53f5dd1772cb9cb9f3283` |
| 4 | to_local (S) | 6995554 | `0020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db686` |

Transaction (unsigned funding input, as signed by both parties):

```
0200000001bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489000000000070c5b980054a010000000000002200202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f4a01000000000000220020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb39942202000000000000220020a7ad36344b7ed2edf404f505e99b9ff161fc6939e122b956995a4ac5d5fed707c0c62d000000000022002032e8da66b7054d40832c6a7a66df79d8d7bcccd5ffa53f5dd1772cb9cb9f328362be6a0000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db6868281f020
```

`R` commitment signature (`commitment_signed.signature`):

- compact: `2335308ef0bef56849b2dc5b708f1bb4b68fa14f33601ccbdfc4fcac5a89238a5e740090457fd412a7f5041d94985bbfb12c36e8b9461e8f69924d65e22e47ee`
- DER + `SIGHASH_ALL`: `304402202335308ef0bef56849b2dc5b708f1bb4b68fa14f33601ccbdfc4fcac5a89238a02205e740090457fd412a7f5041d94985bbfb12c36e8b9461e8f69924d65e22e47ee01`

`R` HTLC signatures (`commitment_signed.htlc_signature`, 1 sig in BOLT 3 output order, `SIGHASH_SINGLE|ANYONECANPAY` over each voucher's HTLC-timeout transaction, anchor rules: zero fee, input `nSequence = 1`, `nLockTime = T_exp`):

**htlc_signature for voucher 1 (output 2, 546 sat, position 0 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (offered HTLC) | `76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a9145d48935223c344b1e446ac5280c7850196cf97e088ac6851b27568` |
| HTLC-timeout tx (unsigned) | `02000000016fd405cb69cf32914b5de6c56cf73a034c29a1b8472edf5ef6a4d840535ed995020000000001000000012202000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db68600350c00` |
| HTLC-timeout txid | `7891f91a2516efd07b3738c7d3cfccd9ded34dac0cf015af7d131c7df85d5495` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `38d1ed79477fc9ce0d58d8a45d757df45511b32e74a8e167d495bb1de2c886ae` |
| `R` sig (compact) | `e498598f58e7d6c324a92a121481e7cb4567554a59576dcb3a7a096f2a25b58477a64af1659c8aa71dd6918df69445c6eab7542bfcfda1b20ce91d24ec780b4c` |
| `R` sig (DER + `0x83`) | `3045022100e498598f58e7d6c324a92a121481e7cb4567554a59576dcb3a7a096f2a25b584022077a64af1659c8aa71dd6918df69445c6eab7542bfcfda1b20ce91d24ec780b4c83` |

### D.4.7 `H_commit`, `ff_activate`, `H_act`, `ff_activate_ack` (7.5.2, 7.5.4)

| Field | Value |
|---|---|
| `n_R^act` / `txid(C^R)` internal byte order | 43 / `6c5524cdfb79105aa2431263458cc44849c91f1af2218c5bede450935b40b8e3` |
| `n_S^act` / `txid(C^S)` internal byte order | 43 / `6fd405cb69cf32914b5de6c56cf73a034c29a1b8472edf5ef6a4d840535ed995` |
| `H_commit` | `06602b655a1dbeb1059e87e9f8c0fefd89bed2a6501a5df25724e54d1c2e56fe` |

**`ff_activate` (type 55045, 230 bytes, signed by `R`)** (`setup_hash = T_setup`, `book_hash = H_book`, `commit_hash = H_commit`, `epoch_start_height = 790000`)

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `ee6dd8d17879756afb022658cdac3acbd449956d2121e955bd7ac1c7fff51f66` |
| signature (final 64 bytes) | `2938ff94475f468d79e2503c5159adc276699ea1681343cf53169b350b3046ae09015bb2005c24c4f8d9f19649523ed164abbe7f367ff2687cf8a27ebacfff91` |
| SHA256(wire bytes) | `921d58873ec272c8784c5efebdfe4534dd9a72c5053842189ac7afd136046c43` |

Wire bytes:

```
d705bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a48848987cb2b4c1f4e6b9246bc30f7a7cb145dff0ad8b75153061fe08a31344ec15a0d29b3ef77eec90177a34bf4d9785afd1fd6ffb2a28bad4ed571f295fe711c35a96beceabe7c2571353e03fdb7f82e3f4241c2467967ba67c2b9efebf32a4a683906602b655a1dbeb1059e87e9f8c0fefd89bed2a6501a5df25724e54d1c2e56fe000c0df02938ff94475f468d79e2503c5159adc276699ea1681343cf53169b350b3046ae09015bb2005c24c4f8d9f19649523ed164abbe7f367ff2687cf8a27ebacfff91
```

| Field | Value |
|---|---|
| `H_act` | `982ee14fdd19b21558b89adda15b53f54122fc1c5a72bae5ef4261ee154cc776` |

**`ff_activate_ack` (type 55047, 162 bytes, signed by `S`)** (`activation_hash = H_act`)

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `dbd401d4777701a757e466a26f1184e13aec76b44b78aff541820ec9bb4edbcf` |
| signature (final 64 bytes) | `e551b9a3347022ed74ca206fe49684de31f1150e6d3aace73807bf6055b24942176c45fb7eb36a13f2c1e3866e223cef4617b6740621c114f7278f68d283d000` |
| SHA256(wire bytes) | `52754e709395539b366ca52ad8c326baa7c0707a825f37d319ea9b28198bf8a4` |

Wire bytes:

```
d707bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a48848987cb2b4c1f4e6b9246bc30f7a7cb145dff0ad8b75153061fe08a31344ec15a0d982ee14fdd19b21558b89adda15b53f54122fc1c5a72bae5ef4261ee154cc776e551b9a3347022ed74ca206fe49684de31f1150e6d3aace73807bf6055b24942176c45fb7eb36a13f2c1e3866e223cef4617b6740621c114f7278f68d283d000
```

### D.4.8 Force-close claim paths for voucher 1 (9.5.1)

#### D.4.8.1 R's view: HTLC-success transaction for voucher 1 (R claims with t_1)

Spends output 2 of R's commitment (546 sat, received-HTLC script). Zero fee,
`nSequence = 1`, `nLockTime = 0`, single output of the full amount to the CSV-delayed script
(revocation key or R's delayed key after `to_self_delay = 144`). S's signature is the
`htlc_signature` from the setup `commitment_signed` (9.5.3): R needs nothing from S at claim time.

| Field | Value |
|---|---|
| txid | `af00ee0e852a3552ddb4ff97712926b335cb7ecfe839b52ac5207ba80fef80b7` |
| sighash type | R: `SIGHASH_ALL` (0x01); S: `SIGHASH_SINGLE|ANYONECANPAY` (0x83), sighash in the R-view table above |
| sighash signed here | `5672a9ac06a667819cdd9aabe7353883b76a3ed4d45e87efb29c22d94ee26b7d` |
| witness layout | `0 <S htlc sig, DER+0x83> <R htlc sig, DER+0x01> <t_1> <received-HTLC witness script>` |
| R HTLC privkey on this commitment | `29b220f1273050a7c38323ce52e79dc9b44953e6fd8d6f44d39db98bee09644d` |
| R signature (compact) | `f957c9cf60caa17c3283407672f9733d05e13360a1df5238c4ebcac08a7675bf237fdf9107840e18a5172ab28c4e0e1c451995aee2a71e8282036b3327da5084` |
| R signature (DER + 0x01) | `3045022100f957c9cf60caa17c3283407672f9733d05e13360a1df5238c4ebcac08a7675bf0220237fdf9107840e18a5172ab28c4e0e1c451995aee2a71e8282036b3327da508401` |
| S signature (DER + 0x83) | `3044022036edb683af0955bc23cbe069cd3189b345cdc1b17a14a4503d2148bde74a3a7702206b9c978690971e1209de8266810ce432863cbeb890e8933ddf9df900930c345e83` |

Unsigned:

```
02000000016c5524cdfb79105aa2431263458cc44849c91f1af2218c5bede450935b40b8e30200000000010000000122020000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4700000000
```

Witness stack (space-separated; `<>` is the empty element):

```
<> 3044022036edb683af0955bc23cbe069cd3189b345cdc1b17a14a4503d2148bde74a3a7702206b9c978690971e1209de8266810ce432863cbeb890e8933ddf9df900930c345e83 3045022100f957c9cf60caa17c3283407672f9733d05e13360a1df5238c4ebcac08a7675bf0220237fdf9107840e18a5172ab28c4e0e1c451995aee2a71e8282036b3327da508401 70dc8fdc7219f79d7e9fd225046385b269d08c4cd539a06d3de8c88cc1bd0898 76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a9145d48935223c344b1e446ac5280c7850196cf97e088527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568
```

Fully signed (serialized with witness):

```
020000000001016c5524cdfb79105aa2431263458cc44849c91f1af2218c5bede450935b40b8e30200000000010000000122020000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce470500473044022036edb683af0955bc23cbe069cd3189b345cdc1b17a14a4503d2148bde74a3a7702206b9c978690971e1209de8266810ce432863cbeb890e8933ddf9df900930c345e83483045022100f957c9cf60caa17c3283407672f9733d05e13360a1df5238c4ebcac08a7675bf0220237fdf9107840e18a5172ab28c4e0e1c451995aee2a71e8282036b3327da5084012070dc8fdc7219f79d7e9fd225046385b269d08c4cd539a06d3de8c88cc1bd08988e76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a9145d48935223c344b1e446ac5280c7850196cf97e088527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b2756800000000
```

#### D.4.8.2 R's view: S's direct timeout spend of voucher 1 after T_exp

Spends the same output 2 through the received-HTLC script's timeout branch:
`nLockTime = T_exp`, `nSequence = 1` (the anchor CSV; also what makes CLTV enforceable),
200 sat nominal fee, remainder to S's sweep P2WPKH. No second-level transaction and no
signature from R: this is how S recovers an unclaimed voucher if R never returns (9.5.1).
beignet builder: `buildRemoteHtlcTimeoutClaimTx` + `buildRemoteHtlcTimeoutWitness`.

| Field | Value |
|---|---|
| txid | `d3a1fcc04ff31aadbaecbed517c1b0760a4b6b544370a1a0fdc17006f6edc629` |
| sighash type | `SIGHASH_ALL` (0x01) |
| sighash signed here | `d29120ad3ffb8815119f6dbdd8b3f1837c5cb553e5072319f19cf331bf741b89` |
| witness layout | `<S htlc sig, DER+0x01> <> <received-HTLC witness script>` (the empty element fails `OP_SIZE 32 OP_EQUAL`, selecting the timeout branch) |
| S HTLC privkey on this commitment | `3bff71454cc58337552426935ac5a512513695b46bdce52b6874db50d67e30fc` |
| S signature (compact) | `4b6f4f73a6e56642b3b18e28f195361a623f137797a5a04b470d2349b9f3b19578b59cb2ca50563484c5014fb38882649bd69d10c7fe35c658004ed227e5679c` |
| destination (S sweep P2WPKH) | `001414dc9d213971a3b25a3d6ee821b7bb9c5881f93b` |

Unsigned:

```
02000000016c5524cdfb79105aa2431263458cc44849c91f1af2218c5bede450935b40b8e3020000000001000000015a0100000000000016001414dc9d213971a3b25a3d6ee821b7bb9c5881f93b00350c00
```

Witness stack (space-separated; `<>` is the empty element):

```
304402204b6f4f73a6e56642b3b18e28f195361a623f137797a5a04b470d2349b9f3b195022078b59cb2ca50563484c5014fb38882649bd69d10c7fe35c658004ed227e5679c01 <> 76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a9145d48935223c344b1e446ac5280c7850196cf97e088527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568
```

Fully signed (serialized with witness):

```
020000000001016c5524cdfb79105aa2431263458cc44849c91f1af2218c5bede450935b40b8e3020000000001000000015a0100000000000016001414dc9d213971a3b25a3d6ee821b7bb9c5881f93b0347304402204b6f4f73a6e56642b3b18e28f195361a623f137797a5a04b470d2349b9f3b195022078b59cb2ca50563484c5014fb38882649bd69d10c7fe35c658004ed227e5679c01008e76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a9145d48935223c344b1e446ac5280c7850196cf97e088527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b2756800350c00
```

#### D.4.8.3 S's view: R's direct preimage claim of voucher 1

Spends output 2 of S's commitment (546 sat, offered-HTLC script) through the
preimage branch with R's own key and `t_1`: no second-stage signature is needed (9.5.1).
`nSequence = 1` (anchor CSV), `nLockTime = 0`, 200 sat nominal fee, remainder to R's sweep P2WPKH.
beignet builder: `buildRemoteHtlcPreimageClaimTx` + `buildRemoteHtlcPreimageWitness`.

| Field | Value |
|---|---|
| txid | `34573df58bec04b3834aa30d9101c86d2715307725032995e0623757cbd60a39` |
| sighash type | `SIGHASH_ALL` (0x01) |
| sighash signed here | `db5aaf03cfde6e9a0ef605eeb67e38a4c20211c930deb0f563c3719689e60989` |
| witness layout | `<R htlc sig, DER+0x01> <t_1> <offered-HTLC witness script>` |
| R HTLC privkey on this commitment | `50fc1cf359e5cb8cf5cd0cab20c32ef9b97514332ec8672ec30d8bb408d5a1e0` |
| R signature (compact) | `92f30e286ab4c7228edfc1f1c05b8739d9cb7902061ff3f9375a5d17a45c8d247f0623fbb8eade8694456ae7788a260660f721695a925ba86dd5732b1000de47` |
| destination (R sweep P2WPKH) | `00142912535a2c1e5ff06a41e0e70341c839d40cfbd3` |

Unsigned:

```
02000000016fd405cb69cf32914b5de6c56cf73a034c29a1b8472edf5ef6a4d840535ed995020000000001000000015a010000000000001600142912535a2c1e5ff06a41e0e70341c839d40cfbd300000000
```

Witness stack (space-separated; `<>` is the empty element):

```
304502210092f30e286ab4c7228edfc1f1c05b8739d9cb7902061ff3f9375a5d17a45c8d2402207f0623fbb8eade8694456ae7788a260660f721695a925ba86dd5732b1000de4701 70dc8fdc7219f79d7e9fd225046385b269d08c4cd539a06d3de8c88cc1bd0898 76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a9145d48935223c344b1e446ac5280c7850196cf97e088ac6851b27568
```

Fully signed (serialized with witness):

```
020000000001016fd405cb69cf32914b5de6c56cf73a034c29a1b8472edf5ef6a4d840535ed995020000000001000000015a010000000000001600142912535a2c1e5ff06a41e0e70341c839d40cfbd30348304502210092f30e286ab4c7228edfc1f1c05b8739d9cb7902061ff3f9375a5d17a45c8d2402207f0623fbb8eade8694456ae7788a260660f721695a925ba86dd5732b1000de47012070dc8fdc7219f79d7e9fd225046385b269d08c4cd539a06d3de8c88cc1bd08988876a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a9145d48935223c344b1e446ac5280c7850196cf97e088ac6851b2756800000000
```

#### D.4.8.4 S's view: HTLC-timeout transaction for voucher 1 (S recovers after T_exp)

Spends output 2 of S's commitment. Zero fee, `nSequence = 1`, `nLockTime = T_exp = 800000`,
single output of the full amount to the CSV-delayed script (revocation key or S's delayed key
after `to_self_delay = 144`). R's signature is the `htlc_signature` R sent in its setup
`commitment_signed` (9.5.1 step 4).

| Field | Value |
|---|---|
| txid | `7891f91a2516efd07b3738c7d3cfccd9ded34dac0cf015af7d131c7df85d5495` |
| sighash type | S: `SIGHASH_ALL` (0x01); R: `SIGHASH_SINGLE|ANYONECANPAY` (0x83), sighash in the S-view table above |
| sighash signed here | `96796981e1b2cc0b0b7c34bf66f27be99287f1c5a811b7bc0e8ca8faa46a6a8e` |
| witness layout | `0 <R htlc sig, DER+0x83> <S htlc sig, DER+0x01> <> <offered-HTLC witness script>` |
| S HTLC privkey on this commitment | `fe4bbc9895cc32b31c294b8d763a8637b413f591d4f020982b06e293c8c135b1` |
| S signature (compact) | `3089cd334a25baf06e3632bb640c3848e435911a3ddd732e1cec9ba80a6527747d29579d94f382ff45266f38fbe23b3cb1cbd0329a65b88e6a703e6fc4e1bf10` |
| S signature (DER + 0x01) | `304402203089cd334a25baf06e3632bb640c3848e435911a3ddd732e1cec9ba80a65277402207d29579d94f382ff45266f38fbe23b3cb1cbd0329a65b88e6a703e6fc4e1bf1001` |
| R signature (DER + 0x83) | `3045022100e498598f58e7d6c324a92a121481e7cb4567554a59576dcb3a7a096f2a25b584022077a64af1659c8aa71dd6918df69445c6eab7542bfcfda1b20ce91d24ec780b4c83` |

Unsigned:

```
02000000016fd405cb69cf32914b5de6c56cf73a034c29a1b8472edf5ef6a4d840535ed995020000000001000000012202000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db68600350c00
```

Witness stack (space-separated; `<>` is the empty element):

```
<> 3045022100e498598f58e7d6c324a92a121481e7cb4567554a59576dcb3a7a096f2a25b584022077a64af1659c8aa71dd6918df69445c6eab7542bfcfda1b20ce91d24ec780b4c83 304402203089cd334a25baf06e3632bb640c3848e435911a3ddd732e1cec9ba80a65277402207d29579d94f382ff45266f38fbe23b3cb1cbd0329a65b88e6a703e6fc4e1bf1001 <> 76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a9145d48935223c344b1e446ac5280c7850196cf97e088ac6851b27568
```

Fully signed (serialized with witness):

```
020000000001016fd405cb69cf32914b5de6c56cf73a034c29a1b8472edf5ef6a4d840535ed995020000000001000000012202000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db6860500483045022100e498598f58e7d6c324a92a121481e7cb4567554a59576dcb3a7a096f2a25b584022077a64af1659c8aa71dd6918df69445c6eab7542bfcfda1b20ce91d24ec780b4c8347304402203089cd334a25baf06e3632bb640c3848e435911a3ddd732e1cec9ba80a65277402207d29579d94f382ff45266f38fbe23b3cb1cbd0329a65b88e6a703e6fc4e1bf1001008876a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a9145d48935223c344b1e446ac5280c7850196cf97e088ac6851b2756800350c00
```

### D.4.9 The refused amount

A book carrying `d_k = 545999` msat is refused at 9.5.1 step 2 with `ff_abort` (reason 2 or 3) and never reaches step 3: no HTLC is built and no commitment exists for it. The generator asserts both refusals:

- d = 545999 < min_payment_msat = 546000 (7.1)
- floor(d / 1000) = 545 sat < dust_limit 546 sat: the output would trim (8, 7.6)

## D.5 K = 483, the BOLT 2 maximum, minimal equal amounts

`K = 483 = max_accepted_htlcs`, every voucher at the floor `546,000` msat
(`budget_msat = 263,718,000`). This section is abbreviated: the messages
are given as sizes plus the SHA256 of their wire bytes, the commitments as
txids plus their non-voucher outputs, and only vouchers 1 and 483 in full.
Everything omitted is reproduced by the generator. Note that 483 equal
amounts make BOLT 3 order the voucher outputs purely by scriptPubKey, so
voucher 1 and voucher 483 land at output indices unrelated to `k`.

### D.5.1 Parameters

| Parameter | Value |
|---|---|
| funder / opener | `S` |
| `epoch_id` | `57d51e11b3a8feac73e8ea58aa6824b7bba69e045416f6ba4a586348adc40da6` |
| `K` (`max_payments`) | 483 |
| `voucher_amounts_msat` (TLV 9, `d_1..d_483`) | 483 x 546000 |
| `budget_msat` (= sum) | 263718000 |
| `min_payment_msat` | 546000 |
| `T_exp` / `D` | 800000 / 798992 |
| `fee_base_msat` / `fee_proportional_millionths` | 1000 / 5000 |
| `G` / `variant` / `profile` | 0 / 4 / 1 |
| `s_htlc_id_base` (`ff_accept` TLV 7) | 0 |
| `n0` (`ff_accept`) | 42 |
| commitment fee at the frozen rate, 483 outputs (paid by `S`) | 210500 sat (+ 660 sat anchors) |
| pre-round balance `S` / `R` | 7000000000 / 3000000000 msat |
| `S` balance after the round | 6736282000 msat |

Vouchers (`fee_S` and `gross_into_S` per 7.6 are what the payer's HTLC must deliver; they never appear on the channel):

| k | d_k (msat) | output (sat) | fee_S(d_k) | gross_into_S(d_k) | s_htlc_id_k | preimage t_k (S only) | H_k |
|---|---|---|---|---|---|---|---|
| 1 | 546000 | 546 | 3730 | 549730 | 0 | `4a248bc87020dceb535314eb837aa562a9d765d7333bae404d7d84f3dfec16f5` | `7305b11a874bbd995b29b11d109eff432402136904a3bab1f7bd9f869109cfc1` |
| ... | | | | | | | |
| 483 | 546000 | 546 | 3730 | 549730 | 482 | `48282b3fc3a365d0affa637cd3097b70ad602b8f2a365031fc20fbe173fe0c4a` | `7498c3f78d908282db2e0ad1a117dad769c93569014fa2500d266959dc58f9d7` |

`r_per_commitment_points` is empty under Variant D (7.1: count 0). `R`'s per-commitment point for commitment number 43, which `S` holds from `R`'s last `revoke_and_ack`, is `03dcd6df1422406c9e57514174169f8219e69e77605ee0de483f5c3bac773d6a58`.

### D.5.2 Setup checks (7.1, 7.2, 7.5.3, 7.6, 8, 9.5.1 bounds)

All checked at `ff_accept` and rechecked at `ff_activate`; every row is a hard assertion in the generator.

| Check | Values | Result |
|---|---|---|
| variant == 4, G == 0, TLVs 1/3/5 absent from ff_init | variant 4, G 0 | pass |
| sum(d_k) == budget_msat | 263718000 msat | pass |
| K <= 483 and K <= R max_accepted_htlcs | K = 483 | pass |
| sum(d_k) <= R max_htlc_value_in_flight_msat | 263718000 <= 5000000000 | pass |
| every d_k >= min_payment_msat | min d_k = 546000 >= 546000 | pass |
| every d_k >= htlc_minimum_msat | min d_k = 546000 >= 1 | pass |
| no d_k trims (floor(d_k/1000) >= dust_limit, zero second-level fee under anchors) | min output 546 sat >= 546 | pass |
| no overflow: d_k * fee_ppm and gross_into_S(d_k) <= 2^64 - 1 | max d_k * ppm = 2730000000 | pass |
| S holds budget + S channel_reserve spendable | 7000000 sat >= 263718 + 10000 | pass |
| funder (S) covers fee(K=483) + anchors at the frozen rate above its reserve | 6736282 - 10000 >= 210500 + 660 | pass |
| funder (S) fee-spike buffer: fee(K=483) at 2 x feerate + anchors above its reserve | 6736282 - 10000 >= 421000 + 660 | pass |
| S post-round balance >= S channel_reserve; R post-round balance >= R channel_reserve only when R funds | S 6525122 sat, R 3000000 sat (S funds: R not applied), reserve 10000 | pass |
| T_exp - D >= claim_margin (1008) | 800000 - 798992 = 1008 | pass |
| s_htlc_id_k = s_htlc_id_base + k - 1 | ids 0 .. 482 | pass |

### D.5.3 `ff_init` and `ff_accept` (7.1, 7.2)

**`ff_init` (type 55001, 4043 bytes, signed by `R`)**

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `e67a54d0640f1ee8ad34824092393e23b72a75e1423aca375d268afa03575c93` |
| signature (final 64 bytes) | `17a3e152d4dca7cfe072f02634463aa789ac5e5a0c4dbaed0ce8cb7baf418ffa25f7b1a4f8d10e36916250b3cb6098ca4fb177335d1c24c78ed9e69cc3939805` |
| SHA256(wire bytes) | `5158dc207f210dacb4756e8d31a3b8a20f95130cfe085fa7b52cbd637b43888b` |

Wire bytes (first 160 bytes; the full 4043 bytes are reproduced by the generator):

```
d6d9bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a48848957d51e11b3a8feac73e8ea58aa6824b7bba69e045416f6ba4a586348adc40da604000000000fb8047001e300000000000854d0000c3110000c3500000003e8000013880000000000000000000009fd0f1800000000000854d000000000000854d000000000000854d000000000000854d000000000000854d00000000000...
```

| Field | Value |
|---|---|
| `T_init` | `e0c80af58e7643d04abbd00763600d69e7ad33429020676adae4d4d341201b3e` |

**`ff_accept` (type 55003, 19510 bytes, signed by `S`)** (TLV 1 hashes, TLV 7 `s_htlc_id_base`, TLV 9 byte-identical to `ff_init`'s, TLV 11 = `T_init`)

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `97ec120f3a4456d2b4aa2ddad430203d2094068fb868d18b936070c2cf0ff589` |
| signature (final 64 bytes) | `8f809b84eb46a8e2f6891931ceb07e375c8f7df92beae625f3a2193c77a1f5da52bf64dd15d0231dbb13c5594a519c0eaee2ed23ff4d269a9919b204c3aae789` |
| SHA256(wire bytes) | `5b9d7c2c17530f1d0821a7d53f1f6358f04b785b73cfd6516c8e0f546a4420c2` |

Wire bytes (first 160 bytes; the full 19510 bytes are reproduced by the generator):

```
d6dbbef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a48848957d51e11b3a8feac73e8ea58aa6824b7bba69e045416f6ba4a586348adc40da6000000000000002a01fd3c607305b11a874bbd995b29b11d109eff432402136904a3bab1f7bd9f869109cfc1cbf141d9ad3b41938c25083328862acf711291bb47ab53b33dc37898ef9326b462e42ded68912761a397087a1310af972f90...
```

| Field | Value |
|---|---|
| `T_setup` | `e012e565964e65d584adbc7138f1d115f6e00c27a90903e6c1b1657982fe5cff` |

### D.5.4 The voucher book (7.5.3)

`book` is 28050 bytes (`36 + 58 K`): `[32: epoch_id][1: 0x04][1: 0x01][2: K]` then one 58-byte entry per slot.

First and last entries:

```
entry_1:   00017305b11a874bbd995b29b11d109eff432402136904a3bab1f7bd9f869109cfc100000000000854d0000c3500000c31100000000000000000
entry_483: 01e37498c3f78d908282db2e0ad1a117dad769c93569014fa2500d266959dc58f9d700000000000854d0000c3500000c311000000000000001e2
```

| Field | Value |
|---|---|
| `H_book` | `556ddfc432a327526e84bbfe843070d8fca46b05d25b3a0dfccd406ec4f03a29` |
| SHA256(book) (for cross-checking an encoder without the tag) | `72428b399ea18aca466f8633debc54e4aea5478e7bbf799098ff2d8720ded2e3` |

### D.5.5 `update_add_htlc` and the voucher onions (9.5.1 step 3)

`S` sends one stock `update_add_htlc` per slot in `k` order. `R` recognises a
voucher by `(id, amount_msat, payment_hash, cltv_expiry)` matching the book and
parks it; the onion is decodable but never acted on.

| k | id | amount_msat | payment_hash | cltv_expiry | payment_secret (final payload) | onion session key | onion ephemeral pubkey |
|---|---|---|---|---|---|---|---|
| 1 | 0 | 546000 | `7305b11a874bbd995b29b11d109eff432402136904a3bab1f7bd9f869109cfc1` | 800000 | `4de75289f3fe57c630a3b959e7b47ac3e506a9dafe4a1db7b384e76d7c325130` | `9454dbeea9bc25a50e1636a3d0a4e5c2c3473faaa2344cbb7ecb9ef83c3d8eb4` | `035d7a40b6a01ce17e34030c55dac43b4479636628fde98a165631b0c8f16090d0` |
| ... | | | | | | | |
| 483 | 482 | 546000 | `7498c3f78d908282db2e0ad1a117dad769c93569014fa2500d266959dc58f9d7` | 800000 | `bb60263d285e61e724b372429afa4ed577a116193150931df42130ef4b76527d` | `28eba5397b6dece25e32cdb1858bd72a812e69589fd7bf3ce148d5bcbcfd0052` | `03be93dd935ed296eceebfb815e5e6ccaeefff7b68b87d3412954542190e259ec6` |

Voucher 1's complete `update_add_htlc` (1452 bytes; the final 1366 bytes are the onion packet, whose first byte is the version 0x00 and whose next 33 are the ephemeral pubkey above). Final hop payload: `{amt_to_forward = 546000, outgoing_cltv_value = 800000, payment_data = {payment_secret, total_msat = 546000}}`, TLV types 2, 4, 8.

```
0080bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489000000000000000000000000000854d07305b11a874bbd995b29b11d109eff432402136904a3bab1f7bd9f869109cfc1000c350000035d7a40b6a01ce17e34030c55dac43b4479636628fde98a165631b0c8f16090d05659d818703bf8c2ac9b58ca5eec5992edd095d32a3ddc5bc67b980f30157bb181918558b9040dfb5e5107e603c58a98af890dea0d3b67829aab02df770b732868b857fad36f252c3ccfc74b2d52e6f707ab23354497528dc76f58ddb41c17372e1892f7d93966b20e8efcd5366154a17d6c6cd13360fa4fbab22d5b7499ef62d33bd2c242ac62323f5d57043bca00edaa8b6cb507e26dbbf6adafeddaa6c4acaf2dee9412c52c919ba192ddae6ebf63167c25bd8ead1f97b7b5603961c61f27b682495234dd3843a8d83b085f11cb249f889d82b6b86ac74b13723f223f3c1df29502e0eb4846200b97e8227c7c0ff16921c4f036974889687d75f4f04f9ea615c32da7cff5073167982a7cdffa6bc2f444483f82a991cc733f5b849cc6644cef3b286eec1233f337dd053be701f3108ec81a802b6a8180af046a417f97f48e66e9b6dc2682b9274246af695c777acd89686568529d2f76a4ca1e2da68a4632c38050ce98a6d0e09d7ed0841b5b9b57123a5567c1e0b74e0e3473a91a5fd3cd3d6e03971d5087bf99e4a515dae0be64d1f0523e7c80fedff3d2bdf32609ad9aed787e039279e679f72a51c85c7826d8ca7d60496867eedfd4ea2c594ed327d3e06ddcf193dfc3dc82c818c74a094454eb86ec6ab8a4ab50a9f231eec32c256877e648f9c71a933eb08762997ef2a0b47137c40ed6ea865b3f3d1ead7694944b349e8c198e3ae36f47530f69f5efd40b9ed4a9bea1b3e09bb216adf8a688137b2f66ec2d706d6db87733c67136e6451a021e39a06f021b602333f5ab18be076a458f8614ceee999cab87a6872d218ccbdb91549560b86bf411850bab66c82954851108d9a0b4f18a719690c20c91ef7531a9547ef071949beddf74f7b61c5f5c8bd0784bcea82e8a8cffb851a6dc8f288b816ea55102dea33a3a4da6f300b8d3ba38db5765a9376cae85b1054a9dc05bfbb009a1838fc6273649a189ae1abd02c1e62e28a8d7a83620dc65e74e52e94971f62dd552f7bf1aa95673b9e51df6d623933857a59904b044f8ce0a764f71291227b64030eedc2002231ccf38d453c2df95b357113158efda36e18b7a90a32a3a9226d9f8dbbdbe169e6a4d9f43010b052b19796e438c40eb4d99d903e44060b3a123f0ef28908dac6715fbe151ddfa120b45f9705d05539f1eced8ab738526a93e394e594c343623bd49bc191814dbc116541146b2aae9791290439fb7652b0eb60531f4239e89762ffa960a0aa37a804b92dc0f824a0d68a6340fd0ded5ce3fca65bbc1fda0efa97a4d99a75032de2a1e39187d89f87daba14a627c44f2c3d25a3983b75f9154c77d734a6742b46bf4af9f3341b7387e40ecc86e9e44e90463b3382eb2f9ff27d0226e3acf203591531e969aa9b15ade63f28f95b23f2542e61fc80ba725aa6c1ec3874090531ec5c7305aaf1162a6b61ae814837d971f8d6872b4fe117f003266b7f452e265014e71f507a0627fe7d760b9c08ce504aae33307890816636d48f9d9922828fc3503b3f33809b7a9ea1ddce958edb432e8dd16316cd40a16ada30b097036f3275991e03a2ec19f9db768b361e437d3bcb8c2140329b205bd4fc79cc9cf9d1030ea371a4a122fcd2b54fdf48505eda2ed70c52175ba8376a2404813f93c7aa1dce3fadb2a2f5683214684c4f3ad03d4112241534f86e89c841f77871b56dd99c23813376fe433c20399b3e5289eaa754b020ddc955b285915f5f6ddf310599970a2b3055619225808a04e5104f5d0eeb1b2fd65000e5699948ec053f4526c8600b09bcc1e8f7db48ea95ec306d7a23cf529a8000f3de5a15d3ce522ca12f86562c9e785070205557559cb33aa5b99f41a13b491e738d4
```

### D.5.6 Both commitment views after the round (9.5.1 steps 4 and 5)

#### D.5.6.1 `R`'s view: commitment 43, 483 received HTLCs (S-offered), signed by `S`

| Field | Value |
|---|---|
| commitment number (R) | 43 |
| `per_commitment_point_R[43]` | `03dcd6df1422406c9e57514174169f8219e69e77605ee0de483f5c3bac773d6a58` |
| obscured commitment number | `0xb9c570f08182` |
| commitment fee (paid by `S`) | 210500 sat + 660 sat anchors |
| txid | `d4ae250f8ba68050afa86748ffc464788239a4c713d054dd29158a6dbb42d831` |
| txid (internal byte order, as hashed into `H_commit`) | `31d842bb6d8a1529dd54d013c7a439827864c4ff4867a8af5080a68b0f25aed4` |
| SHA256(tx bytes) | `2184e8639656900a6f280b632d5777ecf5b5cd0df68a16a53aa4731303be21a2` |
| revocation pubkey | `026b4fc56f8fe8e877de96e178e7ca33106e876168a18e785f0b6d212a46a5408d` |
| R delayed pubkey (`to_local`) | `02f2ce48e632060212999887dbc79d7b51a6f186ad35d4030df3e827fa2fa741c3` |
| R HTLC pubkey | `034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea` |
| S HTLC pubkey | `02b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b4892` |
| `to_remote` key (static, = S payment basepoint) | `032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991` |

Outputs (BOLT 3 order):

| # | Output | Amount (sat) | scriptPubKey |
|---|---|---|---|
| 0 | anchor (R) | 330 | `00202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f` |
| 1 | anchor (S) | 330 | `0020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994` |
| ... | 481 further voucher outputs | 546 each | (ordered by scriptPubKey) |
| 44 | voucher_1 (received HTLC, S-offered) | 546 | `00201655322d6d33ff4c26034904bfe951afa2eeb7c3cf5732076f08cccfd89da592` |
| 448 | voucher_483 (received HTLC, S-offered) | 546 | `0020f03ec02385c0b0e4b13d1a3d58efd148c71656d46da1e2b465c446824db6238c` |
| 485 | to_local (R) | 3000000 | `00202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce47` |
| 486 | to_remote (S) | 6525122 | `0020f3394e1e619b0eca1f91be2fb5ab4dfc59ba5b84ebe014ad1d43a564d012994a` |

Transaction hex omitted (20994 bytes); it is reproduced by the generator and pinned by the txid and SHA256 above.

`S` commitment signature (`commitment_signed.signature`):

- compact: `5199301fd2ed3e50f93eb4b0153cd7171ae77dc92797ab8baf9b166c08c1e792300d9fb8731445631dbe96052aa4cd3676850aeb557ed09e332cf0e9874f3ea6`
- DER + `SIGHASH_ALL`: `304402205199301fd2ed3e50f93eb4b0153cd7171ae77dc92797ab8baf9b166c08c1e7920220300d9fb8731445631dbe96052aa4cd3676850aeb557ed09e332cf0e9874f3ea601`

`S` HTLC signatures (`commitment_signed.htlc_signature`, 483 sigs in BOLT 3 output order, `SIGHASH_SINGLE|ANYONECANPAY` over each voucher's HTLC-success transaction, anchor rules: zero fee, input `nSequence = 1`):

**htlc_signature for voucher 1 (output 44, 546 sat, position 42 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (received HTLC, `cltv_expiry` 800000) | `76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91477b67519cb4c20fe56fe1440d8c748980739fbad88527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568` |
| HTLC-success tx (unsigned) | `020000000131d842bb6d8a1529dd54d013c7a439827864c4ff4867a8af5080a68b0f25aed42c00000000010000000122020000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4700000000` |
| HTLC-success txid | `ee7f8ed338ab505bc88c3a8a2b70a28c2319f09c933a3144f74d4092ea3acbc6` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `fa565135536ffbc62959abe1221b1be237294db339dd036abd1c256b9580a60f` |
| `S` sig (compact) | `4c82c209bccb9caaef1957177ca85021ae936ca12713f6a93f2d81519202254915192bdeececb9ebfb0299dcd6ca8b99d73393f1edea1b9c1853d4d541353885` |
| `S` sig (DER + `0x83`) | `304402204c82c209bccb9caaef1957177ca85021ae936ca12713f6a93f2d815192022549022015192bdeececb9ebfb0299dcd6ca8b99d73393f1edea1b9c1853d4d54135388583` |

**htlc_signature for voucher 483 (output 448, 546 sat, position 446 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (received HTLC, `cltv_expiry` 800000) | `76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a914bce3c0bb69b0947a374879aa86109f211f9764a688527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568` |
| HTLC-success tx (unsigned) | `020000000131d842bb6d8a1529dd54d013c7a439827864c4ff4867a8af5080a68b0f25aed4c001000000010000000122020000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4700000000` |
| HTLC-success txid | `f263f5426e96671f19b6e86fed553cc8328a57dbc9ebee2888988b80cc4f6b38` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `582512387f55ca289eb6c992b8e20dcded1a7f509aa49083d7381d98132cb4de` |
| `S` sig (compact) | `46f4d09c74f0b5e192ea56be14fecc7eabac3e0852f297b90ed333fa09fbbfe73ac67581b58fe926b2f3a02d15f641c93e5491d022201702ec4f004e32cbf368` |
| `S` sig (DER + `0x83`) | `3044022046f4d09c74f0b5e192ea56be14fecc7eabac3e0852f297b90ed333fa09fbbfe702203ac67581b58fe926b2f3a02d15f641c93e5491d022201702ec4f004e32cbf36883` |

#### D.5.6.2 `S`'s view: commitment 43, 483 offered HTLCs, signed by `R`

| Field | Value |
|---|---|
| commitment number (S) | 43 |
| `per_commitment_point_S[43]` | `03b8e3a5a49272d52e232ce62d0ff46700f79509f62923a3f73244986410abc346` |
| obscured commitment number | `0xb9c570f08182` |
| commitment fee (paid by `S`) | 210500 sat + 660 sat anchors |
| txid | `092b8c1cc495341572eef36e3cf4bab7f91ff52660d9050f1d85577561ab72b7` |
| txid (internal byte order, as hashed into `H_commit`) | `b772ab617557851d0f05d96026f51ff9b7baf43c6ef3ee72153495c41c8c2b09` |
| SHA256(tx bytes) | `d304308d6a06ca286be600b7c15b4f4875bb93111bce7e6bc8f2486327987e49` |
| revocation pubkey | `03087846de1985dbf9947be7a2ceafa799eecb09eb5da03744b4ed66eefeca7d16` |
| S delayed pubkey (`to_local`) | `02eb5d86711bb1e6a3bb08d8787e0bb334995bb75172a1599c0dc91436448eaa50` |
| S HTLC pubkey | `02f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c` |
| R HTLC pubkey | `0249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c` |
| `to_remote` key (static, = R payment basepoint) | `034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa` |

Outputs (BOLT 3 order):

| # | Output | Amount (sat) | scriptPubKey |
|---|---|---|---|
| 0 | anchor (R) | 330 | `00202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f` |
| 1 | anchor (S) | 330 | `0020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994` |
| ... | 481 further voucher outputs | 546 each | (ordered by scriptPubKey) |
| 29 | voucher_483 (offered HTLC) | 546 | `00200a0d3d5defcb361bf5e3de1e867e7dfff5084fd35cfd614fc59a3edb69b0936e` |
| 230 | voucher_1 (offered HTLC) | 546 | `00207d7034419600c83622ca92a76514df7576bd86446803bcc2f22e2a49ab5af457` |
| 485 | to_remote (R) | 3000000 | `002032e8da66b7054d40832c6a7a66df79d8d7bcccd5ffa53f5dd1772cb9cb9f3283` |
| 486 | to_local (S) | 6525122 | `0020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db686` |

Transaction hex omitted (20994 bytes); it is reproduced by the generator and pinned by the txid and SHA256 above.

`R` commitment signature (`commitment_signed.signature`):

- compact: `f9cc1eda139168d6ca5c1af69dccd5c1084f16d42db38e2e10691020bc3966f54a947ba26392abddf76d9aaae5be042fc87c78fdb28b92d2f63a28001fdeaddb`
- DER + `SIGHASH_ALL`: `3045022100f9cc1eda139168d6ca5c1af69dccd5c1084f16d42db38e2e10691020bc3966f502204a947ba26392abddf76d9aaae5be042fc87c78fdb28b92d2f63a28001fdeaddb01`

`R` HTLC signatures (`commitment_signed.htlc_signature`, 483 sigs in BOLT 3 output order, `SIGHASH_SINGLE|ANYONECANPAY` over each voucher's HTLC-timeout transaction, anchor rules: zero fee, input `nSequence = 1`, `nLockTime = T_exp`):

**htlc_signature for voucher 1 (output 230, 546 sat, position 228 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (offered HTLC) | `76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91477b67519cb4c20fe56fe1440d8c748980739fbad88ac6851b27568` |
| HTLC-timeout tx (unsigned) | `0200000001b772ab617557851d0f05d96026f51ff9b7baf43c6ef3ee72153495c41c8c2b09e60000000001000000012202000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db68600350c00` |
| HTLC-timeout txid | `ec93a6840af2601e5df52337c6cb747a67df1cf006a27c8d0efc7e437db31ab5` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `bdee2cf74a91dacc9f4df379754335d2f422128983e34342fd5996bb8b7ecafc` |
| `R` sig (compact) | `662744377ce5aca7f22896bcb960a336817f6a36d5d1cd65c2dad26e7591f7d8289b19e92128729880e44aeb0ccd5bada916475fea3b82d33342657a925cd0eb` |
| `R` sig (DER + `0x83`) | `30440220662744377ce5aca7f22896bcb960a336817f6a36d5d1cd65c2dad26e7591f7d80220289b19e92128729880e44aeb0ccd5bada916475fea3b82d33342657a925cd0eb83` |

**htlc_signature for voucher 483 (output 29, 546 sat, position 27 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (offered HTLC) | `76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a914bce3c0bb69b0947a374879aa86109f211f9764a688ac6851b27568` |
| HTLC-timeout tx (unsigned) | `0200000001b772ab617557851d0f05d96026f51ff9b7baf43c6ef3ee72153495c41c8c2b091d0000000001000000012202000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db68600350c00` |
| HTLC-timeout txid | `fe303f83abb92020cbf35da3a2534851cfae62f335b8270846a0ef3627f584ec` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `96514eeef01ab4a4e335a33e26c38904907d4c82d6b86dc336be5caf7ac7b8da` |
| `R` sig (compact) | `d9b293d3cd220cb631b14ef802acef72ed9fa6b90e148f68026b39a4e0fdc2d41311f06f906efada8acda126b986b8bb72a424fa3a41ebae82657b713ce8e143` |
| `R` sig (DER + `0x83`) | `3045022100d9b293d3cd220cb631b14ef802acef72ed9fa6b90e148f68026b39a4e0fdc2d402201311f06f906efada8acda126b986b8bb72a424fa3a41ebae82657b713ce8e14383` |

### D.5.7 `H_commit`, `ff_activate`, `H_act`, `ff_activate_ack` (7.5.2, 7.5.4)

| Field | Value |
|---|---|
| `n_R^act` / `txid(C^R)` internal byte order | 43 / `31d842bb6d8a1529dd54d013c7a439827864c4ff4867a8af5080a68b0f25aed4` |
| `n_S^act` / `txid(C^S)` internal byte order | 43 / `b772ab617557851d0f05d96026f51ff9b7baf43c6ef3ee72153495c41c8c2b09` |
| `H_commit` | `61034010d3510c0a44a53e0ef4a086226bfa039708f944ce4da9833f1ad5e5f3` |

**`ff_activate` (type 55045, 230 bytes, signed by `R`)** (`setup_hash = T_setup`, `book_hash = H_book`, `commit_hash = H_commit`, `epoch_start_height = 790000`)

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `5f091ba6fd125e5a1d65e6cadd95b8d0ea5062b427abc2c373c0778b372b5451` |
| signature (final 64 bytes) | `5779c6f246b9d57721a604df34edb76ca1669844ee5799dc2eadacb6ba6d531254e954c09d705cdf51e5ea9728528cccc4af0bdebe4dd29853e8315e96edca63` |
| SHA256(wire bytes) | `f1a2399dc4a9a9bc31a5323c6edd1043710d4fd54e297cbf8126b680166e9afb` |

Wire bytes:

```
d705bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a48848957d51e11b3a8feac73e8ea58aa6824b7bba69e045416f6ba4a586348adc40da6e012e565964e65d584adbc7138f1d115f6e00c27a90903e6c1b1657982fe5cff556ddfc432a327526e84bbfe843070d8fca46b05d25b3a0dfccd406ec4f03a2961034010d3510c0a44a53e0ef4a086226bfa039708f944ce4da9833f1ad5e5f3000c0df05779c6f246b9d57721a604df34edb76ca1669844ee5799dc2eadacb6ba6d531254e954c09d705cdf51e5ea9728528cccc4af0bdebe4dd29853e8315e96edca63
```

| Field | Value |
|---|---|
| `H_act` | `7d36f8f1728a75368594fed88f57f4b24113c1a76d673264b1a2b89c4a233365` |

**`ff_activate_ack` (type 55047, 162 bytes, signed by `S`)** (`activation_hash = H_act`)

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `0cf337766a9befe7679ad7c2628c40054cc1854c39011dca2260d86ad3eb8670` |
| signature (final 64 bytes) | `8196bbac6ca9362246f559f4c15d5645ef908635dc460bdaea0f3e8e860460215c584b017c77a3a2254a39d5832206367aa74cd262def4e8a819c60a2360b988` |
| SHA256(wire bytes) | `b399a87525eb3634d1fd283109542ac8f9c8bbdf5b4c074671bd7f514bbc5489` |

Wire bytes:

```
d707bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a48848957d51e11b3a8feac73e8ea58aa6824b7bba69e045416f6ba4a586348adc40da67d36f8f1728a75368594fed88f57f4b24113c1a76d673264b1a2b89c4a2333658196bbac6ca9362246f559f4c15d5645ef908635dc460bdaea0f3e8e860460215c584b017c77a3a2254a39d5832206367aa74cd262def4e8a819c60a2360b988
```

### D.5.8 Force-close claim paths for voucher 1 (9.5.1)

#### D.5.8.1 R's view: HTLC-success transaction for voucher 1 (R claims with t_1)

Spends output 44 of R's commitment (546 sat, received-HTLC script). Zero fee,
`nSequence = 1`, `nLockTime = 0`, single output of the full amount to the CSV-delayed script
(revocation key or R's delayed key after `to_self_delay = 144`). S's signature is the
`htlc_signature` from the setup `commitment_signed` (9.5.3): R needs nothing from S at claim time.

| Field | Value |
|---|---|
| txid | `ee7f8ed338ab505bc88c3a8a2b70a28c2319f09c933a3144f74d4092ea3acbc6` |
| sighash type | R: `SIGHASH_ALL` (0x01); S: `SIGHASH_SINGLE|ANYONECANPAY` (0x83), sighash in the R-view table above |
| sighash signed here | `a34263b35cacec3cda12a79ef6a594da270c78e5f747b2c6ee9d002deb7613a9` |
| witness layout | `0 <S htlc sig, DER+0x83> <R htlc sig, DER+0x01> <t_1> <received-HTLC witness script>` |
| R HTLC privkey on this commitment | `29b220f1273050a7c38323ce52e79dc9b44953e6fd8d6f44d39db98bee09644d` |
| R signature (compact) | `67f204ac6b456900d3a7f2a90bc8637bf43edd667d287b47b8691bce156a243663746bc95b49a1e5c9c2182c594aa64e1ae6ee5eae219444ac1cf84b2fcee096` |
| R signature (DER + 0x01) | `3044022067f204ac6b456900d3a7f2a90bc8637bf43edd667d287b47b8691bce156a2436022063746bc95b49a1e5c9c2182c594aa64e1ae6ee5eae219444ac1cf84b2fcee09601` |
| S signature (DER + 0x83) | `304402204c82c209bccb9caaef1957177ca85021ae936ca12713f6a93f2d815192022549022015192bdeececb9ebfb0299dcd6ca8b99d73393f1edea1b9c1853d4d54135388583` |

Unsigned:

```
020000000131d842bb6d8a1529dd54d013c7a439827864c4ff4867a8af5080a68b0f25aed42c00000000010000000122020000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4700000000
```

Witness stack (space-separated; `<>` is the empty element):

```
<> 304402204c82c209bccb9caaef1957177ca85021ae936ca12713f6a93f2d815192022549022015192bdeececb9ebfb0299dcd6ca8b99d73393f1edea1b9c1853d4d54135388583 3044022067f204ac6b456900d3a7f2a90bc8637bf43edd667d287b47b8691bce156a2436022063746bc95b49a1e5c9c2182c594aa64e1ae6ee5eae219444ac1cf84b2fcee09601 4a248bc87020dceb535314eb837aa562a9d765d7333bae404d7d84f3dfec16f5 76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91477b67519cb4c20fe56fe1440d8c748980739fbad88527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568
```

Fully signed (serialized with witness):

```
0200000000010131d842bb6d8a1529dd54d013c7a439827864c4ff4867a8af5080a68b0f25aed42c00000000010000000122020000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce47050047304402204c82c209bccb9caaef1957177ca85021ae936ca12713f6a93f2d815192022549022015192bdeececb9ebfb0299dcd6ca8b99d73393f1edea1b9c1853d4d54135388583473044022067f204ac6b456900d3a7f2a90bc8637bf43edd667d287b47b8691bce156a2436022063746bc95b49a1e5c9c2182c594aa64e1ae6ee5eae219444ac1cf84b2fcee09601204a248bc87020dceb535314eb837aa562a9d765d7333bae404d7d84f3dfec16f58e76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91477b67519cb4c20fe56fe1440d8c748980739fbad88527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b2756800000000
```

#### D.5.8.2 R's view: S's direct timeout spend of voucher 1 after T_exp

Spends the same output 44 through the received-HTLC script's timeout branch:
`nLockTime = T_exp`, `nSequence = 1` (the anchor CSV; also what makes CLTV enforceable),
200 sat nominal fee, remainder to S's sweep P2WPKH. No second-level transaction and no
signature from R: this is how S recovers an unclaimed voucher if R never returns (9.5.1).
beignet builder: `buildRemoteHtlcTimeoutClaimTx` + `buildRemoteHtlcTimeoutWitness`.

| Field | Value |
|---|---|
| txid | `cb983cd62090cb1bd3c7098dcc8a28fc394bc48c243f3c832ba0806bfe3d2163` |
| sighash type | `SIGHASH_ALL` (0x01) |
| sighash signed here | `688a6b2c3a38f917f0358f9bc941774e697e84096af9065b8e7b4f7857f74072` |
| witness layout | `<S htlc sig, DER+0x01> <> <received-HTLC witness script>` (the empty element fails `OP_SIZE 32 OP_EQUAL`, selecting the timeout branch) |
| S HTLC privkey on this commitment | `3bff71454cc58337552426935ac5a512513695b46bdce52b6874db50d67e30fc` |
| S signature (compact) | `5c2e02a8a7ea3c72a864c44d4a5776e95128298ff4ce325ecf1b37767f712a4c4c896ede6b71a06af1f51f7d0ef432d8dec26e52049cfad31bf7c860b492042a` |
| destination (S sweep P2WPKH) | `001414dc9d213971a3b25a3d6ee821b7bb9c5881f93b` |

Unsigned:

```
020000000131d842bb6d8a1529dd54d013c7a439827864c4ff4867a8af5080a68b0f25aed42c0000000001000000015a0100000000000016001414dc9d213971a3b25a3d6ee821b7bb9c5881f93b00350c00
```

Witness stack (space-separated; `<>` is the empty element):

```
304402205c2e02a8a7ea3c72a864c44d4a5776e95128298ff4ce325ecf1b37767f712a4c02204c896ede6b71a06af1f51f7d0ef432d8dec26e52049cfad31bf7c860b492042a01 <> 76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91477b67519cb4c20fe56fe1440d8c748980739fbad88527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568
```

Fully signed (serialized with witness):

```
0200000000010131d842bb6d8a1529dd54d013c7a439827864c4ff4867a8af5080a68b0f25aed42c0000000001000000015a0100000000000016001414dc9d213971a3b25a3d6ee821b7bb9c5881f93b0347304402205c2e02a8a7ea3c72a864c44d4a5776e95128298ff4ce325ecf1b37767f712a4c02204c896ede6b71a06af1f51f7d0ef432d8dec26e52049cfad31bf7c860b492042a01008e76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a91477b67519cb4c20fe56fe1440d8c748980739fbad88527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b2756800350c00
```

#### D.5.8.3 S's view: R's direct preimage claim of voucher 1

Spends output 230 of S's commitment (546 sat, offered-HTLC script) through the
preimage branch with R's own key and `t_1`: no second-stage signature is needed (9.5.1).
`nSequence = 1` (anchor CSV), `nLockTime = 0`, 200 sat nominal fee, remainder to R's sweep P2WPKH.
beignet builder: `buildRemoteHtlcPreimageClaimTx` + `buildRemoteHtlcPreimageWitness`.

| Field | Value |
|---|---|
| txid | `20712cb3c75a3bb085e6462c7bd49dd2d774705a8998ba686a9d5c24e293a65f` |
| sighash type | `SIGHASH_ALL` (0x01) |
| sighash signed here | `e365f2cb01b7fd89a811ce1e0989acbc74e3f14bf4636240b4cf48aeabff76c7` |
| witness layout | `<R htlc sig, DER+0x01> <t_1> <offered-HTLC witness script>` |
| R HTLC privkey on this commitment | `50fc1cf359e5cb8cf5cd0cab20c32ef9b97514332ec8672ec30d8bb408d5a1e0` |
| R signature (compact) | `4dc3cddc0fc09e4bfd9c6d8e76790d73a08fb4e5cb7889a32f7fe0efbc55436846c63446a1b518d9c82a2cc9f2817a6e23dd1c2c42906f0665e69bad628135fa` |
| destination (R sweep P2WPKH) | `00142912535a2c1e5ff06a41e0e70341c839d40cfbd3` |

Unsigned:

```
0200000001b772ab617557851d0f05d96026f51ff9b7baf43c6ef3ee72153495c41c8c2b09e60000000001000000015a010000000000001600142912535a2c1e5ff06a41e0e70341c839d40cfbd300000000
```

Witness stack (space-separated; `<>` is the empty element):

```
304402204dc3cddc0fc09e4bfd9c6d8e76790d73a08fb4e5cb7889a32f7fe0efbc554368022046c63446a1b518d9c82a2cc9f2817a6e23dd1c2c42906f0665e69bad628135fa01 4a248bc87020dceb535314eb837aa562a9d765d7333bae404d7d84f3dfec16f5 76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91477b67519cb4c20fe56fe1440d8c748980739fbad88ac6851b27568
```

Fully signed (serialized with witness):

```
02000000000101b772ab617557851d0f05d96026f51ff9b7baf43c6ef3ee72153495c41c8c2b09e60000000001000000015a010000000000001600142912535a2c1e5ff06a41e0e70341c839d40cfbd30347304402204dc3cddc0fc09e4bfd9c6d8e76790d73a08fb4e5cb7889a32f7fe0efbc554368022046c63446a1b518d9c82a2cc9f2817a6e23dd1c2c42906f0665e69bad628135fa01204a248bc87020dceb535314eb837aa562a9d765d7333bae404d7d84f3dfec16f58876a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91477b67519cb4c20fe56fe1440d8c748980739fbad88ac6851b2756800000000
```

#### D.5.8.4 S's view: HTLC-timeout transaction for voucher 1 (S recovers after T_exp)

Spends output 230 of S's commitment. Zero fee, `nSequence = 1`, `nLockTime = T_exp = 800000`,
single output of the full amount to the CSV-delayed script (revocation key or S's delayed key
after `to_self_delay = 144`). R's signature is the `htlc_signature` R sent in its setup
`commitment_signed` (9.5.1 step 4).

| Field | Value |
|---|---|
| txid | `ec93a6840af2601e5df52337c6cb747a67df1cf006a27c8d0efc7e437db31ab5` |
| sighash type | S: `SIGHASH_ALL` (0x01); R: `SIGHASH_SINGLE|ANYONECANPAY` (0x83), sighash in the S-view table above |
| sighash signed here | `b4598f7b39078852efd823a4f7662a9dbe9f7f42f393a2ae32cb51c484a02293` |
| witness layout | `0 <R htlc sig, DER+0x83> <S htlc sig, DER+0x01> <> <offered-HTLC witness script>` |
| S HTLC privkey on this commitment | `fe4bbc9895cc32b31c294b8d763a8637b413f591d4f020982b06e293c8c135b1` |
| S signature (compact) | `8f558bd25b844792a42bb3307633e681abdcf54aa83563fd846c69ebc0d523ca664cca050019db7eae3650fe81b59193ac5bb302a30255a20ea931b1807a3614` |
| S signature (DER + 0x01) | `30450221008f558bd25b844792a42bb3307633e681abdcf54aa83563fd846c69ebc0d523ca0220664cca050019db7eae3650fe81b59193ac5bb302a30255a20ea931b1807a361401` |
| R signature (DER + 0x83) | `30440220662744377ce5aca7f22896bcb960a336817f6a36d5d1cd65c2dad26e7591f7d80220289b19e92128729880e44aeb0ccd5bada916475fea3b82d33342657a925cd0eb83` |

Unsigned:

```
0200000001b772ab617557851d0f05d96026f51ff9b7baf43c6ef3ee72153495c41c8c2b09e60000000001000000012202000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db68600350c00
```

Witness stack (space-separated; `<>` is the empty element):

```
<> 30440220662744377ce5aca7f22896bcb960a336817f6a36d5d1cd65c2dad26e7591f7d80220289b19e92128729880e44aeb0ccd5bada916475fea3b82d33342657a925cd0eb83 30450221008f558bd25b844792a42bb3307633e681abdcf54aa83563fd846c69ebc0d523ca0220664cca050019db7eae3650fe81b59193ac5bb302a30255a20ea931b1807a361401 <> 76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91477b67519cb4c20fe56fe1440d8c748980739fbad88ac6851b27568
```

Fully signed (serialized with witness):

```
02000000000101b772ab617557851d0f05d96026f51ff9b7baf43c6ef3ee72153495c41c8c2b09e60000000001000000012202000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db68605004730440220662744377ce5aca7f22896bcb960a336817f6a36d5d1cd65c2dad26e7591f7d80220289b19e92128729880e44aeb0ccd5bada916475fea3b82d33342657a925cd0eb834830450221008f558bd25b844792a42bb3307633e681abdcf54aa83563fd846c69ebc0d523ca0220664cca050019db7eae3650fe81b59193ac5bb302a30255a20ea931b1807a361401008876a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a91477b67519cb4c20fe56fe1440d8c748980739fbad88ac6851b2756800350c00
```

## D.6 K = 1, S opener and funder, R holds zero pre-epoch balance

The motivating case: `S` opened and funds the channel, holds all 10,000,000
sat, and `R` has received nothing yet (a fresh inbound-only channel). One
voucher of 1,000,000 msat, as in D.1. Because `R`'s balance is 0 msat, BOLT 3
omits its main output on both views (`to_local` on `R`'s view, `to_remote`
on `S`'s view: 0 sat is below `dust_limit`); its anchor is still present
because the commitment carries an untrimmed HTLC. Section 8 constrains only
the funder's balance by its reserve when `S` funds, so `R`'s zero balance
is legal and the setup-checks row for `R` reads "not applied". The voucher
output, both signatures and every claim path are unaffected: `R`'s claim
needs only the HTLC output and `t_1`, never a main output.

### D.6.1 Parameters

| Parameter | Value |
|---|---|
| funder / opener | `S` |
| `epoch_id` | `75ac6c4567bb853d69517b2fe7660700e83262c129fb80c5f3e7b8705d2b2f93` |
| `K` (`max_payments`) | 1 |
| `voucher_amounts_msat` (TLV 9, `d_1..d_1`) | 1000000 |
| `budget_msat` (= sum) | 1000000 |
| `min_payment_msat` | 546000 |
| `T_exp` / `D` | 800000 / 798992 |
| `fee_base_msat` / `fee_proportional_millionths` | 1000 / 5000 |
| `G` / `variant` / `profile` | 0 / 4 / 1 |
| `s_htlc_id_base` (`ff_accept` TLV 7) | 0 |
| `n0` (`ff_accept`) | 42 |
| commitment fee at the frozen rate, 1 outputs (paid by `S`) | 3240 sat (+ 660 sat anchors) |
| pre-round balance `S` / `R` | 10000000000 / 0 msat |
| `S` balance after the round | 9999000000 msat |

Vouchers (`fee_S` and `gross_into_S` per 7.6 are what the payer's HTLC must deliver; they never appear on the channel):

| k | d_k (msat) | output (sat) | fee_S(d_k) | gross_into_S(d_k) | s_htlc_id_k | preimage t_k (S only) | H_k |
|---|---|---|---|---|---|---|---|
| 1 | 1000000 | 1000 | 6000 | 1006000 | 0 | `2844e487856ac207d67b8c1c60ed43adf76cd50df7262fba665046fc4a6762db` | `64c356aaa2f7789a1ddf82024f18b37dfc22b4fb3ec7583ab7b09f8a9ad1312a` |

`r_per_commitment_points` is empty under Variant D (7.1: count 0). `R`'s per-commitment point for commitment number 43, which `S` holds from `R`'s last `revoke_and_ack`, is `03dcd6df1422406c9e57514174169f8219e69e77605ee0de483f5c3bac773d6a58`.

### D.6.2 Setup checks (7.1, 7.2, 7.5.3, 7.6, 8, 9.5.1 bounds)

All checked at `ff_accept` and rechecked at `ff_activate`; every row is a hard assertion in the generator.

| Check | Values | Result |
|---|---|---|
| variant == 4, G == 0, TLVs 1/3/5 absent from ff_init | variant 4, G 0 | pass |
| sum(d_k) == budget_msat | 1000000 msat | pass |
| K <= 483 and K <= R max_accepted_htlcs | K = 1 | pass |
| sum(d_k) <= R max_htlc_value_in_flight_msat | 1000000 <= 5000000000 | pass |
| every d_k >= min_payment_msat | min d_k = 1000000 >= 546000 | pass |
| every d_k >= htlc_minimum_msat | min d_k = 1000000 >= 1 | pass |
| no d_k trims (floor(d_k/1000) >= dust_limit, zero second-level fee under anchors) | min output 1000 sat >= 546 | pass |
| no overflow: d_k * fee_ppm and gross_into_S(d_k) <= 2^64 - 1 | max d_k * ppm = 5000000000 | pass |
| S holds budget + S channel_reserve spendable | 10000000 sat >= 1000 + 10000 | pass |
| funder (S) covers fee(K=1) + anchors at the frozen rate above its reserve | 9999000 - 10000 >= 3240 + 660 | pass |
| funder (S) fee-spike buffer: fee(K=1) at 2 x feerate + anchors above its reserve | 9999000 - 10000 >= 6480 + 660 | pass |
| S post-round balance >= S channel_reserve; R post-round balance >= R channel_reserve only when R funds | S 9995100 sat, R 0 sat (S funds: R not applied), reserve 10000 | pass |
| T_exp - D >= claim_margin (1008) | 800000 - 798992 = 1008 | pass |
| s_htlc_id_k = s_htlc_id_base + k - 1 | ids 0 .. 0 | pass |

### D.6.3 `ff_init` and `ff_accept` (7.1, 7.2)

**`ff_init` (type 55001, 185 bytes, signed by `R`)**

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `c053e3b3ff31663cf662877df0842c2feec803e4ad3f12afa4f4ae509cca1977` |
| signature (final 64 bytes) | `e0e99ff77a29e85142624109ed949a2beb6a35de044c32f884e22a67f72308526065b8e983625c675361332e2a10fa506af6b402b069471921b4a366765edf7f` |
| SHA256(wire bytes) | `5dda21bd776f1b3d6f7cacb898efd95e31a8a04e48dae35484789bad50330da4` |

Wire bytes:

```
d6d9bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a48848975ac6c4567bb853d69517b2fe7660700e83262c129fb80c5f3e7b8705d2b2f930400000000000f4240000100000000000854d0000c3110000c3500000003e80000138800000000000000000000090800000000000f4240e0e99ff77a29e85142624109ed949a2beb6a35de044c32f884e22a67f72308526065b8e983625c675361332e2a10fa506af6b402b069471921b4a366765edf7f
```

| Field | Value |
|---|---|
| `T_init` | `d290b308abba2f4346a5fb0e2477d54eada86eb455d298a14570a8c90aae4d7d` |

**`ff_accept` (type 55003, 226 bytes, signed by `S`)** (TLV 1 hashes, TLV 7 `s_htlc_id_base`, TLV 9 byte-identical to `ff_init`'s, TLV 11 = `T_init`)

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `401bec4f4270953ac17cc840efbe59b461e3a848a0546cf71d70da91779f06ae` |
| signature (final 64 bytes) | `5ff3c9076c82f18847c629529938cb5d03cf3136d8b87be432f9ed0bc81a40e231a83a0146d5c1d0473cc11990623ca31ab3defa22e9c96142fc6340e55aac23` |
| SHA256(wire bytes) | `e468c2f7dd682266f067ded7eb0143ae441ce50d0c7395b822d7ee3234fd1706` |

Wire bytes:

```
d6dbbef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a48848975ac6c4567bb853d69517b2fe7660700e83262c129fb80c5f3e7b8705d2b2f93000000000000002a012064c356aaa2f7789a1ddf82024f18b37dfc22b4fb3ec7583ab7b09f8a9ad1312a07080000000000000000090800000000000f42400b20d290b308abba2f4346a5fb0e2477d54eada86eb455d298a14570a8c90aae4d7d5ff3c9076c82f18847c629529938cb5d03cf3136d8b87be432f9ed0bc81a40e231a83a0146d5c1d0473cc11990623ca31ab3defa22e9c96142fc6340e55aac23
```

| Field | Value |
|---|---|
| `T_setup` | `eb4e7e4a56d8612ce7dddd7ed5b8b31d22a9c394560909d5f0a8a7cfc6fb5a71` |

### D.6.4 The voucher book (7.5.3)

`book` is 94 bytes (`36 + 58 K`): `[32: epoch_id][1: 0x04][1: 0x01][2: K]` then one 58-byte entry per slot.

```
75ac6c4567bb853d69517b2fe7660700e83262c129fb80c5f3e7b8705d2b2f9304010001000164c356aaa2f7789a1ddf82024f18b37dfc22b4fb3ec7583ab7b09f8a9ad1312a00000000000f4240000c3500000c31100000000000000000
```

| Field | Value |
|---|---|
| `H_book` | `dc2a6687c21e580e3cacc642c8f877ded7278fc9b87e7b388ecee30142ecebb7` |
| SHA256(book) (for cross-checking an encoder without the tag) | `d1b61ba182ae323465c118d86fd290b7faba1d329c8fd2006cc18cb1d78fe53d` |

### D.6.5 `update_add_htlc` and the voucher onions (9.5.1 step 3)

`S` sends one stock `update_add_htlc` per slot in `k` order. `R` recognises a
voucher by `(id, amount_msat, payment_hash, cltv_expiry)` matching the book and
parks it; the onion is decodable but never acted on.

| k | id | amount_msat | payment_hash | cltv_expiry | payment_secret (final payload) | onion session key | onion ephemeral pubkey |
|---|---|---|---|---|---|---|---|
| 1 | 0 | 1000000 | `64c356aaa2f7789a1ddf82024f18b37dfc22b4fb3ec7583ab7b09f8a9ad1312a` | 800000 | `f61995d0e7142641fc4bf477cb6af28804c40ceb08ffe53a474e4e40d7e46821` | `cbaeef22da81010955857ca73ba631cb61977e0e79c2d7252838feedd63ce96d` | `036d963ac16876fd39cc211026293cc7bd8238e9ed675fc032fc02403526509276` |

Voucher 1's complete `update_add_htlc` (1452 bytes; the final 1366 bytes are the onion packet, whose first byte is the version 0x00 and whose next 33 are the ephemeral pubkey above). Final hop payload: `{amt_to_forward = 1000000, outgoing_cltv_value = 800000, payment_data = {payment_secret, total_msat = 1000000}}`, TLV types 2, 4, 8.

```
0080bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489000000000000000000000000000f424064c356aaa2f7789a1ddf82024f18b37dfc22b4fb3ec7583ab7b09f8a9ad1312a000c350000036d963ac16876fd39cc211026293cc7bd8238e9ed675fc032fc02403526509276ba2fd650301e89fb51004817df6752211d1c790a460d02279ea294290a84c09bc4859593321c4b4c13cab08aa2241427b86c9df639bea29f6f20dee65ac6bfcb71bc2d3dd348bb7d62a3fffa704485e7e18334950a23e6e0271f1f720089d4307e8d1c0c660e2634303dcbe66aa2be6b9975a04a0b0b9a783d326620b3e7e97a127b9d0693f5bc1c8d44ad99c0cd27eda7a12cba3ba17cfb7c5654b8a33135fbb4fa2120417cbd90dc0e3d5751c0dc5cd55f60304024e4672ea8d8d212f41e3e1196a12e5b93e454ab4ac458db90a46fe1dc7854c92baebcc603e3d587585114027b3de8297d5b4840eec9fbd74e5eb69349d2d9d2cf33b2afdbc37aa16552d64e1d84778a150a59c39989910400a31881746e1f652670dc8e6bad4520cb6fefc4321c96245046188515a789804a39eba326bf9c42b673156abebd193d40ab35cb531c45e1358ba45d957cd2cf24020a89ac4e7b0636d4b3931832bad40b4b392a9856b2b2acef4f17d00d8fac9bbae68271576097a971af2e2e92f86a3d2a0e64aee38fc9ebecedd9ea5fbecbae7d957f0abff65a2b8ae07018d2bd7677ab9531c2eef52afe5513c134af3575fa0f2ab13e768cb8e534d4e6b5d78437b7e347fe2c247eb7efeb5983641c57d879744478a0e6069e65e2f2d6fde9d3f4af1337dec034bea238626fd082c395f7f7e9aec52365d9e7b0d2e5fbdc9d652b8b64d767702e0c8efc33ce5214a440bed404ee539a4ee702116aacc3a4c662fc04765af24de6364905a48491509a51119b6b45d9e40a2d17815c7bc4dd4784cdacf8acff303736f589f6e29cd7fb0eb3db42d2015ebc9713647cfef3bc4e16d65e743364da9dba65bb8fb6bdd1498725884e24fcfdbe886dc6631c968c472913b3dd90a1689e8bc34cc202bde4c81342c5747d36b4d75a5b25a38c7bd28b70c01040cbfc40a9de66f1041fff8ed6cfa6fc7f2ecb3142a9be99038b12b4720f09f797716322488e76abcd9688a8529f49b153c2cd2557e6c00f675fb1d8a44625de6d4198dc9481931a9616a1f91b1d69290950d6226757750956f18ce498bd4d619d3348520f4e3f09d99eb727e832eaf28d07c62106f88a64bec8400c02eb6e2352c85f3b68676799dfe09a1e903263b7f1e947d0db5d92927c9fc2fd90297c875a15eb24396cb7849ef8094e4eafb4c389c4a018b67003cf16138280be1168b31a0d6a906da867e6cce593850aa4f7b8ee46c0f1e424d8569539a6f83d1072c60cc3d2a9f06b2609e2c7287b421830a5b08bb6f17fbebed030bcfd90b1dca3018517589f935c0ddba6432c3cd994664d52a15db03717b551996a11d86e6357b3f71555d42148b0d6cc5d2a44ff8b020977de58fda9dc823307f5cb57172af1955aa35131777c2153168ee6cd0ec084fa80b1a6fde37c679b8b3d2e984124054dd4d0ed0e59d35a1c9c81968bd8df08ec0bc8ddab6a7d07f5ab3f3d731f77849618b785f8ae47e807c7a15214b8da9a37124989826abdb5d88814aa197febd8d494e96373a4b2a51112f6d72c87ff241685fafa057f0e7cf378497630ca445105955f8978b185cf223147351a8d50b34e52cf651a4f81d3706cf0b4a39703c24030c410a73121b13b57e8845c3822dc4a1649efe6564d9d57c26dd29d645972ca0200cbebbd9e35ec3aa20570ba13de783301897f02ba685148ca3332057acc7e7324a430faee1f4e2cbe1b2a4d8aeb3b5b0f031f2784c1fcbcf121533c7e868e8d66776bef99a8b88d00ea95daab41ae89a535331b46562b9b401bb674028d14e9530fa2a0229b9a8fa416ad4545d47b099e44433be1013be995d8064bc67e1e23479a87b9ea46b0d316668ff5daef2a7b71c36c89de
```

### D.6.6 Both commitment views after the round (9.5.1 steps 4 and 5)

#### D.6.6.1 `R`'s view: commitment 43, 1 received HTLC (S-offered), signed by `S`

| Field | Value |
|---|---|
| commitment number (R) | 43 |
| `per_commitment_point_R[43]` | `03dcd6df1422406c9e57514174169f8219e69e77605ee0de483f5c3bac773d6a58` |
| obscured commitment number | `0xb9c570f08182` |
| commitment fee (paid by `S`) | 3240 sat + 660 sat anchors |
| txid | `c791e5731fe89640aa2a2f297907acbafa76790e0d567016d192b5a1754b295a` |
| txid (internal byte order, as hashed into `H_commit`) | `5a294b75a1b592d11670560d0e7976fabaac0779292f2aaa4096e81f73e591c7` |
| SHA256(tx bytes) | `579489ea23c5cb999596e86350a106cddd9631108118c322bb82911b83818a3b` |
| revocation pubkey | `026b4fc56f8fe8e877de96e178e7ca33106e876168a18e785f0b6d212a46a5408d` |
| R delayed pubkey (`to_local`) | `02f2ce48e632060212999887dbc79d7b51a6f186ad35d4030df3e827fa2fa741c3` |
| R HTLC pubkey | `034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea` |
| S HTLC pubkey | `02b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b4892` |
| `to_remote` key (static, = S payment basepoint) | `032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991` |

Outputs (BOLT 3 order):

| # | Output | Amount (sat) | scriptPubKey |
|---|---|---|---|
| 0 | anchor (R) | 330 | `00202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f` |
| 1 | anchor (S) | 330 | `0020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994` |
| 2 | voucher_1 (received HTLC, S-offered) | 1000 | `0020aadef237b44946836dbd3f180a0f7f21039bd7d37f5b127dd5404e14b20b5980` |
| 3 | to_remote (S) | 9995100 | `0020f3394e1e619b0eca1f91be2fb5ab4dfc59ba5b84ebe014ad1d43a564d012994a` |

`to_local` (R) is omitted: its balance is 0 msat, below `dust_limit` (BOLT 3). Both anchors remain because the commitment carries an untrimmed HTLC output. The fee and anchors are charged to `S` as usual.

Transaction (unsigned funding input, as signed by both parties):

```
0200000001bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489000000000070c5b980044a010000000000002200202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f4a01000000000000220020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994e803000000000000220020aadef237b44946836dbd3f180a0f7f21039bd7d37f5b127dd5404e14b20b59805c83980000000000220020f3394e1e619b0eca1f91be2fb5ab4dfc59ba5b84ebe014ad1d43a564d012994a8281f020
```

`S` commitment signature (`commitment_signed.signature`):

- compact: `6b859b54906d5e13c2f9f396ff5ea3b2daff8d65d4ba3c48451e87a791886c7406a951548ec51cac9ad3d800c8401e0916b619977c170218c01bac9d2fd53da2`
- DER + `SIGHASH_ALL`: `304402206b859b54906d5e13c2f9f396ff5ea3b2daff8d65d4ba3c48451e87a791886c74022006a951548ec51cac9ad3d800c8401e0916b619977c170218c01bac9d2fd53da201`

`S` HTLC signatures (`commitment_signed.htlc_signature`, 1 sig in BOLT 3 output order, `SIGHASH_SINGLE|ANYONECANPAY` over each voucher's HTLC-success transaction, anchor rules: zero fee, input `nSequence = 1`):

**htlc_signature for voucher 1 (output 2, 1000 sat, position 0 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (received HTLC, `cltv_expiry` 800000) | `76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a914fb718a0b71a64ce29f6c5d3c18e0bc1d9066078888527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568` |
| HTLC-success tx (unsigned) | `02000000015a294b75a1b592d11670560d0e7976fabaac0779292f2aaa4096e81f73e591c702000000000100000001e8030000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4700000000` |
| HTLC-success txid | `c8ffc78fe7ee653ec2cd85f01c1721465c8028a2b178a18114b5746084d5112a` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `9d1986189d1b2452f09d36b468b62f192b5b6e6322f56842be7f531bca00174c` |
| `S` sig (compact) | `f425af4b520b5c85230422bf0369702107f3795faf816d2a361dedcca5fdb48c3563bc4473819a08f556a4e83bfa1c73b33fa33a5dae0d4a507db21c0d5ccc4c` |
| `S` sig (DER + `0x83`) | `3045022100f425af4b520b5c85230422bf0369702107f3795faf816d2a361dedcca5fdb48c02203563bc4473819a08f556a4e83bfa1c73b33fa33a5dae0d4a507db21c0d5ccc4c83` |

#### D.6.6.2 `S`'s view: commitment 43, 1 offered HTLC, signed by `R`

| Field | Value |
|---|---|
| commitment number (S) | 43 |
| `per_commitment_point_S[43]` | `03b8e3a5a49272d52e232ce62d0ff46700f79509f62923a3f73244986410abc346` |
| obscured commitment number | `0xb9c570f08182` |
| commitment fee (paid by `S`) | 3240 sat + 660 sat anchors |
| txid | `82ded787f31a9653b2ff24540d7ab7243f78e8efeee28eeb34cd53132a276ed7` |
| txid (internal byte order, as hashed into `H_commit`) | `d76e272a1353cd34eb8ee2eeefe8783f24b77a0d5424ffb253961af387d7de82` |
| SHA256(tx bytes) | `52c167773d05456ee2183a138767360ebb9da41661bd551899dfda64683fd3ef` |
| revocation pubkey | `03087846de1985dbf9947be7a2ceafa799eecb09eb5da03744b4ed66eefeca7d16` |
| S delayed pubkey (`to_local`) | `02eb5d86711bb1e6a3bb08d8787e0bb334995bb75172a1599c0dc91436448eaa50` |
| S HTLC pubkey | `02f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c` |
| R HTLC pubkey | `0249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c` |
| `to_remote` key (static, = R payment basepoint) | `034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa` |

Outputs (BOLT 3 order):

| # | Output | Amount (sat) | scriptPubKey |
|---|---|---|---|
| 0 | anchor (R) | 330 | `00202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f` |
| 1 | anchor (S) | 330 | `0020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994` |
| 2 | voucher_1 (offered HTLC) | 1000 | `002007c392073b4876a240ea28ce35deb7b65f1ed3f5ff0b3730057041e0b1c46ad1` |
| 3 | to_local (S) | 9995100 | `0020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db686` |

`to_remote` (R) is omitted: its balance is 0 msat, below `dust_limit` (BOLT 3). Both anchors remain because the commitment carries an untrimmed HTLC output. The fee and anchors are charged to `S` as usual.

Transaction (unsigned funding input, as signed by both parties):

```
0200000001bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489000000000070c5b980044a010000000000002200202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f4a01000000000000220020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994e80300000000000022002007c392073b4876a240ea28ce35deb7b65f1ed3f5ff0b3730057041e0b1c46ad15c83980000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db6868281f020
```

`R` commitment signature (`commitment_signed.signature`):

- compact: `1881a361af8ca968e3e7c322525c50a63d7704d6b625bd6d1cfde78c10d2cb125e38a4936f94e72e6ec1075b07ab00b2f59a0ceacf02e395cb73bef7030b8389`
- DER + `SIGHASH_ALL`: `304402201881a361af8ca968e3e7c322525c50a63d7704d6b625bd6d1cfde78c10d2cb1202205e38a4936f94e72e6ec1075b07ab00b2f59a0ceacf02e395cb73bef7030b838901`

`R` HTLC signatures (`commitment_signed.htlc_signature`, 1 sig in BOLT 3 output order, `SIGHASH_SINGLE|ANYONECANPAY` over each voucher's HTLC-timeout transaction, anchor rules: zero fee, input `nSequence = 1`, `nLockTime = T_exp`):

**htlc_signature for voucher 1 (output 2, 1000 sat, position 0 in the list)**

| Field | Value |
|---|---|
| HTLC witness script (offered HTLC) | `76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a914fb718a0b71a64ce29f6c5d3c18e0bc1d9066078888ac6851b27568` |
| HTLC-timeout tx (unsigned) | `0200000001d76e272a1353cd34eb8ee2eeefe8783f24b77a0d5424ffb253961af387d7de8202000000000100000001e803000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db68600350c00` |
| HTLC-timeout txid | `056e8dae2184cb21a5190de3329050790487fd54edb952a2a77d649b428df4ed` |
| sighash (`SINGLE|ANYONECANPAY` = `0x83`) | `76b06226cef5698dfb040a2aaaae338c3799f3a7c29f3be51740615dc322b0b7` |
| `R` sig (compact) | `ee5c7d35c1e6cbab3cc316d10e11defebf1297201a7006d5396cedd8d3ef971a7327cab1bca34d359ba20639807650928f22f767a3ede26f6ed0dde9079766ad` |
| `R` sig (DER + `0x83`) | `3045022100ee5c7d35c1e6cbab3cc316d10e11defebf1297201a7006d5396cedd8d3ef971a02207327cab1bca34d359ba20639807650928f22f767a3ede26f6ed0dde9079766ad83` |

### D.6.7 `H_commit`, `ff_activate`, `H_act`, `ff_activate_ack` (7.5.2, 7.5.4)

| Field | Value |
|---|---|
| `n_R^act` / `txid(C^R)` internal byte order | 43 / `5a294b75a1b592d11670560d0e7976fabaac0779292f2aaa4096e81f73e591c7` |
| `n_S^act` / `txid(C^S)` internal byte order | 43 / `d76e272a1353cd34eb8ee2eeefe8783f24b77a0d5424ffb253961af387d7de82` |
| `H_commit` | `8f19b491169952d5c5852cb9c722ec7f9e52b4bf1627f2c80377f0e7bdbe9287` |

**`ff_activate` (type 55045, 230 bytes, signed by `R`)** (`setup_hash = T_setup`, `book_hash = H_book`, `commit_hash = H_commit`, `epoch_start_height = 790000`)

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `d2f6c13933cec6cd11bf8ad5dbd0913e7d4ecf8eabce0ca0d1b37f97272848f1` |
| signature (final 64 bytes) | `9b032fc561367edc1f08074a67a670db9d5220826d2f5ea2768ea0ae8485bf9367549039a160219ba6393387728aeb66cdf27647fe07d3d201b0c7d2df813051` |
| SHA256(wire bytes) | `5531469deefe57bc381f19a5697d55117cfc007e284638baae4f1b0b46d1922d` |

Wire bytes:

```
d705bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a48848975ac6c4567bb853d69517b2fe7660700e83262c129fb80c5f3e7b8705d2b2f93eb4e7e4a56d8612ce7dddd7ed5b8b31d22a9c394560909d5f0a8a7cfc6fb5a71dc2a6687c21e580e3cacc642c8f877ded7278fc9b87e7b388ecee30142ecebb78f19b491169952d5c5852cb9c722ec7f9e52b4bf1627f2c80377f0e7bdbe9287000c0df09b032fc561367edc1f08074a67a670db9d5220826d2f5ea2768ea0ae8485bf9367549039a160219ba6393387728aeb66cdf27647fe07d3d201b0c7d2df813051
```

| Field | Value |
|---|---|
| `H_act` | `65129deb07cd484e12e9badcbc11dace2e724e9a1ccba6b40ec92d57dbaaf028` |

**`ff_activate_ack` (type 55047, 162 bytes, signed by `S`)** (`activation_hash = H_act`)

| Field | Value |
|---|---|
| digest `SHA256("ffor/msg" || type || body)` | `d41788dbcd7a0ed70a03e60b78902f863bfb7ffee41222f4cb943f83d217d146` |
| signature (final 64 bytes) | `1b127837288c4ae30686b772f13791954b42dafb2b318eba7f91545e3a09089543a8e85aedf462ecd5a1338602329a036c49c41473420ac1f2d2b911898baacc` |
| SHA256(wire bytes) | `1415f328f391aa3b78ba44fd6b41e6940425d6af44e537baeb61a33de60b67ee` |

Wire bytes:

```
d707bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a48848975ac6c4567bb853d69517b2fe7660700e83262c129fb80c5f3e7b8705d2b2f9365129deb07cd484e12e9badcbc11dace2e724e9a1ccba6b40ec92d57dbaaf0281b127837288c4ae30686b772f13791954b42dafb2b318eba7f91545e3a09089543a8e85aedf462ecd5a1338602329a036c49c41473420ac1f2d2b911898baacc
```

### D.6.8 Force-close claim paths for voucher 1 (9.5.1)

#### D.6.8.1 R's view: HTLC-success transaction for voucher 1 (R claims with t_1)

Spends output 2 of R's commitment (1000 sat, received-HTLC script). Zero fee,
`nSequence = 1`, `nLockTime = 0`, single output of the full amount to the CSV-delayed script
(revocation key or R's delayed key after `to_self_delay = 144`). S's signature is the
`htlc_signature` from the setup `commitment_signed` (9.5.3): R needs nothing from S at claim time.

| Field | Value |
|---|---|
| txid | `c8ffc78fe7ee653ec2cd85f01c1721465c8028a2b178a18114b5746084d5112a` |
| sighash type | R: `SIGHASH_ALL` (0x01); S: `SIGHASH_SINGLE|ANYONECANPAY` (0x83), sighash in the R-view table above |
| sighash signed here | `b50e8cbd7a4fee51002ce26759c25abb95c349eb83fb41556dba00bbbf789eef` |
| witness layout | `0 <S htlc sig, DER+0x83> <R htlc sig, DER+0x01> <t_1> <received-HTLC witness script>` |
| R HTLC privkey on this commitment | `29b220f1273050a7c38323ce52e79dc9b44953e6fd8d6f44d39db98bee09644d` |
| R signature (compact) | `47f3ddaba430eae43409581de5f4abc76310cbc1ca75c8a320977be55b0fa81f13eba6036001259826d0dd9bc6df4657f4bd50a714ab8fbd19bb600d4d06bce6` |
| R signature (DER + 0x01) | `3044022047f3ddaba430eae43409581de5f4abc76310cbc1ca75c8a320977be55b0fa81f022013eba6036001259826d0dd9bc6df4657f4bd50a714ab8fbd19bb600d4d06bce601` |
| S signature (DER + 0x83) | `3045022100f425af4b520b5c85230422bf0369702107f3795faf816d2a361dedcca5fdb48c02203563bc4473819a08f556a4e83bfa1c73b33fa33a5dae0d4a507db21c0d5ccc4c83` |

Unsigned:

```
02000000015a294b75a1b592d11670560d0e7976fabaac0779292f2aaa4096e81f73e591c702000000000100000001e8030000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4700000000
```

Witness stack (space-separated; `<>` is the empty element):

```
<> 3045022100f425af4b520b5c85230422bf0369702107f3795faf816d2a361dedcca5fdb48c02203563bc4473819a08f556a4e83bfa1c73b33fa33a5dae0d4a507db21c0d5ccc4c83 3044022047f3ddaba430eae43409581de5f4abc76310cbc1ca75c8a320977be55b0fa81f022013eba6036001259826d0dd9bc6df4657f4bd50a714ab8fbd19bb600d4d06bce601 2844e487856ac207d67b8c1c60ed43adf76cd50df7262fba665046fc4a6762db 76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a914fb718a0b71a64ce29f6c5d3c18e0bc1d9066078888527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568
```

Fully signed (serialized with witness):

```
020000000001015a294b75a1b592d11670560d0e7976fabaac0779292f2aaa4096e81f73e591c702000000000100000001e8030000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce470500483045022100f425af4b520b5c85230422bf0369702107f3795faf816d2a361dedcca5fdb48c02203563bc4473819a08f556a4e83bfa1c73b33fa33a5dae0d4a507db21c0d5ccc4c83473044022047f3ddaba430eae43409581de5f4abc76310cbc1ca75c8a320977be55b0fa81f022013eba6036001259826d0dd9bc6df4657f4bd50a714ab8fbd19bb600d4d06bce601202844e487856ac207d67b8c1c60ed43adf76cd50df7262fba665046fc4a6762db8e76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a914fb718a0b71a64ce29f6c5d3c18e0bc1d9066078888527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b2756800000000
```

#### D.6.8.2 R's view: S's direct timeout spend of voucher 1 after T_exp

Spends the same output 2 through the received-HTLC script's timeout branch:
`nLockTime = T_exp`, `nSequence = 1` (the anchor CSV; also what makes CLTV enforceable),
200 sat nominal fee, remainder to S's sweep P2WPKH. No second-level transaction and no
signature from R: this is how S recovers an unclaimed voucher if R never returns (9.5.1).
beignet builder: `buildRemoteHtlcTimeoutClaimTx` + `buildRemoteHtlcTimeoutWitness`.

| Field | Value |
|---|---|
| txid | `85dd5153a28d6ec637713485b832e952b4782af8a71d7c6ab56223285e5030d2` |
| sighash type | `SIGHASH_ALL` (0x01) |
| sighash signed here | `fe47bcfa2614ca4b108b36ca7669fdf80846b6b0065210a8fd2b8eea4b03b084` |
| witness layout | `<S htlc sig, DER+0x01> <> <received-HTLC witness script>` (the empty element fails `OP_SIZE 32 OP_EQUAL`, selecting the timeout branch) |
| S HTLC privkey on this commitment | `3bff71454cc58337552426935ac5a512513695b46bdce52b6874db50d67e30fc` |
| S signature (compact) | `97e8b384e9f20b948bf59db35557fb8897996839d89a3632a5ca5ebf42461780267ddf20cb3cef235d9a251fa11443228d9e3901cca939214fcffd934c664a07` |
| destination (S sweep P2WPKH) | `001414dc9d213971a3b25a3d6ee821b7bb9c5881f93b` |

Unsigned:

```
02000000015a294b75a1b592d11670560d0e7976fabaac0779292f2aaa4096e81f73e591c702000000000100000001200300000000000016001414dc9d213971a3b25a3d6ee821b7bb9c5881f93b00350c00
```

Witness stack (space-separated; `<>` is the empty element):

```
304502210097e8b384e9f20b948bf59db35557fb8897996839d89a3632a5ca5ebf424617800220267ddf20cb3cef235d9a251fa11443228d9e3901cca939214fcffd934c664a0701 <> 76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a914fb718a0b71a64ce29f6c5d3c18e0bc1d9066078888527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568
```

Fully signed (serialized with witness):

```
020000000001015a294b75a1b592d11670560d0e7976fabaac0779292f2aaa4096e81f73e591c702000000000100000001200300000000000016001414dc9d213971a3b25a3d6ee821b7bb9c5881f93b0348304502210097e8b384e9f20b948bf59db35557fb8897996839d89a3632a5ca5ebf424617800220267ddf20cb3cef235d9a251fa11443228d9e3901cca939214fcffd934c664a0701008e76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a914fb718a0b71a64ce29f6c5d3c18e0bc1d9066078888527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b2756800350c00
```

#### D.6.8.3 S's view: R's direct preimage claim of voucher 1

Spends output 2 of S's commitment (1000 sat, offered-HTLC script) through the
preimage branch with R's own key and `t_1`: no second-stage signature is needed (9.5.1).
`nSequence = 1` (anchor CSV), `nLockTime = 0`, 200 sat nominal fee, remainder to R's sweep P2WPKH.
beignet builder: `buildRemoteHtlcPreimageClaimTx` + `buildRemoteHtlcPreimageWitness`.

| Field | Value |
|---|---|
| txid | `0c18f923ba9c2da30aed8997c827248ea89bded1127fb948e5fccf38c4569753` |
| sighash type | `SIGHASH_ALL` (0x01) |
| sighash signed here | `a92cc5f74ed86fde8192948fb42d7a155fbba8306debb288a589d2a7a1877bbd` |
| witness layout | `<R htlc sig, DER+0x01> <t_1> <offered-HTLC witness script>` |
| R HTLC privkey on this commitment | `50fc1cf359e5cb8cf5cd0cab20c32ef9b97514332ec8672ec30d8bb408d5a1e0` |
| R signature (compact) | `8769a9651e599eb90f0d6344593713aae280e13e2536e35ca6373df06fbc8c3c1637457e94d71fd0eac49fea751f202e3ef32d66cad854133a72fe19fccbca9f` |
| destination (R sweep P2WPKH) | `00142912535a2c1e5ff06a41e0e70341c839d40cfbd3` |

Unsigned:

```
0200000001d76e272a1353cd34eb8ee2eeefe8783f24b77a0d5424ffb253961af387d7de820200000000010000000120030000000000001600142912535a2c1e5ff06a41e0e70341c839d40cfbd300000000
```

Witness stack (space-separated; `<>` is the empty element):

```
30450221008769a9651e599eb90f0d6344593713aae280e13e2536e35ca6373df06fbc8c3c02201637457e94d71fd0eac49fea751f202e3ef32d66cad854133a72fe19fccbca9f01 2844e487856ac207d67b8c1c60ed43adf76cd50df7262fba665046fc4a6762db 76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a914fb718a0b71a64ce29f6c5d3c18e0bc1d9066078888ac6851b27568
```

Fully signed (serialized with witness):

```
02000000000101d76e272a1353cd34eb8ee2eeefe8783f24b77a0d5424ffb253961af387d7de820200000000010000000120030000000000001600142912535a2c1e5ff06a41e0e70341c839d40cfbd3034830450221008769a9651e599eb90f0d6344593713aae280e13e2536e35ca6373df06fbc8c3c02201637457e94d71fd0eac49fea751f202e3ef32d66cad854133a72fe19fccbca9f01202844e487856ac207d67b8c1c60ed43adf76cd50df7262fba665046fc4a6762db8876a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a914fb718a0b71a64ce29f6c5d3c18e0bc1d9066078888ac6851b2756800000000
```

#### D.6.8.4 S's view: HTLC-timeout transaction for voucher 1 (S recovers after T_exp)

Spends output 2 of S's commitment. Zero fee, `nSequence = 1`, `nLockTime = T_exp = 800000`,
single output of the full amount to the CSV-delayed script (revocation key or S's delayed key
after `to_self_delay = 144`). R's signature is the `htlc_signature` R sent in its setup
`commitment_signed` (9.5.1 step 4).

| Field | Value |
|---|---|
| txid | `056e8dae2184cb21a5190de3329050790487fd54edb952a2a77d649b428df4ed` |
| sighash type | S: `SIGHASH_ALL` (0x01); R: `SIGHASH_SINGLE|ANYONECANPAY` (0x83), sighash in the S-view table above |
| sighash signed here | `c3391993f36108b4bc75b493fc6c95952989d8b70299b2c58e4011e9bfc16fde` |
| witness layout | `0 <R htlc sig, DER+0x83> <S htlc sig, DER+0x01> <> <offered-HTLC witness script>` |
| S HTLC privkey on this commitment | `fe4bbc9895cc32b31c294b8d763a8637b413f591d4f020982b06e293c8c135b1` |
| S signature (compact) | `b690a75cef1957f581b5f1faee99c4c95d91fc27022459a4aee1961096e33267237f53a7ce98aff3164be37f5b64d08fde3d022bbc6675af346e52b593723c44` |
| S signature (DER + 0x01) | `3045022100b690a75cef1957f581b5f1faee99c4c95d91fc27022459a4aee1961096e332670220237f53a7ce98aff3164be37f5b64d08fde3d022bbc6675af346e52b593723c4401` |
| R signature (DER + 0x83) | `3045022100ee5c7d35c1e6cbab3cc316d10e11defebf1297201a7006d5396cedd8d3ef971a02207327cab1bca34d359ba20639807650928f22f767a3ede26f6ed0dde9079766ad83` |

Unsigned:

```
0200000001d76e272a1353cd34eb8ee2eeefe8783f24b77a0d5424ffb253961af387d7de8202000000000100000001e803000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db68600350c00
```

Witness stack (space-separated; `<>` is the empty element):

```
<> 3045022100ee5c7d35c1e6cbab3cc316d10e11defebf1297201a7006d5396cedd8d3ef971a02207327cab1bca34d359ba20639807650928f22f767a3ede26f6ed0dde9079766ad83 3045022100b690a75cef1957f581b5f1faee99c4c95d91fc27022459a4aee1961096e332670220237f53a7ce98aff3164be37f5b64d08fde3d022bbc6675af346e52b593723c4401 <> 76a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a914fb718a0b71a64ce29f6c5d3c18e0bc1d9066078888ac6851b27568
```

Fully signed (serialized with witness):

```
02000000000101d76e272a1353cd34eb8ee2eeefe8783f24b77a0d5424ffb253961af387d7de8202000000000100000001e803000000000000220020ffc926acab2a33451aa40abb548de617d2c7fb93751971cfea75fcd5e11db6860500483045022100ee5c7d35c1e6cbab3cc316d10e11defebf1297201a7006d5396cedd8d3ef971a02207327cab1bca34d359ba20639807650928f22f767a3ede26f6ed0dde9079766ad83483045022100b690a75cef1957f581b5f1faee99c4c95d91fc27022459a4aee1961096e332670220237f53a7ce98aff3164be37f5b64d08fde3d022bbc6675af346e52b593723c4401008876a914769f4ef7c85e25eeaba82c3d63a09ce8184c712c8763ac67210249646380c1ecae2acc028b634d4b4355fbf003b61e83c6882f97d12d14bcaf5c7c820120876475527c2102f2a3e20a8725660b4de4deab650fe10559eba33532f89a00dba1f96e4ac85c9c52ae67a914fb718a0b71a64ce29f6c5d3c18e0bc1d9066078888ac6851b2756800350c00
```

## D.7 Verification performed by the generator

Every line below is a hard assertion in the generator: it refuses to emit
this file if any fails. Scenario-tagged lines were checked in that scenario;
untagged lines are cross-scenario or fixture checks.

1. Fixture keys re-derive the BOLT 3 Appendix C funding pubkeys
2. Funding witness script matches Appendix C funding_wscript whichever side is the opener (BOLT 3 lexicographic key order)
3. [D.1] H_1 != SHA256(per_commitment_secret_S[n]) for every n in 0..n0 (7.2 Variant D binding forbidden)
4. [D.1] ff_init: R's node-key signature verifies from the wire bytes alone (strict low-S)
5. [D.1] ff_accept: S's node-key signature verifies from the wire bytes alone (strict low-S)
6. [D.1] ff_accept carries TLV 11 = T_init and a TLV 9 byte-identical to ff_init's
7. [D.1] variant == 4, G == 0, TLVs 1/3/5 absent from ff_init: variant 4, G 0
8. [D.1] sum(d_k) == budget_msat: 1000000 msat
9. [D.1] K <= 483 and K <= R max_accepted_htlcs: K = 1
10. [D.1] sum(d_k) <= R max_htlc_value_in_flight_msat: 1000000 <= 5000000000
11. [D.1] every d_k >= min_payment_msat: min d_k = 1000000 >= 546000
12. [D.1] every d_k >= htlc_minimum_msat: min d_k = 1000000 >= 1
13. [D.1] no d_k trims (floor(d_k/1000) >= dust_limit, zero second-level fee under anchors): min output 1000 sat >= 546
14. [D.1] no overflow: d_k * fee_ppm and gross_into_S(d_k) <= 2^64 - 1: max d_k * ppm = 5000000000
15. [D.1] S holds budget + S channel_reserve spendable: 7000000 sat >= 1000 + 10000
16. [D.1] funder (S) covers fee(K=1) + anchors at the frozen rate above its reserve: 6999000 - 10000 >= 3240 + 660
17. [D.1] funder (S) fee-spike buffer: fee(K=1) at 2 x feerate + anchors above its reserve: 6999000 - 10000 >= 6480 + 660
18. [D.1] S post-round balance >= S channel_reserve; R post-round balance >= R channel_reserve only when R funds: S 6995100 sat, R 3000000 sat (S funds: R not applied), reserve 10000
19. [D.1] T_exp - D >= claim_margin (1008): 800000 - 798992 = 1008
20. [D.1] s_htlc_id_k = s_htlc_id_base + k - 1: ids 0 .. 0
21. [D.1] all 1 voucher onions (1366 bytes, single hop to R's node key, associated data H_k) decode on R's side with beignet's processOnionPacket as a final hop with exactly the 9.5.1 payload
22. [D.1] R-view: R's own rebuild (buildLocalCommitment) is byte-identical to S's construction (buildRemoteCommitment)
23. [D.1] R-view: S's commitment signature verifies (beignet verifyRemoteCommitmentSig)
24. [D.1] R-view: S's 1 htlc_signature(s) verify (beignet verifyRemoteHtlcSignatures)
25. [D.1] R-view: S's commitment signature verifies independently against the BIP 143 sighash of the funding input
26. [D.1] R-view: tx hex round-trips through the decoder to the same txid
27. [D.1] R-view: static_remotekey, to_remote pays S's payment basepoint
28. [D.1] R-view: 1 voucher outputs and 1 htlc_signatures, none trimmed
29. [D.1] R-view: to_local = 3000000 and to_remote = 6995100 sat, i.e. floor(msat balance / 1000) with fee 3240 + anchors 660 charged to the funder (S) and sub-satoshi remainders left to the on-chain fee
30. [D.1] R-view: every voucher output has value floor(d_k / 1000), cltv_expiry T_exp, scriptPubKey = P2WSH of the reconstructed BOLT 3 HTLC script, and S's htlc_signature verifies independently (strict low-S) against the SIGHASH_SINGLE|ANYONECANPAY digest of its HTLC-success transaction
31. [D.1] S-view: S's own rebuild (buildLocalCommitment) is byte-identical to R's construction (buildRemoteCommitment)
32. [D.1] S-view: R's commitment signature verifies (beignet verifyRemoteCommitmentSig)
33. [D.1] S-view: R's 1 htlc_signature(s) verify (beignet verifyRemoteHtlcSignatures)
34. [D.1] S-view: R's commitment signature verifies independently against the BIP 143 sighash of the funding input
35. [D.1] S-view: tx hex round-trips through the decoder to the same txid
36. [D.1] S-view: static_remotekey, to_remote pays R's payment basepoint
37. [D.1] S-view: 1 voucher outputs and 1 htlc_signatures, none trimmed
38. [D.1] S-view: to_local = 6995100 and to_remote = 3000000 sat, i.e. floor(msat balance / 1000) with fee 3240 + anchors 660 charged to the funder (S) and sub-satoshi remainders left to the on-chain fee
39. [D.1] S-view: every voucher output has value floor(d_k / 1000), cltv_expiry T_exp, scriptPubKey = P2WSH of the reconstructed BOLT 3 HTLC script, and R's htlc_signature verifies independently (strict low-S) against the SIGHASH_SINGLE|ANYONECANPAY digest of its HTLC-timeout transaction
40. [D.1] ff_activate: R's node-key signature verifies from the wire bytes alone
41. [D.1] ff_activate_ack: S's node-key signature verifies from the wire bytes alone
42. [D.1] R-view HTLC-success: R's own signature (SIGHASH_ALL) verifies
43. [D.1] R-view HTLC-success: S's setup-time htlc_signature (SINGLE|ANYONECANPAY) verifies over the same transaction
44. [D.1] preimage t_1 hashes to H_1
45. [D.1] R-view direct timeout spend by S: S's signature verifies against the received-HTLC script
46. [D.1] S-view direct preimage claim by R: R's signature verifies against the offered-HTLC script
47. [D.1] S-view HTLC-timeout: S's own signature (SIGHASH_ALL) verifies
48. [D.1] S-view HTLC-timeout: R's setup-time htlc_signature (SINGLE|ANYONECANPAY) verifies over the same transaction
49. [D.2] H_1 != SHA256(per_commitment_secret_S[n]) for every n in 0..n0 (7.2 Variant D binding forbidden)
50. [D.2] ff_init: R's node-key signature verifies from the wire bytes alone (strict low-S)
51. [D.2] ff_accept: S's node-key signature verifies from the wire bytes alone (strict low-S)
52. [D.2] ff_accept carries TLV 11 = T_init and a TLV 9 byte-identical to ff_init's
53. [D.2] variant == 4, G == 0, TLVs 1/3/5 absent from ff_init: variant 4, G 0
54. [D.2] sum(d_k) == budget_msat: 51289250 msat
55. [D.2] K <= 483 and K <= R max_accepted_htlcs: K = 3
56. [D.2] sum(d_k) <= R max_htlc_value_in_flight_msat: 51289250 <= 5000000000
57. [D.2] every d_k >= min_payment_msat: min d_k = 546250 >= 546000
58. [D.2] every d_k >= htlc_minimum_msat: min d_k = 546250 >= 1
59. [D.2] no d_k trims (floor(d_k/1000) >= dust_limit, zero second-level fee under anchors): min output 546 sat >= 546
60. [D.2] no overflow: d_k * fee_ppm and gross_into_S(d_k) <= 2^64 - 1: max d_k * ppm = 248745000000
61. [D.2] S holds budget + S channel_reserve spendable: 7000000 sat >= 51289 + 10000
62. [D.2] funder (S) covers fee(K=3) + anchors at the frozen rate above its reserve: 6948710 - 10000 >= 4100 + 660
63. [D.2] funder (S) fee-spike buffer: fee(K=3) at 2 x feerate + anchors above its reserve: 6948710 - 10000 >= 8200 + 660
64. [D.2] S post-round balance >= S channel_reserve; R post-round balance >= R channel_reserve only when R funds: S 6943950 sat, R 3000000 sat (S funds: R not applied), reserve 10000
65. [D.2] T_exp - D >= claim_margin (1008): 800000 - 798992 = 1008
66. [D.2] s_htlc_id_k = s_htlc_id_base + k - 1: ids 7 .. 9
67. [D.2] all 3 voucher onions (1366 bytes, single hop to R's node key, associated data H_k) decode on R's side with beignet's processOnionPacket as a final hop with exactly the 9.5.1 payload
68. [D.2] R-view: R's own rebuild (buildLocalCommitment) is byte-identical to S's construction (buildRemoteCommitment)
69. [D.2] R-view: S's commitment signature verifies (beignet verifyRemoteCommitmentSig)
70. [D.2] R-view: S's 3 htlc_signature(s) verify (beignet verifyRemoteHtlcSignatures)
71. [D.2] R-view: S's commitment signature verifies independently against the BIP 143 sighash of the funding input
72. [D.2] R-view: tx hex round-trips through the decoder to the same txid
73. [D.2] R-view: static_remotekey, to_remote pays S's payment basepoint
74. [D.2] R-view: 3 voucher outputs and 3 htlc_signatures, none trimmed
75. [D.2] R-view: to_local = 3000000 and to_remote = 6943950 sat, i.e. floor(msat balance / 1000) with fee 4100 + anchors 660 charged to the funder (S) and sub-satoshi remainders left to the on-chain fee
76. [D.2] R-view: every voucher output has value floor(d_k / 1000), cltv_expiry T_exp, scriptPubKey = P2WSH of the reconstructed BOLT 3 HTLC script, and S's htlc_signature verifies independently (strict low-S) against the SIGHASH_SINGLE|ANYONECANPAY digest of its HTLC-success transaction
77. [D.2] S-view: S's own rebuild (buildLocalCommitment) is byte-identical to R's construction (buildRemoteCommitment)
78. [D.2] S-view: R's commitment signature verifies (beignet verifyRemoteCommitmentSig)
79. [D.2] S-view: R's 3 htlc_signature(s) verify (beignet verifyRemoteHtlcSignatures)
80. [D.2] S-view: R's commitment signature verifies independently against the BIP 143 sighash of the funding input
81. [D.2] S-view: tx hex round-trips through the decoder to the same txid
82. [D.2] S-view: static_remotekey, to_remote pays R's payment basepoint
83. [D.2] S-view: 3 voucher outputs and 3 htlc_signatures, none trimmed
84. [D.2] S-view: to_local = 6943950 and to_remote = 3000000 sat, i.e. floor(msat balance / 1000) with fee 4100 + anchors 660 charged to the funder (S) and sub-satoshi remainders left to the on-chain fee
85. [D.2] S-view: every voucher output has value floor(d_k / 1000), cltv_expiry T_exp, scriptPubKey = P2WSH of the reconstructed BOLT 3 HTLC script, and R's htlc_signature verifies independently (strict low-S) against the SIGHASH_SINGLE|ANYONECANPAY digest of its HTLC-timeout transaction
86. [D.2] ff_activate: R's node-key signature verifies from the wire bytes alone
87. [D.2] ff_activate_ack: S's node-key signature verifies from the wire bytes alone
88. [D.2] R-view HTLC-success: R's own signature (SIGHASH_ALL) verifies
89. [D.2] R-view HTLC-success: S's setup-time htlc_signature (SINGLE|ANYONECANPAY) verifies over the same transaction
90. [D.2] preimage t_1 hashes to H_1
91. [D.2] R-view direct timeout spend by S: S's signature verifies against the received-HTLC script
92. [D.2] S-view direct preimage claim by R: R's signature verifies against the offered-HTLC script
93. [D.2] S-view HTLC-timeout: S's own signature (SIGHASH_ALL) verifies
94. [D.2] S-view HTLC-timeout: R's setup-time htlc_signature (SINGLE|ANYONECANPAY) verifies over the same transaction
95. [D.3] H_1 != SHA256(per_commitment_secret_S[n]) for every n in 0..n0 (7.2 Variant D binding forbidden)
96. [D.3] ff_init: R's node-key signature verifies from the wire bytes alone (strict low-S)
97. [D.3] ff_accept: S's node-key signature verifies from the wire bytes alone (strict low-S)
98. [D.3] ff_accept carries TLV 11 = T_init and a TLV 9 byte-identical to ff_init's
99. [D.3] variant == 4, G == 0, TLVs 1/3/5 absent from ff_init: variant 4, G 0
100. [D.3] sum(d_k) == budget_msat: 51289250 msat
101. [D.3] K <= 483 and K <= R max_accepted_htlcs: K = 3
102. [D.3] sum(d_k) <= R max_htlc_value_in_flight_msat: 51289250 <= 5000000000
103. [D.3] every d_k >= min_payment_msat: min d_k = 546250 >= 546000
104. [D.3] every d_k >= htlc_minimum_msat: min d_k = 546250 >= 1
105. [D.3] no d_k trims (floor(d_k/1000) >= dust_limit, zero second-level fee under anchors): min output 546 sat >= 546
106. [D.3] no overflow: d_k * fee_ppm and gross_into_S(d_k) <= 2^64 - 1: max d_k * ppm = 248745000000
107. [D.3] S holds budget + S channel_reserve spendable: 7000000 sat >= 51289 + 10000
108. [D.3] funder (R) covers fee(K=3) + anchors at the frozen rate above its reserve: 3000000 - 10000 >= 4100 + 660
109. [D.3] funder (R) fee-spike buffer: fee(K=3) at 2 x feerate + anchors above its reserve: 3000000 - 10000 >= 8200 + 660
110. [D.3] S post-round balance >= S channel_reserve; R post-round balance >= R channel_reserve only when R funds: S 6948710 sat, R 2995240 sat (R funds: checked), reserve 10000
111. [D.3] T_exp - D >= claim_margin (1008): 800000 - 798992 = 1008
112. [D.3] s_htlc_id_k = s_htlc_id_base + k - 1: ids 0 .. 2
113. [D.3] all 3 voucher onions (1366 bytes, single hop to R's node key, associated data H_k) decode on R's side with beignet's processOnionPacket as a final hop with exactly the 9.5.1 payload
114. [D.3] R-view: R's own rebuild (buildLocalCommitment) is byte-identical to S's construction (buildRemoteCommitment)
115. [D.3] R-view: S's commitment signature verifies (beignet verifyRemoteCommitmentSig)
116. [D.3] R-view: S's 3 htlc_signature(s) verify (beignet verifyRemoteHtlcSignatures)
117. [D.3] R-view: S's commitment signature verifies independently against the BIP 143 sighash of the funding input
118. [D.3] R-view: tx hex round-trips through the decoder to the same txid
119. [D.3] R-view: static_remotekey, to_remote pays S's payment basepoint
120. [D.3] R-view: 3 voucher outputs and 3 htlc_signatures, none trimmed
121. [D.3] R-view: to_local = 2995240 and to_remote = 6948710 sat, i.e. floor(msat balance / 1000) with fee 4100 + anchors 660 charged to the funder (R) and sub-satoshi remainders left to the on-chain fee
122. [D.3] R-view: every voucher output has value floor(d_k / 1000), cltv_expiry T_exp, scriptPubKey = P2WSH of the reconstructed BOLT 3 HTLC script, and S's htlc_signature verifies independently (strict low-S) against the SIGHASH_SINGLE|ANYONECANPAY digest of its HTLC-success transaction
123. [D.3] S-view: S's own rebuild (buildLocalCommitment) is byte-identical to R's construction (buildRemoteCommitment)
124. [D.3] S-view: R's commitment signature verifies (beignet verifyRemoteCommitmentSig)
125. [D.3] S-view: R's 3 htlc_signature(s) verify (beignet verifyRemoteHtlcSignatures)
126. [D.3] S-view: R's commitment signature verifies independently against the BIP 143 sighash of the funding input
127. [D.3] S-view: tx hex round-trips through the decoder to the same txid
128. [D.3] S-view: static_remotekey, to_remote pays R's payment basepoint
129. [D.3] S-view: 3 voucher outputs and 3 htlc_signatures, none trimmed
130. [D.3] S-view: to_local = 6948710 and to_remote = 2995240 sat, i.e. floor(msat balance / 1000) with fee 4100 + anchors 660 charged to the funder (R) and sub-satoshi remainders left to the on-chain fee
131. [D.3] S-view: every voucher output has value floor(d_k / 1000), cltv_expiry T_exp, scriptPubKey = P2WSH of the reconstructed BOLT 3 HTLC script, and R's htlc_signature verifies independently (strict low-S) against the SIGHASH_SINGLE|ANYONECANPAY digest of its HTLC-timeout transaction
132. [D.3] ff_activate: R's node-key signature verifies from the wire bytes alone
133. [D.3] ff_activate_ack: S's node-key signature verifies from the wire bytes alone
134. [D.3] R-view HTLC-success: R's own signature (SIGHASH_ALL) verifies
135. [D.3] R-view HTLC-success: S's setup-time htlc_signature (SINGLE|ANYONECANPAY) verifies over the same transaction
136. [D.3] preimage t_1 hashes to H_1
137. [D.3] R-view direct timeout spend by S: S's signature verifies against the received-HTLC script
138. [D.3] S-view direct preimage claim by R: R's signature verifies against the offered-HTLC script
139. [D.3] S-view HTLC-timeout: S's own signature (SIGHASH_ALL) verifies
140. [D.3] S-view HTLC-timeout: R's setup-time htlc_signature (SINGLE|ANYONECANPAY) verifies over the same transaction
141. [D.4] H_1 != SHA256(per_commitment_secret_S[n]) for every n in 0..n0 (7.2 Variant D binding forbidden)
142. [D.4] ff_init: R's node-key signature verifies from the wire bytes alone (strict low-S)
143. [D.4] ff_accept: S's node-key signature verifies from the wire bytes alone (strict low-S)
144. [D.4] ff_accept carries TLV 11 = T_init and a TLV 9 byte-identical to ff_init's
145. [D.4] variant == 4, G == 0, TLVs 1/3/5 absent from ff_init: variant 4, G 0
146. [D.4] sum(d_k) == budget_msat: 546000 msat
147. [D.4] K <= 483 and K <= R max_accepted_htlcs: K = 1
148. [D.4] sum(d_k) <= R max_htlc_value_in_flight_msat: 546000 <= 5000000000
149. [D.4] every d_k >= min_payment_msat: min d_k = 546000 >= 546000
150. [D.4] every d_k >= htlc_minimum_msat: min d_k = 546000 >= 1
151. [D.4] no d_k trims (floor(d_k/1000) >= dust_limit, zero second-level fee under anchors): min output 546 sat >= 546
152. [D.4] no overflow: d_k * fee_ppm and gross_into_S(d_k) <= 2^64 - 1: max d_k * ppm = 2730000000
153. [D.4] S holds budget + S channel_reserve spendable: 7000000 sat >= 546 + 10000
154. [D.4] funder (S) covers fee(K=1) + anchors at the frozen rate above its reserve: 6999454 - 10000 >= 3240 + 660
155. [D.4] funder (S) fee-spike buffer: fee(K=1) at 2 x feerate + anchors above its reserve: 6999454 - 10000 >= 6480 + 660
156. [D.4] S post-round balance >= S channel_reserve; R post-round balance >= R channel_reserve only when R funds: S 6995554 sat, R 3000000 sat (S funds: R not applied), reserve 10000
157. [D.4] T_exp - D >= claim_margin (1008): 800000 - 798992 = 1008
158. [D.4] s_htlc_id_k = s_htlc_id_base + k - 1: ids 0 .. 0
159. [D.4] all 1 voucher onions (1366 bytes, single hop to R's node key, associated data H_k) decode on R's side with beignet's processOnionPacket as a final hop with exactly the 9.5.1 payload
160. [D.4] R-view: R's own rebuild (buildLocalCommitment) is byte-identical to S's construction (buildRemoteCommitment)
161. [D.4] R-view: S's commitment signature verifies (beignet verifyRemoteCommitmentSig)
162. [D.4] R-view: S's 1 htlc_signature(s) verify (beignet verifyRemoteHtlcSignatures)
163. [D.4] R-view: S's commitment signature verifies independently against the BIP 143 sighash of the funding input
164. [D.4] R-view: tx hex round-trips through the decoder to the same txid
165. [D.4] R-view: static_remotekey, to_remote pays S's payment basepoint
166. [D.4] R-view: 1 voucher outputs and 1 htlc_signatures, none trimmed
167. [D.4] R-view: to_local = 3000000 and to_remote = 6995554 sat, i.e. floor(msat balance / 1000) with fee 3240 + anchors 660 charged to the funder (S) and sub-satoshi remainders left to the on-chain fee
168. [D.4] R-view: every voucher output has value floor(d_k / 1000), cltv_expiry T_exp, scriptPubKey = P2WSH of the reconstructed BOLT 3 HTLC script, and S's htlc_signature verifies independently (strict low-S) against the SIGHASH_SINGLE|ANYONECANPAY digest of its HTLC-success transaction
169. [D.4] S-view: S's own rebuild (buildLocalCommitment) is byte-identical to R's construction (buildRemoteCommitment)
170. [D.4] S-view: R's commitment signature verifies (beignet verifyRemoteCommitmentSig)
171. [D.4] S-view: R's 1 htlc_signature(s) verify (beignet verifyRemoteHtlcSignatures)
172. [D.4] S-view: R's commitment signature verifies independently against the BIP 143 sighash of the funding input
173. [D.4] S-view: tx hex round-trips through the decoder to the same txid
174. [D.4] S-view: static_remotekey, to_remote pays R's payment basepoint
175. [D.4] S-view: 1 voucher outputs and 1 htlc_signatures, none trimmed
176. [D.4] S-view: to_local = 6995554 and to_remote = 3000000 sat, i.e. floor(msat balance / 1000) with fee 3240 + anchors 660 charged to the funder (S) and sub-satoshi remainders left to the on-chain fee
177. [D.4] S-view: every voucher output has value floor(d_k / 1000), cltv_expiry T_exp, scriptPubKey = P2WSH of the reconstructed BOLT 3 HTLC script, and R's htlc_signature verifies independently (strict low-S) against the SIGHASH_SINGLE|ANYONECANPAY digest of its HTLC-timeout transaction
178. [D.4] ff_activate: R's node-key signature verifies from the wire bytes alone
179. [D.4] ff_activate_ack: S's node-key signature verifies from the wire bytes alone
180. [D.4] R-view HTLC-success: R's own signature (SIGHASH_ALL) verifies
181. [D.4] R-view HTLC-success: S's setup-time htlc_signature (SINGLE|ANYONECANPAY) verifies over the same transaction
182. [D.4] preimage t_1 hashes to H_1
183. [D.4] R-view direct timeout spend by S: S's signature verifies against the received-HTLC script
184. [D.4] S-view direct preimage claim by R: R's signature verifies against the offered-HTLC script
185. [D.4] S-view HTLC-timeout: S's own signature (SIGHASH_ALL) verifies
186. [D.4] S-view HTLC-timeout: R's setup-time htlc_signature (SINGLE|ANYONECANPAY) verifies over the same transaction
187. [D.4] 545,999 msat fails both setup checks (min_payment_msat and the section 8 trim floor) and is refused before any HTLC is built
188. [D.5] H_1 != SHA256(per_commitment_secret_S[n]) for every n in 0..n0 (7.2 Variant D binding forbidden)
189. [D.5] ff_init: R's node-key signature verifies from the wire bytes alone (strict low-S)
190. [D.5] ff_accept: S's node-key signature verifies from the wire bytes alone (strict low-S)
191. [D.5] ff_accept carries TLV 11 = T_init and a TLV 9 byte-identical to ff_init's
192. [D.5] variant == 4, G == 0, TLVs 1/3/5 absent from ff_init: variant 4, G 0
193. [D.5] sum(d_k) == budget_msat: 263718000 msat
194. [D.5] K <= 483 and K <= R max_accepted_htlcs: K = 483
195. [D.5] sum(d_k) <= R max_htlc_value_in_flight_msat: 263718000 <= 5000000000
196. [D.5] every d_k >= min_payment_msat: min d_k = 546000 >= 546000
197. [D.5] every d_k >= htlc_minimum_msat: min d_k = 546000 >= 1
198. [D.5] no d_k trims (floor(d_k/1000) >= dust_limit, zero second-level fee under anchors): min output 546 sat >= 546
199. [D.5] no overflow: d_k * fee_ppm and gross_into_S(d_k) <= 2^64 - 1: max d_k * ppm = 2730000000
200. [D.5] S holds budget + S channel_reserve spendable: 7000000 sat >= 263718 + 10000
201. [D.5] funder (S) covers fee(K=483) + anchors at the frozen rate above its reserve: 6736282 - 10000 >= 210500 + 660
202. [D.5] funder (S) fee-spike buffer: fee(K=483) at 2 x feerate + anchors above its reserve: 6736282 - 10000 >= 421000 + 660
203. [D.5] S post-round balance >= S channel_reserve; R post-round balance >= R channel_reserve only when R funds: S 6525122 sat, R 3000000 sat (S funds: R not applied), reserve 10000
204. [D.5] T_exp - D >= claim_margin (1008): 800000 - 798992 = 1008
205. [D.5] s_htlc_id_k = s_htlc_id_base + k - 1: ids 0 .. 482
206. [D.5] all 483 voucher onions (1366 bytes, single hop to R's node key, associated data H_k) decode on R's side with beignet's processOnionPacket as a final hop with exactly the 9.5.1 payload
207. [D.5] R-view: R's own rebuild (buildLocalCommitment) is byte-identical to S's construction (buildRemoteCommitment)
208. [D.5] R-view: S's commitment signature verifies (beignet verifyRemoteCommitmentSig)
209. [D.5] R-view: S's 483 htlc_signature(s) verify (beignet verifyRemoteHtlcSignatures)
210. [D.5] R-view: S's commitment signature verifies independently against the BIP 143 sighash of the funding input
211. [D.5] R-view: tx hex round-trips through the decoder to the same txid
212. [D.5] R-view: static_remotekey, to_remote pays S's payment basepoint
213. [D.5] R-view: 483 voucher outputs and 483 htlc_signatures, none trimmed
214. [D.5] R-view: to_local = 3000000 and to_remote = 6525122 sat, i.e. floor(msat balance / 1000) with fee 210500 + anchors 660 charged to the funder (S) and sub-satoshi remainders left to the on-chain fee
215. [D.5] R-view: every voucher output has value floor(d_k / 1000), cltv_expiry T_exp, scriptPubKey = P2WSH of the reconstructed BOLT 3 HTLC script, and S's htlc_signature verifies independently (strict low-S) against the SIGHASH_SINGLE|ANYONECANPAY digest of its HTLC-success transaction
216. [D.5] S-view: S's own rebuild (buildLocalCommitment) is byte-identical to R's construction (buildRemoteCommitment)
217. [D.5] S-view: R's commitment signature verifies (beignet verifyRemoteCommitmentSig)
218. [D.5] S-view: R's 483 htlc_signature(s) verify (beignet verifyRemoteHtlcSignatures)
219. [D.5] S-view: R's commitment signature verifies independently against the BIP 143 sighash of the funding input
220. [D.5] S-view: tx hex round-trips through the decoder to the same txid
221. [D.5] S-view: static_remotekey, to_remote pays R's payment basepoint
222. [D.5] S-view: 483 voucher outputs and 483 htlc_signatures, none trimmed
223. [D.5] S-view: to_local = 6525122 and to_remote = 3000000 sat, i.e. floor(msat balance / 1000) with fee 210500 + anchors 660 charged to the funder (S) and sub-satoshi remainders left to the on-chain fee
224. [D.5] S-view: every voucher output has value floor(d_k / 1000), cltv_expiry T_exp, scriptPubKey = P2WSH of the reconstructed BOLT 3 HTLC script, and R's htlc_signature verifies independently (strict low-S) against the SIGHASH_SINGLE|ANYONECANPAY digest of its HTLC-timeout transaction
225. [D.5] ff_activate: R's node-key signature verifies from the wire bytes alone
226. [D.5] ff_activate_ack: S's node-key signature verifies from the wire bytes alone
227. [D.5] R-view HTLC-success: R's own signature (SIGHASH_ALL) verifies
228. [D.5] R-view HTLC-success: S's setup-time htlc_signature (SINGLE|ANYONECANPAY) verifies over the same transaction
229. [D.5] preimage t_1 hashes to H_1
230. [D.5] R-view direct timeout spend by S: S's signature verifies against the received-HTLC script
231. [D.5] S-view direct preimage claim by R: R's signature verifies against the offered-HTLC script
232. [D.5] S-view HTLC-timeout: S's own signature (SIGHASH_ALL) verifies
233. [D.5] S-view HTLC-timeout: R's setup-time htlc_signature (SINGLE|ANYONECANPAY) verifies over the same transaction
234. [D.6] H_1 != SHA256(per_commitment_secret_S[n]) for every n in 0..n0 (7.2 Variant D binding forbidden)
235. [D.6] ff_init: R's node-key signature verifies from the wire bytes alone (strict low-S)
236. [D.6] ff_accept: S's node-key signature verifies from the wire bytes alone (strict low-S)
237. [D.6] ff_accept carries TLV 11 = T_init and a TLV 9 byte-identical to ff_init's
238. [D.6] variant == 4, G == 0, TLVs 1/3/5 absent from ff_init: variant 4, G 0
239. [D.6] sum(d_k) == budget_msat: 1000000 msat
240. [D.6] K <= 483 and K <= R max_accepted_htlcs: K = 1
241. [D.6] sum(d_k) <= R max_htlc_value_in_flight_msat: 1000000 <= 5000000000
242. [D.6] every d_k >= min_payment_msat: min d_k = 1000000 >= 546000
243. [D.6] every d_k >= htlc_minimum_msat: min d_k = 1000000 >= 1
244. [D.6] no d_k trims (floor(d_k/1000) >= dust_limit, zero second-level fee under anchors): min output 1000 sat >= 546
245. [D.6] no overflow: d_k * fee_ppm and gross_into_S(d_k) <= 2^64 - 1: max d_k * ppm = 5000000000
246. [D.6] S holds budget + S channel_reserve spendable: 10000000 sat >= 1000 + 10000
247. [D.6] funder (S) covers fee(K=1) + anchors at the frozen rate above its reserve: 9999000 - 10000 >= 3240 + 660
248. [D.6] funder (S) fee-spike buffer: fee(K=1) at 2 x feerate + anchors above its reserve: 9999000 - 10000 >= 6480 + 660
249. [D.6] S post-round balance >= S channel_reserve; R post-round balance >= R channel_reserve only when R funds: S 9995100 sat, R 0 sat (S funds: R not applied), reserve 10000
250. [D.6] T_exp - D >= claim_margin (1008): 800000 - 798992 = 1008
251. [D.6] s_htlc_id_k = s_htlc_id_base + k - 1: ids 0 .. 0
252. [D.6] all 1 voucher onions (1366 bytes, single hop to R's node key, associated data H_k) decode on R's side with beignet's processOnionPacket as a final hop with exactly the 9.5.1 payload
253. [D.6] R-view: R's own rebuild (buildLocalCommitment) is byte-identical to S's construction (buildRemoteCommitment)
254. [D.6] R-view: S's commitment signature verifies (beignet verifyRemoteCommitmentSig)
255. [D.6] R-view: S's 1 htlc_signature(s) verify (beignet verifyRemoteHtlcSignatures)
256. [D.6] R-view: S's commitment signature verifies independently against the BIP 143 sighash of the funding input
257. [D.6] R-view: tx hex round-trips through the decoder to the same txid
258. [D.6] R-view: static_remotekey, to_remote pays S's payment basepoint
259. [D.6] R-view: 1 voucher outputs and 1 htlc_signatures, none trimmed
260. [D.6] R-view: to_local omitted (0 sat < dust_limit) and to_remote = 9995100 sat, i.e. floor(msat balance / 1000) with fee 3240 + anchors 660 charged to the funder (S) and sub-satoshi remainders left to the on-chain fee
261. [D.6] R-view: both anchors are present although `to_local` (R) is omitted (the commitment carries an untrimmed HTLC)
262. [D.6] R-view: every voucher output has value floor(d_k / 1000), cltv_expiry T_exp, scriptPubKey = P2WSH of the reconstructed BOLT 3 HTLC script, and S's htlc_signature verifies independently (strict low-S) against the SIGHASH_SINGLE|ANYONECANPAY digest of its HTLC-success transaction
263. [D.6] S-view: S's own rebuild (buildLocalCommitment) is byte-identical to R's construction (buildRemoteCommitment)
264. [D.6] S-view: R's commitment signature verifies (beignet verifyRemoteCommitmentSig)
265. [D.6] S-view: R's 1 htlc_signature(s) verify (beignet verifyRemoteHtlcSignatures)
266. [D.6] S-view: R's commitment signature verifies independently against the BIP 143 sighash of the funding input
267. [D.6] S-view: tx hex round-trips through the decoder to the same txid
268. [D.6] S-view: static_remotekey, to_remote pays R's payment basepoint
269. [D.6] S-view: 1 voucher outputs and 1 htlc_signatures, none trimmed
270. [D.6] S-view: to_local = 9995100 and to_remote omitted (0 sat < dust_limit) sat, i.e. floor(msat balance / 1000) with fee 3240 + anchors 660 charged to the funder (S) and sub-satoshi remainders left to the on-chain fee
271. [D.6] S-view: both anchors are present although `to_remote` (R) is omitted (the commitment carries an untrimmed HTLC)
272. [D.6] S-view: every voucher output has value floor(d_k / 1000), cltv_expiry T_exp, scriptPubKey = P2WSH of the reconstructed BOLT 3 HTLC script, and R's htlc_signature verifies independently (strict low-S) against the SIGHASH_SINGLE|ANYONECANPAY digest of its HTLC-timeout transaction
273. [D.6] ff_activate: R's node-key signature verifies from the wire bytes alone
274. [D.6] ff_activate_ack: S's node-key signature verifies from the wire bytes alone
275. [D.6] R-view HTLC-success: R's own signature (SIGHASH_ALL) verifies
276. [D.6] R-view HTLC-success: S's setup-time htlc_signature (SINGLE|ANYONECANPAY) verifies over the same transaction
277. [D.6] preimage t_1 hashes to H_1
278. [D.6] R-view direct timeout spend by S: S's signature verifies against the received-HTLC script
279. [D.6] S-view direct preimage claim by R: R's signature verifies against the offered-HTLC script
280. [D.6] S-view HTLC-timeout: S's own signature (SIGHASH_ALL) verifies
281. [D.6] S-view HTLC-timeout: R's setup-time htlc_signature (SINGLE|ANYONECANPAY) verifies over the same transaction
282. [D.2 vs D.3] the voucher output order on R's view is the same whichever side funds (BOLT 3 order depends on amount and script, not on the funder)
283. [D.2] R-view output layout is anchor,anchor,voucher_2,voucher_1,voucher_3,to_local,to_remote: the Appendix A C_3 layout (voucher 2 at 546 sat sorts before voucher 1 at 994 sat)
284. [D.2] R-view to_local 3000000 / to_remote 6943950 sat equal Appendix A C_3's values (same balances, same fee, keys differ)
285. [D.5] both views carry 483 untrimmed voucher outputs
286. [D.5] ff_init (4043 bytes) and ff_accept (19510 bytes) fit a BOLT 8 message
287. [D.1] H_1 != SHA256(per_commitment_secret_S[n]) for every n in 0..n0 (7.2 Variant D binding forbidden)
288. [D.1] ff_init: R's node-key signature verifies from the wire bytes alone (strict low-S)
289. [D.1] ff_accept: S's node-key signature verifies from the wire bytes alone (strict low-S)
290. [D.1] ff_accept carries TLV 11 = T_init and a TLV 9 byte-identical to ff_init's
291. [D.1] variant == 4, G == 0, TLVs 1/3/5 absent from ff_init: variant 4, G 0
292. [D.1] sum(d_k) == budget_msat: 1000000 msat
293. [D.1] K <= 483 and K <= R max_accepted_htlcs: K = 1
294. [D.1] sum(d_k) <= R max_htlc_value_in_flight_msat: 1000000 <= 5000000000
295. [D.1] every d_k >= min_payment_msat: min d_k = 1000000 >= 546000
296. [D.1] every d_k >= htlc_minimum_msat: min d_k = 1000000 >= 1
297. [D.1] no d_k trims (floor(d_k/1000) >= dust_limit, zero second-level fee under anchors): min output 1000 sat >= 546
298. [D.1] no overflow: d_k * fee_ppm and gross_into_S(d_k) <= 2^64 - 1: max d_k * ppm = 5000000000
299. [D.1] S holds budget + S channel_reserve spendable: 7000000 sat >= 1000 + 10000
300. [D.1] funder (S) covers fee(K=1) + anchors at the frozen rate above its reserve: 6999000 - 10000 >= 3240 + 660
301. [D.1] funder (S) fee-spike buffer: fee(K=1) at 2 x feerate + anchors above its reserve: 6999000 - 10000 >= 6480 + 660
302. [D.1] S post-round balance >= S channel_reserve; R post-round balance >= R channel_reserve only when R funds: S 6995100 sat, R 3000000 sat (S funds: R not applied), reserve 10000
303. [D.1] T_exp - D >= claim_margin (1008): 800000 - 798992 = 1008
304. [D.1] s_htlc_id_k = s_htlc_id_base + k - 1: ids 0 .. 0
305. [D.1] all 1 voucher onions (1366 bytes, single hop to R's node key, associated data H_k) decode on R's side with beignet's processOnionPacket as a final hop with exactly the 9.5.1 payload
306. [D.1] R-view: R's own rebuild (buildLocalCommitment) is byte-identical to S's construction (buildRemoteCommitment)
307. [D.1] R-view: S's commitment signature verifies (beignet verifyRemoteCommitmentSig)
308. [D.1] R-view: S's 1 htlc_signature(s) verify (beignet verifyRemoteHtlcSignatures)
309. [D.1] R-view: S's commitment signature verifies independently against the BIP 143 sighash of the funding input
310. [D.1] R-view: tx hex round-trips through the decoder to the same txid
311. [D.1] R-view: static_remotekey, to_remote pays S's payment basepoint
312. [D.1] R-view: 1 voucher outputs and 1 htlc_signatures, none trimmed
313. [D.1] R-view: to_local = 3000000 and to_remote = 6995100 sat, i.e. floor(msat balance / 1000) with fee 3240 + anchors 660 charged to the funder (S) and sub-satoshi remainders left to the on-chain fee
314. [D.1] R-view: every voucher output has value floor(d_k / 1000), cltv_expiry T_exp, scriptPubKey = P2WSH of the reconstructed BOLT 3 HTLC script, and S's htlc_signature verifies independently (strict low-S) against the SIGHASH_SINGLE|ANYONECANPAY digest of its HTLC-success transaction
315. [D.1] S-view: S's own rebuild (buildLocalCommitment) is byte-identical to R's construction (buildRemoteCommitment)
316. [D.1] S-view: R's commitment signature verifies (beignet verifyRemoteCommitmentSig)
317. [D.1] S-view: R's 1 htlc_signature(s) verify (beignet verifyRemoteHtlcSignatures)
318. [D.1] S-view: R's commitment signature verifies independently against the BIP 143 sighash of the funding input
319. [D.1] S-view: tx hex round-trips through the decoder to the same txid
320. [D.1] S-view: static_remotekey, to_remote pays R's payment basepoint
321. [D.1] S-view: 1 voucher outputs and 1 htlc_signatures, none trimmed
322. [D.1] S-view: to_local = 6995100 and to_remote = 3000000 sat, i.e. floor(msat balance / 1000) with fee 3240 + anchors 660 charged to the funder (S) and sub-satoshi remainders left to the on-chain fee
323. [D.1] S-view: every voucher output has value floor(d_k / 1000), cltv_expiry T_exp, scriptPubKey = P2WSH of the reconstructed BOLT 3 HTLC script, and R's htlc_signature verifies independently (strict low-S) against the SIGHASH_SINGLE|ANYONECANPAY digest of its HTLC-timeout transaction
324. [D.1] ff_activate: R's node-key signature verifies from the wire bytes alone
325. [D.1] ff_activate_ack: S's node-key signature verifies from the wire bytes alone
326. [D.1] R-view HTLC-success: R's own signature (SIGHASH_ALL) verifies
327. [D.1] R-view HTLC-success: S's setup-time htlc_signature (SINGLE|ANYONECANPAY) verifies over the same transaction
328. [D.1] preimage t_1 hashes to H_1
329. [D.1] R-view direct timeout spend by S: S's signature verifies against the received-HTLC script
330. [D.1] S-view direct preimage claim by R: R's signature verifies against the offered-HTLC script
331. [D.1] S-view HTLC-timeout: S's own signature (SIGHASH_ALL) verifies
332. [D.1] S-view HTLC-timeout: R's setup-time htlc_signature (SINGLE|ANYONECANPAY) verifies over the same transaction
333. [D.1] a second in-process run reproduces every message, onion, commitment and hash byte-for-byte

Independent means: verified with beignet's `verify(..., strict = true)` against
a sighash computed here (`hashForWitnessV0`) rather than through the channel
verifier. Every commitment and second-level transaction was additionally
round-tripped through the transaction decoder.

## D.8 Conventions adopted and spec feedback

Byte-level conventions these vectors follow. Each was an implementer's choice
in the first draft of v0.9 and is now normative text in the section named, so
an implementation that matches these vectors matches the spec.

1. **7, signed messages.** `body` in the digest formula includes the
   `[32: channel_id][32: epoch_id]` header: every byte after the 2-byte type.
   The digest is signed directly (single SHA256, not BOLT 7's double hash), as
   a 64-byte compact low-S ECDSA signature.
2. **7, TLV stream extent.** No length prefix: the stream runs from the end of
   the last fixed field to the final 64 bytes, BigSize type and length (BOLT 1),
   and may be empty (`ff_activate`, `ff_activate_ack`).
3. **9.5.1, voucher onion.** Associated data is `payment_hash = H_k`; the payload
   carries exactly TLVs 2, 4 and 8. The ephemeral key is seeded here for
   reproducibility; live implementations draw it fresh.
4. **7.1, `r_per_commitment_points` in Variant D.** Count 0. The one point the
   voucher round needs is the one `S` holds from `R`'s last `revoke_and_ack`.
5. **7.6, fee-spike buffer.** `fee(2 x feerate, K) + 660 sat`: the anchors are
   a fixed 330 sat each and do not scale with the feerate.
6. **7.5.2, `H_commit`.** Txids in internal byte order, the reverse of the
   display order most tools print; both are given for every commitment.
7. **Appendix A.** `D = 798,992 = T_exp - 1008` in both appendices; `D` enters
   no commitment, so Appendix A's transactions are unchanged.

## D.9 How to regenerate

```sh
cd <beignet repo>   # sibling of the specs repo, master branch
npx ts-node -P ../specs/tools/tsconfig.json \
  ../specs/tools/generate-ffor-variant-d-vectors.ts > ../specs/ffor-variant-d-vectors.md
```

The generator ([tools/generate-ffor-variant-d-vectors.ts](tools/generate-ffor-variant-d-vectors.ts))
imports beignet from source (`../beignet/src/lightning/...`) and writes this
entire file to stdout. Output is deterministic: running it twice yields
byte-identical results.

---

*Generated by `tools/generate-ffor-variant-d-vectors.ts` against beignet master
using its real BOLT 3 commitment builder and signer, BOLT 4 onion code and
on-chain claim builders.*
