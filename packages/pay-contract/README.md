# @devslab-kr/pay-contract

The versioned wire contract of DevsLab Pay's private RPC. Services that call Pay (Admin, and Contract through Admin) install this package instead of copying Pay's command and response shapes by hand.

Pay itself compiles against this package: its RPC entrypoint and handlers use these types, its pricing, text/timestamp/operation formats, checkout callback URLs and import digest come from here, and its error type only accepts codes listed here. A shape published here is the shape Pay serves.

## What it contains

| Kind | Exports |
|---|---|
| RPC types | `PayCommand`, `ScopedPayCommand`, `PayResponse`, `PayResult`, `PayBinding`, `PayEffectAuthority`, `PayScope`, `ConnectionSnapshot`, `LedgerSnapshot`, `PublicOrder`, `OrderPage`, `PaymentState`, `PaymentCapabilities`, `PaymentConfig`, `TestWallet`, `CheckoutPreparation`, `CheckoutCallback`, `CheckoutCaptureResult`, `ConnectionInspection`, `LegacyPaymentOrder`, `OwnershipFence`, `ImportReceipt`, `SourceCommittedProof`, `PublicPolicy` |
| States and error codes | `PAYMENT_STATES`, `PAY_ERROR_CODES`, `PayErrorCode`, `isPayErrorCode` |
| Pricing | `calculateRecharge`, `RechargeAmounts`, `PAYMENT_PRICING`, `RECHARGE_MINIMUM_SUPPLY_KRW`/`RECHARGE_STEP_SUPPLY_KRW` (1000/1000), `VAT_RATE_PERCENT` (10, added on top), `MESSAGE_UNIT_PRICE_KRW` (100) |
| Formats | `isPayText`/`PAY_TEXT_MAX_LENGTH`, `OPERATION_ID_PATTERN`/`isOperationId`, `UTC_TIMESTAMP_PATTERN`/`isUtcTimestamp`, `ORDER_PAGE_MAX_ITEMS` (50), `ORDER_CURSOR_MAX_LENGTH` (2048), `REASON_CODE_PATTERN`, `TEST_CLIENT_KEY_PATTERN`, `CUSTOMER_KEY_PATTERN` |
| Checkout | `CHECKOUT_STATE_LENGTH` (43)/`CHECKOUT_STATE_PATTERN`/`isCheckoutState`, `CHECKOUT_STATE_HASH_PATTERN`, `CHECKOUT_CALLBACK_ORIGIN`, `CHECKOUT_CALLBACK_PATHS`, `checkoutCallbackUrl`, `CHECKOUT_ORDER_NAME` |
| Digests | `canonicalJson`, `sha256Hex`, `importDigest` (+ `ImportDigestInput`), `checkoutStateHash` |
| Response parsers | `parsePublicOrder`, `parseOrderPage`, `parseCapabilities`, `parseCheckoutPreparation`, `parseCheckoutCaptureResult` |

Everything is pure and has no runtime dependencies. It runs in Workers, Node (24+) and browsers; the digests use Web Crypto.

### Rules

- Helpers throw `PayContractError` with a stable `code`: `invalid_input` for a value Pay rejects with HTTP 400 and the same code (`calculateRecharge`, `canonicalJson`, `checkoutStateHash`, `checkoutCallbackUrl`), `invalid_response` for a response that does not match this contract version. Messages never contain the checked values.
- Parsers enforce the invariants Pay guarantees: test mode only, amounts that `calculateRecharge` produces, known states, Pay's text and timestamp formats, at most 50 orders per page, fixed pricing, `mode: 'test'` together with `provider: 'toss'`, and checkout callbacks that are exactly the fixed Admin URLs sharing one 43-character state. They return a new object with only the contract's fields; extra fields are dropped, so Pay can add a field in a minor version. Checks that need the caller's context stay with the caller: the expected company, that a preparation matches the order it was asked for, and that `expiresAt` is still in the future.
- `importDigest` is a cross-service contract: Admin computes it over the frozen legacy snapshot `{migrationId, generation, order, connection, ledger}` and Pay recomputes it from the received command. `canonicalJson` sorts object keys by UTF-16 code units and throws for `undefined`, `NaN` and `±Infinity`; leave optional keys out rather than setting them to `undefined`.

```ts
import { importDigest, parsePublicOrder, PayContractError, type PayBinding } from "@devslab-kr/pay-contract";

const snapshot = { migrationId, generation, order, connection, ledger };
const response = await env.PAY.dispatch({ action: "importLegacy", scope, ...snapshot, digest: await importDigest(snapshot) });

const order = await env.PAY.dispatch({ action: "getOrder", scope, id });
if (order.ok) {
  const parsed = parsePublicOrder(order.result); // or PayContractError("invalid_response")
  if (parsed.companyId !== scope.companyId) throw new Error("foreign order");
}
```

Not part of the contract: Pay's D1 store and migrations, the credential registry and secret bindings, the Toss gateway and its receipt parsing, the Notify test-ledger client, the effect-authority implementation and the policy fetcher.

## Install

The package is published to GitHub Packages, not npmjs.com. In the consuming repository's `.npmrc`:

```ini
@devslab-kr:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

`NODE_AUTH_TOKEN` must be a token that can read `@devslab-kr` packages (a classic personal access token with `read:packages`; GitHub Packages does not accept fine-grained tokens for npm). In CI, store it as a repository secret and pass it to `npm ci` as `NODE_AUTH_TOKEN`.

```sh
npm install --save-exact @devslab-kr/pay-contract@0.1.0
```

The package ships compiled ESM (`dist/*.js`) with declarations (`dist/*.d.ts`). It is checked against a consumer using TypeScript 7 with `moduleResolution: "bundler"` and `strict`, without `exactOptionalPropertyTypes` or `noUncheckedIndexedAccess`.

## Versioning

Semantic versioning, applied to the wire:

- **Major**: any change that can make a working caller fail. Removing or renaming a command, field or error code; narrowing a value set; changing a price, limit, format, callback URL or the digest; making a parser stricter.
- **Minor**: additive changes existing callers tolerate. A new optional command field, a new response field (parsers drop it until the caller upgrades), a new command or a new error code.
- **Patch**: documentation and fixes that do not change accepted or produced shapes.

Consumers pin an exact version (`--save-exact`, no `^`/`~`) and upgrade deliberately. Pay deploys a breaking wire change only together with a new major version of this package. See [CHANGELOG.md](./CHANGELOG.md).

## Development

This package lives in the Pay repository (`packages/pay-contract`) and Pay consumes it through the npm workspace, never from the registry.

```sh
npm run build:contract                                # tsc → packages/pay-contract/dist/
npm test --workspace @devslab-kr/pay-contract         # unit tests + consumer compatibility compile
npm run pack:contract                                 # npm pack --dry-run, checks the file list
```

The root `typecheck`, `test`, `build` and `dev` scripts build this package first, because the Worker imports its compiled output.
