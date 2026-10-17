# Changelog

All notable changes to `@devslab-kr/pay-contract`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow the wire rules in the README (breaking wire change = major).

## 0.1.0 — unreleased

First version. Describes Pay's private RPC v1 as it is served today; Pay compiles against it. Replaces the hand-copied `src/server/pay-contract.ts` in Admin.

### Added

- RPC types: `PayCommand`/`ScopedPayCommand`, `PayResponse`, `PayResult`, `PayBinding`, `PayEffectAuthority`, `PayScope`, connection and ledger snapshots, `PublicOrder`, `OrderPage`, `PaymentCapabilities`, `PaymentConfig`, `TestWallet`, checkout preparation/callback/capture, legacy import (`LegacyPaymentOrder`, `OwnershipFence`, `ImportReceipt`, `SourceCommittedProof`), `ConnectionInspection`, `PublicPolicy`. Unchanged from the copied v1 file; `PaymentState` is now derived from `PAYMENT_STATES`.
- `PAY_ERROR_CODES` with `isPayErrorCode`; Pay's error type only accepts these codes.
- Pricing: `calculateRecharge` (minimum 1000 KRW, step 1000, VAT 10% on top, wallet credited with the supply), `PAYMENT_PRICING` and the individual constants.
- Formats: `isPayText`, `OPERATION_ID_PATTERN`, `isUtcTimestamp`, order page/cursor limits, the 43-character checkout state and its hash format, fixed callback origin/paths with `checkoutCallbackUrl`, `CHECKOUT_ORDER_NAME`, client key, customer key and reason code formats.
- Digests: `canonicalJson`, `sha256Hex`, `importDigest` (the importLegacy/OwnershipFence digest) and `checkoutStateHash`.
- Response parsers: `parsePublicOrder`, `parseOrderPage`, `parseCapabilities`, `parseCheckoutPreparation`, `parseCheckoutCaptureResult`, throwing `PayContractError` (`invalid_response`).

### Migration notes for Admin

- `canonicalJson` throws for `undefined`, `NaN` and `±Infinity` at any depth. Admin's `canonicalJson` in `company-integrations.ts` omits `undefined` properties and writes non-finite numbers as `null`; for a snapshot without such values both produce the same string. Compute the import digest with this package's `importDigest`, and omit optional keys instead of setting them to `undefined`.
