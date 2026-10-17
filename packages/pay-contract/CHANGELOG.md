# Changelog

All notable changes to `@devslab-kr/pay-contract`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow the wire rules in the README (breaking wire change = major).

## 0.2.0 — unreleased

Additive. Every 0.1.0 command, response and helper keeps its shape and meaning; a 0.1.0 caller compiles and runs unchanged.

### Added

- Checkout return registry: `CHECKOUT_RETURN_REGISTRY` (frozen `{contract: https://contract.devslab.kr ['/notify'], admin: https://admin.devslab.kr ['/payments']}`), the `CheckoutReturn` entry type (`{service, path}`, exactly these keys), `DEFAULT_CHECKOUT_RETURNS`, `isCheckoutReturnService`, `isCheckoutReturn`, `resolveCheckoutReturn` and the redirect builder `checkoutReturnUrl`. The builder only ever returns a registry origin and path with fixed query parameters (`paymentOrder` for Contract; `companyId`, `testOrderId` for Admin; `paymentResult` for both) and throws `invalid_input` for anything else: absolute or protocol-relative URLs, encoded or dot-segment paths, other services' paths, unknown or inherited service names, extra fields, identifiers outside `CHECKOUT_RETURN_ID_PATTERN`.
- `prepareCheckout` accepts an optional `returnTo: CheckoutReturn`. It must name the same service as `returnTarget`; without it Pay uses `DEFAULT_CHECKOUT_RETURNS[returnTarget]`, which are the redirects Admin hard-coded before 0.2.0. Pay rejects any other value with `invalid_input` before issuing a checkout state.
- `CheckoutCaptureResult.returnTo` (optional in the type; Pay 0.2.0 always sends it). `parseCheckoutCaptureResult` validates it against the registry and the returned `returnTarget`, and fills the default entry for a response without it, so its result always carries `returnTo`.
- Order amounts: `RECHARGE_MAXIMUM_SUPPLY_KRW` (1,000,000 KRW supply per order) and `calculateOrderRecharge`, which is `calculateRecharge` plus that maximum. Pay applies it to `createOrder`.

### Changed (Pay behaviour, same wire shapes)

- `createOrder` rejects a supply above `RECHARGE_MAXIMUM_SUPPLY_KRW` with `invalid_input`. `calculateRecharge` itself is unchanged; existing orders and legacy imports above the maximum stay readable.
- Pay credits the wallet only after its own server-side provider lookup matched the saved order's payment key, order id, merchant (the receipt's `mId` must equal the connection's `providerAccountId`), amount, currency and status. A receipt without a matching `mId` stays `provider_unknown` and is never credited.

### Migration notes for Admin

- Deploy Pay 0.2.0 before Admin sends `returnTo`: Pay 0.1.0 rejects the unknown key with `invalid_input`.
- Build the post-callback redirect with `checkoutReturnUrl(parseCheckoutCaptureResult(result))` instead of hard-coded URLs.

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
