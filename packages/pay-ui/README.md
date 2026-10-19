# @devslab-kr/pay-ui

Presentational React components for DevsLab Pay data. Admin (operator portal) and Contract both assemble their recharge and payment screens from these components instead of keeping their own copies.

The components only render what they are given and report what the user did. They do not fetch, route, authenticate, open the payment window or hold keys: the app talks to Pay on its server, passes data typed with [`@devslab-kr/pay-contract`](../pay-contract), and handles the callbacks. Copy that genuinely differs between apps is a prop or a slot.

## Components

| Component | Props | Renders |
|---|---|---|
| `RechargeAmount` | `value` (text), `onChange`, `label?`, `disabled?`, `maxSupplyKrw?` (an app ceiling below Pay's) | The supply-amount field (1,000원 이상 · 1,000원 단위 · 최대 1,000,000원 since 0.2.0) with the balance / VAT / total breakdown beside it, computed with the contract's `calculateOrderRecharge`. Pass `disabled={action.busy}` while the app's submit runs |
| `RechargeBreakdown` | `amounts` or `null` | The three-line breakdown on its own; rows keep a dash while the amount is invalid |
| `OrderHistory` | `state: Loadable<{ items; nextCursor }>`, `onSelect?(order)`, `onLoadMore?(cursor)`, `busy?` (locks the buttons), `loadingMore?`, `selecting?(order)`, `loadMoreError?` (0.3.0), `title?`, `actions?` (buttons beside the title), `emptyText?` | Orders with state pills, supply / VAT / total, order number, "주문 보기" and "이전 결제 내역 더 보기". Progress shows only on the button whose request runs; a failed older page is explained beside its button while the rows already shown stay |
| `OrderSummary` | `order`, `title?`, `children` (the app's buttons) | One order: state, order number, the amount split and a do-not-pay-again note while it settles |
| `TestWalletSummary` | `wallet: TestWallet`, `title?` | Test balance, amount held for refunds, refunded total |
| `PaymentConnectionView` (0.2.0, reworked in 0.3.0) | `snapshot` (`data`, `loading`, `busy` action key, typed fields, `pending` revoke request), `ready`, `actions` (load, set fields, connect, ask, cancel, confirm), `notReadyText?`, `formNote?`, `summaryExtra?`, `loadError?`, `formResult?` | The company's Toss **test** account: summary (MID, client-key hint, version), connect/replace form (MID, client key, secret key on one grid row), version history with revoke and a confirm step. States that live payments are not possible and the 1,000,000원 per-order maximum. While the first load runs, the form (fields locked) and history are drawn at their real size. The app owns the requests and clears the typed keys before it sends them |
| `PaymentStatePill`, `Pill`, `PaymentConnectionStatusPill` | `state` / `tone` | DDS badges with a label (a state a later Pay version adds reads "상태 확인 필요") |

`Loadable<T>` is the state the history takes:

```ts
type Loadable<T> =
  | { status: "loading" }                                          // same frame with skeleton rows
  | { status: "unavailable"; message: ReactNode }                   // not set up or not permitted; the app words it
  | { status: "error"; message: ReactNode; onRetry?: () => void; retrying?: boolean } // the request failed; optional retry button, spinning while `retrying`
  | { status: "ready"; data: T };
```

Helpers: `rechargeAmounts(raw, maxSupplyKrw?)`, `paymentConnectionProblem`, `isPaymentConnectionInput`, `maskedClientKeyHint`, `paymentStateLabel`, `SETTLING_PAYMENT_STATES`, `formatKrw`, `formatKstDateTime`.

## Progress and results (since 0.3.0)

The components never import `usePendingAction`; they take the values it gives. The app keeps one `usePendingAction` per set of actions that must not overlap and passes its keys through, so only the pressed button spins (DDS `Button loading`) and every other control is locked while anything runs. Button names never change while they work.

```tsx
import { usePendingAction } from "@devslab/dds-react";

// Connect, revoke and the app's own buttons change the same connection: one at a time.
const act = usePendingAction<"connect" | "confirm" | "platform" | "reapply">();
// Loading is separate so a reload can replace the previous one (`replace: true`).
const load = usePendingAction<"load" | "sync">();

<PaymentConnectionView
  snapshot={{ data, loading, busy: act.current ?? load.current, merchantId, clientKey, secretKey, pending }}
  ready={ready}
  actions={actions}
  loadError={loadError}     // why the load failed, shown once next to 다시 조회
  formResult={keyRefused}   // a result caused by what was typed, beside the submit button
/>

const list = usePendingAction<"refresh" | "more" | `select:${string}`>();
<OrderHistory
  state={state}
  busy={list.busy}
  loadingMore={list.is("more")}
  selecting={(order) => list.is(`select:${order.id}`)}
  loadMoreError={moreError}
  onLoadMore={more}
  onSelect={open}
/>
```

- `PaymentConnectionView` spins `"load"` on 다시 조회, `"connect"` on the submit button and `"confirm"` on the confirm step's revoke button. Any other key (`"platform"`, `"reapply"`, a reload nobody pressed such as `"sync"`) only locks the view; the app gives its own slot buttons `loading={act.is(...)}`.
- `actions.load`, `connect` and `confirm` handle their own failures and never reject; the view only starts them.
- Results of an action (connected, revoked, a server failure) go to the app's toast feedback. Only results that belong next to their cause go in the slots: `loadError`, `formResult` and `loadMoreError` sit on lines that are always reserved, so nothing moves when a message comes or goes. Pass plain text; the view supplies the alert role.
- `aria-busy` marks a region only while its data loads (`loading`, `loadingMore`), not while some other action runs.

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
npm install --save-exact @devslab-kr/pay-ui@0.3.0 @devslab-kr/pay-contract@0.3.0
```

Peer dependencies: `react` 19 and `@devslab/dds-react` ^0.23.0 (the version the apps render; the tests run against 0.23.0). The package ships compiled ESM with declarations and `dist/styles.css`.

## Versioning

Semantic versioning on the component API: removing or renaming a component, a prop or a class the apps style against is a breaking change; new optional props and components are minor; copy and style fixes are patches. Before 1.0 a breaking change moves the minor digit (0.2 → 0.3), and the apps pin exact versions, so the CHANGELOG lists what each app must change.
