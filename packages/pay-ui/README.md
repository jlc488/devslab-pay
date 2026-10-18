# @devslab-kr/pay-ui

Presentational React components for DevsLab Pay data. Admin (operator portal) and Contract both assemble their recharge and payment screens from these components instead of keeping their own copies.

The components only render what they are given and report what the user did. They do not fetch, route, authenticate, open the payment window or hold keys: the app talks to Pay on its server, passes data typed with [`@devslab-kr/pay-contract`](../pay-contract), and handles the callbacks. Copy that genuinely differs between apps is a prop or a slot.

## Components

| Component | Props | Renders |
|---|---|---|
| `RechargeAmount` | `value` (text), `onChange`, `label?`, `disabled?`, `maxSupplyKrw?` (an app ceiling below Pay's) | The supply-amount field (1,000원 이상 · 1,000원 단위 · 최대 1,000,000원 since 0.2.0) with the balance / VAT / total breakdown beside it, computed with the contract's `calculateOrderRecharge` |
| `RechargeBreakdown` | `amounts` or `null` | The three-line breakdown on its own; rows keep a dash while the amount is invalid |
| `OrderHistory` | `state: Loadable<{ items; nextCursor }>`, `onSelect?(order)`, `onLoadMore?(cursor)`, `busy?`, `title?`, `actions?` (buttons beside the title), `emptyText?` | Orders with state pills, supply / VAT / total, order number, "주문 보기" and "이전 결제 내역 더 보기" |
| `OrderSummary` | `order`, `title?`, `children` (the app's buttons) | One order: state, order number, the amount split and a do-not-pay-again note while it settles |
| `TestWalletSummary` | `wallet: TestWallet`, `title?` | Test balance, amount held for refunds, refunded total |
| `PaymentConnectionView` (0.2.0) | `snapshot` (state, typed fields, busy/error/notice, pending revoke), `ready`, `actions` (load, set fields, connect, ask, cancel, confirm), `notReadyText?`, `formNote?`, `summaryExtra?` | The company's Toss **test** account: summary (MID, client-key hint, version), connect/replace form (MID, client key, secret key on one grid row), version history with revoke and a confirm step. States that live payments are not possible and the 1,000,000원 per-order maximum. The app owns the requests and clears the typed keys after submit |
| `PaymentStatePill`, `Pill`, `PaymentConnectionStatusPill` | `state` / `tone` | DDS badges with a label (a state a later Pay version adds reads "상태 확인 필요") |

`Loadable<T>` is the state the history takes:

```ts
type Loadable<T> =
  | { status: "loading" }                                          // same frame with skeleton rows
  | { status: "unavailable"; message: ReactNode }                   // not set up or not permitted; the app words it
  | { status: "error"; message: ReactNode; onRetry?: () => void }   // the request failed; optional retry button
  | { status: "ready"; data: T };
```

Helpers: `rechargeAmounts(raw, maxSupplyKrw?)`, `paymentConnectionProblem`, `isPaymentConnectionInput`, `maskedClientKeyHint`, `paymentStateLabel`, `SETTLING_PAYMENT_STATES`, `formatKrw`, `formatKstDateTime`.

## Styles

Import the stylesheet once, after the DDS stylesheet:

```ts
import "@devslab/dds-react/styles.css";
import "@devslab-kr/pay-ui/styles.css";
```

Every class is prefixed `dl-pay-*` and every value is a DDS token. Tables, badges and skeletons use the DDS classes. Components size themselves with container queries, so they fit a sidebar console and a 320px phone without horizontal page scroll; the history table scrolls inside its own frame.

## Install

Published to GitHub Packages (see the [pay-contract README](../pay-contract/README.md) for `.npmrc` and the token):

```sh
npm install --save-exact @devslab-kr/pay-ui@0.2.0 @devslab-kr/pay-contract@0.3.0
```

Peer dependencies: `react` 19 and `@devslab/dds-react` ^0.21.2. The package ships compiled ESM with declarations and `dist/styles.css`.

## Versioning

Semantic versioning on the component API: removing or renaming a component, a prop or a class the apps style against is a major change; new optional props and components are minor; copy and style fixes are patches.
