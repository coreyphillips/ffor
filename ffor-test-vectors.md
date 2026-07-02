# FFOR Appendix A: canonical `C_i^R` test vectors

Byte-accurate test vectors for the deterministic voucher commitment
construction of [FFOR §8](ffor-offline-receive.md) (`C_i^R`), computed with
the beignet Lightning library's BOLT 3 commitment builder and signer —
every transaction and signature below was built, signed, and verified by
running code, not written by hand. All hex is lowercase; all signatures are
deterministic (RFC 6979), so this file regenerates byte-identically.

The scenario: a quiescent channel between `S` (settlement peer, channel
opener and funder) and `R` (recipient, holder of `C_i^R`), followed by three
delegated settlements. `C_0` is the pre-epoch base state (no vouchers);
`C_1..C_3` each add one voucher HTLC per FFOR §8/§9.

## A.1 Input parameters

### Channel

| Parameter | Value |
|---|---|
| channel type | `option_static_remotekey` + `option_anchors_zero_fee_htlc_tx` |
| `channel_type` bits (hex) | `401000` (bits 12, 22) |
| funding outpoint | `8984484a580b825b9972d7adb15050b3ab624ccd731946b3eeddb92f4e7ef6be:0` (BOLT 3 Appendix C) |
| funding txid (internal byte order) | `bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489` |
| funding amount | 10000000 sat |
| funder / opener | `S` |
| pre-epoch balance `S` | 7000000000 msat |
| pre-epoch balance `R` | 3000000000 msat |
| `dust_limit_satoshis` (both sides) | 546 |
| `to_self_delay` (both sides) | 144 |
| frozen `feerate_per_kw` | 2500 |
| `channel_reserve_satoshis` | 10000 |

### Epoch (FFOR §7)

| Parameter | Value |
|---|---|
| `n_R` | 42 (so `C_i^R` is R's commitment number 42 + i) |
| `n0` | 42 |
| `T_exp` (`voucher_expiry`, uniform `cltv_expiry`) | 800000 |
| `D` (`settlement_deadline`) | 799000 |
| `fee_base_msat` | 1000 |
| `fee_proportional_millionths` | 5000 |
| `budget_msat` | 100000000 |
| `K` (`max_payments`) | 8 |
| `min_payment_msat` | 10000 |
| `G` (`escape_granularity_msat`) | 0 (no escape set) |

### Secrets and seeds

Where BOLT 3 Appendix C provides material it is reused verbatim so readers
can cross-reference (mapping: `R` = Appendix C *local* node, `S` = Appendix C
*remote* node; per Appendix C, each side's HTLC basepoint equals its payment
basepoint). Material Appendix C does not provide is `SHA256(tag)` of the
documented ASCII tag.

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

Per-commitment secrets use the BOLT 3 shachain: the secret for commitment
number `n` is `generate_from_seed(seed, 2^48 - 1 - n)`; the point is
`secret * G`.

### Basepoints (derived)

| Key | Value |
|---|---|
| `R` funding pubkey | `023da092f6980e58d2c037173180e9a465476026ee50f96695963e8efe436f54eb` |
| `S` funding pubkey | `030e9f7b623d2ccc7c9bd44d66d5ce21ce504c0acf6385a132cec6d3c39fa711c1` |
| `R` payment (= HTLC) basepoint | `034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa` |
| `R` delayed-payment basepoint | `023c72addb4fdf09af94f0c94d7fe92a386a7e70cf8a1d85916386bb2535c7b1b1` |
| `R` revocation basepoint | `038e38ad35420958328d6533fce5a5892fc68c79dfcf07c6ff072200ecec228556` |
| `S` payment (= HTLC) basepoint | `032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991` |
| `S` delayed-payment basepoint | `0294fba20d6360f72e340ac592b96d68b54499138bcb868dcafedf2c7b3510ecae` |
| `S` revocation basepoint | `02466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27` |
| funding witness script | `5221023da092f6980e58d2c037173180e9a465476026ee50f96695963e8efe436f54eb21030e9f7b623d2ccc7c9bd44d66d5ce21ce504c0acf6385a132cec6d3c39fa711c152ae` |

### `r_per_commitment_points` (ff_init, commitment numbers 43..50)

`R`'s pre-shared points for `n_R + 1 .. n_R + K`. `C_0` additionally uses
R's point for commitment number 42 (the pre-epoch state).

| n | per_commitment_point_R[n] |
|---|---|
| 42 (pre-epoch, used by C_0) | `037e19d032174df01427ef71816e251d9b86131f1192e805cc4833de5b4a22b2f1` |
| 43 | `03dcd6df1422406c9e57514174169f8219e69e77605ee0de483f5c3bac773d6a58` |
| 44 | `03e79f120b711e5dcc31d1b1c9a80fd3744179d76c2db74538af0370b9be0351a9` |
| 45 | `02cb70d6bbd9e541cc97080c21554bb5bad9a97106bd8cddf87e58fff251843f52` |
| 46 | `038c041ac5b8b09aa37b02efa89c1d26f6df8469eb05b59a11d44ac7e72a3da670` |
| 47 | `02e953ce37edd88170a861951cbf645823619910f0cda873c89c5f353a80220c7b` |
| 48 | `03331f11e8509d6e320c5a6baa800df600af9d9c50259c46a6245d424b314f7172` |
| 49 | `020436bde8825c9dda02bc2a33ec27743436af4213b0c4920e522842722b5bd3e9` |
| 50 | `02902437ce9a77d399f68dff0c2a1d6d161c30884c4955bcb4b4bbd33fce66a4cd` |

### `S` per-commitment material at `n0` (H_1 binding, FFOR §7.2/§12.1)

| Item | Value |
|---|---|
| `per_commitment_secret_S[42]` (= `P_1`) | `ab002fc41c2817140d1384ccdfb6e7f4da730edeac39c08375b2b35eb8654b77` |
| `per_commitment_point_S[42]` | `03f40c57917588ccad5793436f38e4a62c2f41892bd02b2f72c441163056c71029` |
| `H_1 = SHA256(P_1)` | `e4436ccb23764c40624d579e288c09f8da56f0994b1d54cd44c4f9d7923bfe96` |

## A.2 Delegated payments and voucher values

`fee(a) = fee_base_msat + a * fee_proportional_millionths / 10^6`;
`v_k = htlc_amount_k - fee(htlc_amount_k)`. All voucher HTLCs use
`cltv_expiry = T_exp = 800000`.

> Note: payment 2 was originally scripted as 250,000 msat, but that yields
> `v_2 = 247,750 msat` — below the voucher dust floor (`dust_limit` 546 sat;
> the second-level HTLC fee term is zero under
> `option_anchors_zero_fee_htlc_tx`), so a compliant `S` MUST reject it
> (FFOR §8). It is bumped to the smallest round amount that does not trim:
> 550,000 msat, giving `v_2 = 546,250 msat` → a 546 sat output, exactly at
> the floor (the `>= dust_limit` boundary is intentionally exercised).

| k | htlc_amount_msat | fee(a) msat | v_k msat | v_k output (sat) | preimage P_k | payment_hash H_k |
|---|---|---|---|---|---|---|
| 1 | 1000000 | 6000 | 994000 | 994 | `ab002fc41c2817140d1384ccdfb6e7f4da730edeac39c08375b2b35eb8654b77` | `e4436ccb23764c40624d579e288c09f8da56f0994b1d54cd44c4f9d7923bfe96` |
| 2 | 550000 | 3750 | 546250 | 546 | `0202020202020202020202020202020202020202020202020202020202020202` | `75877bb41d393b5fb8455ce60ecd8dda001d06316496b14dfa7f895656eeca4a` |
| 3 | 50000000 | 251000 | 49749000 | 49749 | `0303030303030303030303030303030303030303030303030303030303030303` | `648aa5c579fb30f38af744d97d6ec840c7a91277a499a0d780f3e7314eca090b` |

Cumulative voucher value: 51289250 msat <= budget 100000000 msat.

`P_1` is `per_commitment_secret_S[n0]` per the Variant-A `H_1` binding;
`P_2`/`P_3` are the documented constants above (Appendix C style).

Sub-satoshi remainders (BOLT 3): `v_2` carries a 250 msat remainder. The
voucher output is floored to 546 sat and the 250 msat stays with the party
that offered the HTLC — `S` — i.e. it is accounted in `S`'s `to_remote`
balance on `C_2`/`C_3`, not dropped to fees.

## A.3 Commitment transactions `C_0..C_3`

Each `C_i^R` is built at commitment number `n_R + i` with
`r_per_commitment_points[n_R + i]`, `S`'s balance reduced by `Σ_{k<=i} v_k`,
and the funder (`S`) paying the BOLT 3 commitment fee
(`(1124 + 172·i) · 2500 / 1000` weight units at the frozen feerate) plus the
two 330 sat anchors. Signature forms: `compact` is the 64-byte form carried
in `ff_settlement.commitment_sig` / `htlc_sigs` (and BOLT 2 wire messages);
`DER` is the same signature DER-encoded with the sighash byte appended, as
it appears in the final witness stack.

### A.3.0 `C_0` — commitment number 42 (pre-epoch base state)

| Field | Value |
|---|---|
| commitment number (R) | 42 |
| `per_commitment_point_R[42]` | `037e19d032174df01427ef71816e251d9b86131f1192e805cc4833de5b4a22b2f1` |
| obscured commitment number | `0xb9c570f08183` |
| commitment fee (paid by S) | 2810 sat |
| txid | `f432e2a8d9c1066c1127eb5367e147719f4810b66f43e15809f40f21a111eee9` |

Derived keys on this commitment (holder = `R`):

| Key | Value |
|---|---|
| revocation pubkey | `03ae3ab4b660dbe7cfc57402b961083150ab377a60536373a0eaa9b2eed8adb660` |
| R delayed pubkey (`to_local`) | `02afc411b37c139bda777f06c9b63b7539d6743c7e7b7a1d9d146e21cdaf3773e9` |
| R HTLC pubkey | `029473900275bf1c3db053f2d135ca971a5df9531ad831ddf59509a8a569736ca3` |
| S HTLC pubkey | `0346d7d7c22ae88350fc14d7b12fcbee4dc3b02205c35007b0e998e6c63a468f7b` |
| `to_remote` key (static, = S payment basepoint) | `032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991` |

Outputs (BOLT 3 order):

| # | Output | Amount (sat) | scriptPubKey |
|---|---|---|---|
| 0 | anchor (R) | 330 | `00202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f` |
| 1 | anchor (S) | 330 | `0020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994` |
| 2 | to_local (R) | 3000000 | `00201200d0622717c41a7fea2aac057cde8947e81b234ba34cf1bb813090d4f4f072` |
| 3 | to_remote (S) | 6996530 | `0020f3394e1e619b0eca1f91be2fb5ab4dfc59ba5b84ebe014ad1d43a564d012994a` |

Transaction (unsigned funding input, as signed by both parties):

```
0200000001bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489000000000070c5b980044a010000000000002200202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f4a01000000000000220020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994c0c62d00000000002200201200d0622717c41a7fea2aac057cde8947e81b234ba34cf1bb813090d4f4f07232c26a0000000000220020f3394e1e619b0eca1f91be2fb5ab4dfc59ba5b84ebe014ad1d43a564d012994a8381f020
```

`S` commitment signature (`ff_settlement.commitment_sig` — informational for C_0; settlement packages start at seq 1):

- compact: `f75aafba7e6eada88b70a4ae649c13b9ab286e622f2ab6426dc1856bd4afeeeb6e083cdb7b11f68ca29fc8bbf0cdcdf3e3985be71f8acd382159d3e582dc9e3a`
- DER + `SIGHASH_ALL`: `3045022100f75aafba7e6eada88b70a4ae649c13b9ab286e622f2ab6426dc1856bd4afeeeb02206e083cdb7b11f68ca29fc8bbf0cdcdf3e3985be71f8acd382159d3e582dc9e3a01`

### A.3.1 `C_1` — commitment number 43, vouchers 1..1

| Field | Value |
|---|---|
| commitment number (R) | 43 |
| `per_commitment_point_R[43]` | `03dcd6df1422406c9e57514174169f8219e69e77605ee0de483f5c3bac773d6a58` |
| obscured commitment number | `0xb9c570f08182` |
| commitment fee (paid by S) | 3240 sat |
| txid | `5d7e2c85156d35024911820bcdcf0ce410057639165a7ef12b33ea3687a10bfb` |

Derived keys on this commitment (holder = `R`):

| Key | Value |
|---|---|
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
| 2 | voucher_1 (received HTLC) | 994 | `00206bd1ccfc03b83c9dd2c49f99753497ffe59d3244f5960f38bb9f42e1a37953f1` |
| 3 | to_local (R) | 3000000 | `00202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce47` |
| 4 | to_remote (S) | 6995106 | `0020f3394e1e619b0eca1f91be2fb5ab4dfc59ba5b84ebe014ad1d43a564d012994a` |

Transaction (unsigned funding input, as signed by both parties):

```
0200000001bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489000000000070c5b980054a010000000000002200202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f4a01000000000000220020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994e2030000000000002200206bd1ccfc03b83c9dd2c49f99753497ffe59d3244f5960f38bb9f42e1a37953f1c0c62d00000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce47a2bc6a0000000000220020f3394e1e619b0eca1f91be2fb5ab4dfc59ba5b84ebe014ad1d43a564d012994a8281f020
```

`S` commitment signature (`ff_settlement.commitment_sig`):

- compact: `6d2d86677f1656b7cf63516c0b542d7dad5341f0e88f036b3bb221b23200e5ed4dd125fa8ceb6ae9d22893553e4beabaa31a4e3f56447ef309fcc9120ad4eeb8`
- DER + `SIGHASH_ALL`: `304402206d2d86677f1656b7cf63516c0b542d7dad5341f0e88f036b3bb221b23200e5ed02204dd125fa8ceb6ae9d22893553e4beabaa31a4e3f56447ef309fcc9120ad4eeb801`

`S` HTLC signatures (`ff_settlement.htlc_sigs`, 1 sig, BOLT 3 output order,
`SIGHASH_SINGLE|ANYONECANPAY` over the HTLC-success transaction, anchor
rules: zero fee, input `nSequence = 1`):

#### htlc_sig for voucher 1 (output 2, 994 sat)

| Field | Value |
|---|---|
| HTLC witness script (received HTLC, `cltv_expiry` 800000) | `76a914451d94046f252c4e93c380a2023bbad0c953b31d8763ac672102b30063771e94c4b693f352523594325c91c5549994d23010c97d4f937d1b48927c8201208763a9149dac0ba2874023dcb252d34da5934a193b73697e88527c21034c04350dce482e60575f6e4bd8f6c2a9ec4f0498ab612ea692bc2afb6918feea52ae67750300350cb175ac6851b27568` |
| HTLC-success tx (unsigned) | `0200000001fb0ba18736ea332bf17e5a1639760510e40ccfcd0b82114902356d15852c7e5d02000000000100000001e2030000000000002200202dc58b936232a6526119fc481e6314ae008c7041fae49223ba9aecba4916ce4700000000` |
| HTLC-success txid | `61c481b62ed0a2f52d03f95c6d3979c95a5a73b4ba2af0c79fa820024d6686ef` |
| sighash (`SINGLE\|ANYONECANPAY` = `0x83`) | `45ec9ccd04e0e5942721a41a3e75715a399e6d47b43f08aec53df294b2e85561` |
| `S` sig (compact) | `dee0d8437159468b0b67941cf3df7a876271d05f58b7885d9554a6197945eb22701b0aecefacaf7831b62f241d1a1698c1d28729fa1e9ab6b88e9f24a7fdd24f` |
| `S` sig (DER + `0x83`) | `3045022100dee0d8437159468b0b67941cf3df7a876271d05f58b7885d9554a6197945eb220220701b0aecefacaf7831b62f241d1a1698c1d28729fa1e9ab6b88e9f24a7fdd24f83` |

### A.3.2 `C_2` — commitment number 44, vouchers 1..2

| Field | Value |
|---|---|
| commitment number (R) | 44 |
| `per_commitment_point_R[44]` | `03e79f120b711e5dcc31d1b1c9a80fd3744179d76c2db74538af0370b9be0351a9` |
| obscured commitment number | `0xb9c570f08185` |
| commitment fee (paid by S) | 3670 sat |
| txid | `8d0d39d5f194be5a83b673206076fd86c1542b5861cda4d04cd3eaa6f38b5634` |

Derived keys on this commitment (holder = `R`):

| Key | Value |
|---|---|
| revocation pubkey | `0276cb60ccd8dd35d4193d944e06b71bf60b072d5f098566f1967b0029d857a7ad` |
| R delayed pubkey (`to_local`) | `02f29c482d409b61df84f885570e7dd37c54937237f51b856c79ca65768f75303f` |
| R HTLC pubkey | `038ac88072b68d464d5f225e432d8018fcfcef95b706c65fe07e9462a1baeefcf0` |
| S HTLC pubkey | `03be83134be68381c445ce747a6a1f31d29cacbb96d8ffc214e28dc9e0ddf62c11` |
| `to_remote` key (static, = S payment basepoint) | `032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991` |

Outputs (BOLT 3 order):

| # | Output | Amount (sat) | scriptPubKey |
|---|---|---|---|
| 0 | anchor (R) | 330 | `00202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f` |
| 1 | anchor (S) | 330 | `0020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994` |
| 2 | voucher_2 (received HTLC) | 546 | `002081a0988232d977d836994ef831bce0296fe5ec419a01330114ea494ddb3d0542` |
| 3 | voucher_1 (received HTLC) | 994 | `0020fb1ea333a60802eadc161cbdb5cbb07b6ac9607914e0cbb25062fbda8215e18c` |
| 4 | to_local (R) | 3000000 | `0020b077728ee1d99fd5ca43844e80580f0e7e32904c4a1192873fee9913e005ce11` |
| 5 | to_remote (S) | 6994130 | `0020f3394e1e619b0eca1f91be2fb5ab4dfc59ba5b84ebe014ad1d43a564d012994a` |

Transaction (unsigned funding input, as signed by both parties):

```
0200000001bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489000000000070c5b980064a010000000000002200202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f4a01000000000000220020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994220200000000000022002081a0988232d977d836994ef831bce0296fe5ec419a01330114ea494ddb3d0542e203000000000000220020fb1ea333a60802eadc161cbdb5cbb07b6ac9607914e0cbb25062fbda8215e18cc0c62d0000000000220020b077728ee1d99fd5ca43844e80580f0e7e32904c4a1192873fee9913e005ce11d2b86a0000000000220020f3394e1e619b0eca1f91be2fb5ab4dfc59ba5b84ebe014ad1d43a564d012994a8581f020
```

`S` commitment signature (`ff_settlement.commitment_sig`):

- compact: `d15b2fbdb880b6a452c08d9e38f4b6e60020adb00ef70707b7e3ed7dc74afb35201b622b5ae4d68117c09bc8bfc641275ffec5349a183bfa1cd7fd91a03042c9`
- DER + `SIGHASH_ALL`: `3045022100d15b2fbdb880b6a452c08d9e38f4b6e60020adb00ef70707b7e3ed7dc74afb350220201b622b5ae4d68117c09bc8bfc641275ffec5349a183bfa1cd7fd91a03042c901`

`S` HTLC signatures (`ff_settlement.htlc_sigs`, 2 sigs, BOLT 3 output order,
`SIGHASH_SINGLE|ANYONECANPAY` over the HTLC-success transaction, anchor
rules: zero fee, input `nSequence = 1`):

#### htlc_sig for voucher 2 (output 2, 546 sat)

| Field | Value |
|---|---|
| HTLC witness script (received HTLC, `cltv_expiry` 800000) | `76a91413481522a1b00554bee6c26b32f778b086f9926d8763ac672103be83134be68381c445ce747a6a1f31d29cacbb96d8ffc214e28dc9e0ddf62c117c8201208763a914b43e1b38138a41b37f7cd9a1d274bc63e3a9b5d188527c21038ac88072b68d464d5f225e432d8018fcfcef95b706c65fe07e9462a1baeefcf052ae67750300350cb175ac6851b27568` |
| HTLC-success tx (unsigned) | `020000000134568bf3a6ead34cd0a4cd61582b54c186fd76602073b6835abe94f1d5390d8d020000000001000000012202000000000000220020b077728ee1d99fd5ca43844e80580f0e7e32904c4a1192873fee9913e005ce1100000000` |
| HTLC-success txid | `7b63b5409b4720d53f7c4a8a2b9e375cd1cd3f663c99cde9dd3bee3aa2432672` |
| sighash (`SINGLE\|ANYONECANPAY` = `0x83`) | `49c568b6569ab7bee875f9e25d993632b2d870e312893284a47566e14105cfd6` |
| `S` sig (compact) | `4f04d239e841ee892fe61eafcf6a1d11c7e83356c5e2f325708da089d5909a2a1a9c59fb8b2157564641fffbad1ef9379b26ffa68e600c440195639b69a77287` |
| `S` sig (DER + `0x83`) | `304402204f04d239e841ee892fe61eafcf6a1d11c7e83356c5e2f325708da089d5909a2a02201a9c59fb8b2157564641fffbad1ef9379b26ffa68e600c440195639b69a7728783` |

#### htlc_sig for voucher 1 (output 3, 994 sat)

| Field | Value |
|---|---|
| HTLC witness script (received HTLC, `cltv_expiry` 800000) | `76a91413481522a1b00554bee6c26b32f778b086f9926d8763ac672103be83134be68381c445ce747a6a1f31d29cacbb96d8ffc214e28dc9e0ddf62c117c8201208763a9149dac0ba2874023dcb252d34da5934a193b73697e88527c21038ac88072b68d464d5f225e432d8018fcfcef95b706c65fe07e9462a1baeefcf052ae67750300350cb175ac6851b27568` |
| HTLC-success tx (unsigned) | `020000000134568bf3a6ead34cd0a4cd61582b54c186fd76602073b6835abe94f1d5390d8d03000000000100000001e203000000000000220020b077728ee1d99fd5ca43844e80580f0e7e32904c4a1192873fee9913e005ce1100000000` |
| HTLC-success txid | `c88d6fd2a47a205e743d5b61353f7cdd76e6d4bb690f06b192c3add63cedd3c3` |
| sighash (`SINGLE\|ANYONECANPAY` = `0x83`) | `1da1e2706d9b9f86e0299257c5418882712364cd28780f2da15e3e0af38875bf` |
| `S` sig (compact) | `6db331b2bba37bc22b8ceaf3c199843a1f268061019be24077a0809aea7d4dc945e5c10a3ee058154c50048fa0ee130c936b0e7335614a6dd90ad57f54ca79fb` |
| `S` sig (DER + `0x83`) | `304402206db331b2bba37bc22b8ceaf3c199843a1f268061019be24077a0809aea7d4dc9022045e5c10a3ee058154c50048fa0ee130c936b0e7335614a6dd90ad57f54ca79fb83` |

### A.3.3 `C_3` — commitment number 45, vouchers 1..3

| Field | Value |
|---|---|
| commitment number (R) | 45 |
| `per_commitment_point_R[45]` | `02cb70d6bbd9e541cc97080c21554bb5bad9a97106bd8cddf87e58fff251843f52` |
| obscured commitment number | `0xb9c570f08184` |
| commitment fee (paid by S) | 4100 sat |
| txid | `237d464440a2ad7b5e80f10307cdcee57545c0b51fcde5619c56c170285f9c8b` |

Derived keys on this commitment (holder = `R`):

| Key | Value |
|---|---|
| revocation pubkey | `03d657f51a1539139d6dccee55764f737d60aa97fb90a1332761b4cfec0b9681b8` |
| R delayed pubkey (`to_local`) | `03b21e3aa00667618794aa1f57be300787d1d9644bbcd34d8b221959b8ca7b7c74` |
| R HTLC pubkey | `02fc9e53b3294ec2cad228ec6009e23d7b58865f558095301d6abc081c1b59c3f7` |
| S HTLC pubkey | `034c36d000352fa6253967b8b1744cbd73c7e745dce4228f38a463d00f6a5c91b1` |
| `to_remote` key (static, = S payment basepoint) | `032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991` |

Outputs (BOLT 3 order):

| # | Output | Amount (sat) | scriptPubKey |
|---|---|---|---|
| 0 | anchor (R) | 330 | `00202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f` |
| 1 | anchor (S) | 330 | `0020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb3994` |
| 2 | voucher_2 (received HTLC) | 546 | `00202ba955f11e6e7c7e0a6be9faa08f6d2f30df75c93848a1915c344829a5564d98` |
| 3 | voucher_1 (received HTLC) | 994 | `0020ff4a1c5e58c03b66de6eb3898a569b108e6f041d623e7c8aa59a0177e2a27030` |
| 4 | voucher_3 (received HTLC) | 49749 | `002083027f3f87e89640917886cdf2d4e6b82517d8b515b83dc47fb7016530e3d0e7` |
| 5 | to_local (R) | 3000000 | `00204ebfb56ddcb89f093cc4adab0b1eb21bfd1e2d5325ca49474b7a490f1f55b838` |
| 6 | to_remote (S) | 6943951 | `0020f3394e1e619b0eca1f91be2fb5ab4dfc59ba5b84ebe014ad1d43a564d012994a` |

Transaction (unsigned funding input, as signed by both parties):

```
0200000001bef67e4e2fb9ddeeb3461973cd4c62abb35050b1add772995b820b584a488489000000000070c5b980074a010000000000002200202b1b5854183c12d3316565972c4668929d314d81c5dcdbb21cb45fe8a9a8114f4a01000000000000220020e9e86e4823faa62e222ebc858a226636856158f07e69898da3b0d1af0ddb399422020000000000002200202ba955f11e6e7c7e0a6be9faa08f6d2f30df75c93848a1915c344829a5564d98e203000000000000220020ff4a1c5e58c03b66de6eb3898a569b108e6f041d623e7c8aa59a0177e2a2703055c200000000000022002083027f3f87e89640917886cdf2d4e6b82517d8b515b83dc47fb7016530e3d0e7c0c62d00000000002200204ebfb56ddcb89f093cc4adab0b1eb21bfd1e2d5325ca49474b7a490f1f55b838cff4690000000000220020f3394e1e619b0eca1f91be2fb5ab4dfc59ba5b84ebe014ad1d43a564d012994a8481f020
```

`S` commitment signature (`ff_settlement.commitment_sig`):

- compact: `596641c99683b7484dbdf98f6c64df41e5a40d562ae66c767231ff9d5bd2d6e67594260fa308e1cfffdd6c7f570fc5fad922a2a3f0103f9800aa3b98b976725d`
- DER + `SIGHASH_ALL`: `30440220596641c99683b7484dbdf98f6c64df41e5a40d562ae66c767231ff9d5bd2d6e602207594260fa308e1cfffdd6c7f570fc5fad922a2a3f0103f9800aa3b98b976725d01`

`S` HTLC signatures (`ff_settlement.htlc_sigs`, 3 sigs, BOLT 3 output order,
`SIGHASH_SINGLE|ANYONECANPAY` over the HTLC-success transaction, anchor
rules: zero fee, input `nSequence = 1`):

#### htlc_sig for voucher 2 (output 2, 546 sat)

| Field | Value |
|---|---|
| HTLC witness script (received HTLC, `cltv_expiry` 800000) | `76a91420d99eec924ebefe841f651d91464ad2373b34a18763ac6721034c36d000352fa6253967b8b1744cbd73c7e745dce4228f38a463d00f6a5c91b17c8201208763a914b43e1b38138a41b37f7cd9a1d274bc63e3a9b5d188527c2102fc9e53b3294ec2cad228ec6009e23d7b58865f558095301d6abc081c1b59c3f752ae67750300350cb175ac6851b27568` |
| HTLC-success tx (unsigned) | `02000000018b9c5f2870c1569c61e5cd1fb5c04575e5cecd0703f1805e7bada24044467d230200000000010000000122020000000000002200204ebfb56ddcb89f093cc4adab0b1eb21bfd1e2d5325ca49474b7a490f1f55b83800000000` |
| HTLC-success txid | `d150284e54e33db780a1280f99b60682ed9970e058eaa4ca2da02714ce21ba64` |
| sighash (`SINGLE\|ANYONECANPAY` = `0x83`) | `2cdd0e85ff92a1f50e75849b3c6044f99feebf97b9f4577b1334dbeadcf5f76f` |
| `S` sig (compact) | `8371216a9a675a69592d08dbc5bfbed45c26bef7394a1a49dbe0c98fcc23236e13e03c2a16938658149142d820efb8b2cca9d1fb4c0a5e6935a99791baae7034` |
| `S` sig (DER + `0x83`) | `30450221008371216a9a675a69592d08dbc5bfbed45c26bef7394a1a49dbe0c98fcc23236e022013e03c2a16938658149142d820efb8b2cca9d1fb4c0a5e6935a99791baae703483` |

#### htlc_sig for voucher 1 (output 3, 994 sat)

| Field | Value |
|---|---|
| HTLC witness script (received HTLC, `cltv_expiry` 800000) | `76a91420d99eec924ebefe841f651d91464ad2373b34a18763ac6721034c36d000352fa6253967b8b1744cbd73c7e745dce4228f38a463d00f6a5c91b17c8201208763a9149dac0ba2874023dcb252d34da5934a193b73697e88527c2102fc9e53b3294ec2cad228ec6009e23d7b58865f558095301d6abc081c1b59c3f752ae67750300350cb175ac6851b27568` |
| HTLC-success tx (unsigned) | `02000000018b9c5f2870c1569c61e5cd1fb5c04575e5cecd0703f1805e7bada24044467d2303000000000100000001e2030000000000002200204ebfb56ddcb89f093cc4adab0b1eb21bfd1e2d5325ca49474b7a490f1f55b83800000000` |
| HTLC-success txid | `ae50d79b8b7c6c7a6af82d6dde8c8b1c27597008cfb8424e965e7232afec47d3` |
| sighash (`SINGLE\|ANYONECANPAY` = `0x83`) | `f1b9025a70d62b736102e5ed026b2fae1b656d840f59369e589164a088bd2c9f` |
| `S` sig (compact) | `196d0d67f5b688ad7cf4c866efde492253e8e7af20436c5557c7c7c6c86f0de36c4c17ebb10aec4d6535aa841c3460a5c9a20ad5f67282e6c89438eff29e7caf` |
| `S` sig (DER + `0x83`) | `30440220196d0d67f5b688ad7cf4c866efde492253e8e7af20436c5557c7c7c6c86f0de302206c4c17ebb10aec4d6535aa841c3460a5c9a20ad5f67282e6c89438eff29e7caf83` |

#### htlc_sig for voucher 3 (output 4, 49749 sat)

| Field | Value |
|---|---|
| HTLC witness script (received HTLC, `cltv_expiry` 800000) | `76a91420d99eec924ebefe841f651d91464ad2373b34a18763ac6721034c36d000352fa6253967b8b1744cbd73c7e745dce4228f38a463d00f6a5c91b17c8201208763a9148a486ff2e31d6158bf39e2608864d63fefd09d5b88527c2102fc9e53b3294ec2cad228ec6009e23d7b58865f558095301d6abc081c1b59c3f752ae67750300350cb175ac6851b27568` |
| HTLC-success tx (unsigned) | `02000000018b9c5f2870c1569c61e5cd1fb5c04575e5cecd0703f1805e7bada24044467d230400000000010000000155c20000000000002200204ebfb56ddcb89f093cc4adab0b1eb21bfd1e2d5325ca49474b7a490f1f55b83800000000` |
| HTLC-success txid | `fb56f5d6dbf4bd98687dcbf941550daef9c5a858c70bf5f3ccbf1023a5ee7bcf` |
| sighash (`SINGLE\|ANYONECANPAY` = `0x83`) | `a2b64c0ee2d9bd22ff1efa71662e793ebdb63265ad7d9ba0651f594530571323` |
| `S` sig (compact) | `c8b824d74c765f51e2fa4dbb737fad2337dcf66ddfefa6fc7a5467543108574a01ce87211237d0f12015602bda4451b6615c95b4e9d4224371811e828f76b50a` |
| `S` sig (DER + `0x83`) | `3045022100c8b824d74c765f51e2fa4dbb737fad2337dcf66ddfefa6fc7a5467543108574a022001ce87211237d0f12015602bda4451b6615c95b4e9d4224371811e828f76b50a83` |

## A.4 Verification performed by the generator

All of the following are hard assertions in the generator (it refuses to
emit vectors if any fails):

1. Fixture keys re-derive the BOLT 3 Appendix C funding pubkeys, payment
   basepoints, and funding witness script.
2. For every `C_i`: `R`, holding only the epoch parameters and settlement
   history, rebuilds the commitment from its own (mirror) channel state
   byte-identically to `S`'s construction (beignet `buildLocalCommitment`
   vs `buildRemoteCommitment`).
3. `S`'s commitment signature verifies via beignet's
   `verifyRemoteCommitmentSig` AND via an independent strict (low-S) ECDSA
   check against the BIP 143 sighash of the funding input.
4. `S`'s htlc_sigs verify via beignet's `verifyRemoteHtlcSignatures` AND
   via independent strict ECDSA checks against the
   `SIGHASH_SINGLE|ANYONECANPAY` sighash of each reconstructed HTLC-success
   transaction.
5. Every voucher clears the dust floor; cumulative value stays within
   `budget_msat`; `i <= K`; `S` stays above `channel_reserve`.
6. `H_1 = SHA256(per_commitment_secret_S[n0])` and
   `P_1·G = per_commitment_point_S[n0]` (FFOR §7.2 Variant-A binding).
7. Each commitment tx hex round-trips through the transaction decoder to
   the same txid.

Additionally (out-of-band, not a generator assertion): the `C_0..C_3` hex
and the HTLC-success transactions were decoded with Bitcoin Core 29.1
`decoderawtransaction`, which reports the same txids, prevouts, values,
sequences, and locktimes as listed above.

## A.5 How to regenerate

```sh
cd <beignet repo>   # sibling of the specs repo, master branch
npx ts-node -P ../specs/tools/tsconfig.json \
  ../specs/tools/generate-ffor-vectors.ts > ../specs/ffor-test-vectors.md
```

The generator ([tools/generate-ffor-vectors.ts](tools/generate-ffor-vectors.ts))
imports beignet from source (`../beignet/src/lightning/...`) and writes this
entire file to stdout. Output is deterministic: running it twice yields
byte-identical results.

## A.6 Deviations / spec feedback

1. **`commitment_sig` size (§9.1):** the `ff_settlement` field table says
   64 bytes (compact), matching BOLT 2 wire signatures. These vectors give
   both the 64-byte compact form and the DER+sighash form used in witnesses,
   since delegated verification and fraud proofs need to re-encode anyway.
   The spec could state explicitly that `commitment_sig`/`htlc_sigs` use the
   BOLT 2 64-byte compact encoding.
2. **Voucher dust floor with anchors (§8):** §8 defines the floor as
   `dust_limit + HTLC-success fee at the frozen feerate`. Under
   `option_anchors_zero_fee_htlc_tx` the second-level fee is zero, so the
   floor is exactly `dust_limit`. The spec text is correct but worth an
   explicit note; the scripted 250,000 msat payment 2 trims at these
   parameters and was bumped to 550,000 msat (see A.2).
3. **Sub-satoshi remainders (§8):** "`S`'s `to_local` is reduced by `Σ v_k`"
   is exact in msat, but on-chain the voucher output is floored to whole
   satoshis and BOLT 3 keeps the truncated remainder with the *offerer*
   (`S`) — visible here as `v_2`'s 250 msat staying in `S`'s balance
   (`to_remote` on `C_2`/`C_3` is 1 sat higher than a naive floor-everything
   calculation). Deterministic reconstruction must implement this rule; the
   spec should reference it.
4. **`htlc_sigs` ordering (§9.1):** "BOLT 3 output order" is *not* voucher
   sequence order — on `C_2`/`C_3`, voucher 2 (546 sat) sorts before
   voucher 1 (994 sat). The vectors exercise this; implementations must map
   sigs by output index, not by `seq`.
5. **beignet fidelity:** no deviations were required — beignet's builder
   expresses the full construction (anchors + static_remotekey, frozen
   feerate, far-future `cltv_expiry = 800000`, explicit commitment numbers,
   BOLT 3 trimming/ordering/remainders) without modification.

---

*Generated by `tools/generate-ffor-vectors.ts` against beignet master using
its real BOLT 3 commitment-builder and signer.*
