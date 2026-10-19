# Changelog

All notable changes to `@devslab-kr/pay-ui`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.3.0 — unreleased

Progress shows only on the button whose action runs, every other control is locked meanwhile, and action results move to the app's toast feedback. Breaking for `PaymentConnectionView` (before 1.0 a breaking change moves the minor digit); `OrderHistory` and `Loadable` changes are additive. Requires `@devslab/dds-react` 0.23.

### Changed

- **Breaking:** peer `@devslab/dds-react` is now `^0.23.0` (was `^0.21.2`, which as a 0.x caret excluded the 0.22 and 0.23 the apps already render through `overrides`). The tests run against 0.23.0. The package uses DDS `Button loading` and does not import `usePendingAction`.
- **Breaking:** `PaymentConnectionSnapshot.error` and `notice` are removed with the lines they drew at the top of the view (and the `dl-pay-inline-error` / `dl-pay-inline-notice` classes). They showed every result far from its cause, pushed the content down each time and repeated a load failure the summary already stated. Report action results (connected, replaced, revoked, server failures) with the app's toast feedback; use the new `loadError` and `formResult` props for the two results that belong next to their cause.
- **Breaking in type only:** `PaymentConnectionSnapshot.busy` takes any action key (`PaymentConnectionBusy`), so the app passes its `usePendingAction` keys straight through (`act.current ?? load.current`). `"load"`, `"connect"` and `"confirm"` spin 다시 조회, the submit button and the confirm step's revoke button; any other key (`"platform"`, `"reapply"`, `"sync"`) only locks. Before, an app action had to borrow one of the three keys and spun a button nobody pressed.
- Any running action now locks the submit button and both confirm-step buttons. Before, the submit button followed only `canSubmit` and the confirm step only `"confirm"`, so a connect and a revoke could be sent at the same time.
- Progress is DDS `Button loading` (spinner, `aria-busy`) instead of swapping the label to "Toss에서 확인 중…", "처리 중…" or "조회 중…"; button names stay fixed. The form's lead now says the Toss check can take a few seconds.
- While the first load runs (`loading` with no `data`), the summary, the form (fields locked) and the history are drawn at their real size with skeletons instead of one loading sentence, so nothing jumps when the data comes. The view keeps `aria-busy` only while data loads, not while any action runs.
- `OrderHistory` marks itself `aria-busy` only while it loads or loads more, not whenever the app's `busy` is set. The "주문 보기" column keeps room for the spinner, so the columns do not shift while one order loads.

### Added

- `PaymentConnectionView` props `loadError` (why the load failed, stated once next to 다시 조회) and `formResult` (a result caused by what was typed, such as Toss refusing the keys, beside the submit button on an always-reserved line; under the button once the form is one column wide, so the form keeps its height whatever the button's label or the first-load skeleton's width). Both get the alert role from the view.
- `OrderHistory` props `loadingMore` (the load-more button spins), `selecting(order)` (only that row's "주문 보기" spins) and `loadMoreError` (why the older page did not load, beside its button on an always-reserved line; the rows already shown stay). `busy` keeps its meaning: lock the buttons.
- `Loadable` error state `retrying`: 다시 조회 spins and cannot be pressed again while the retry runs.
- Types `PaymentConnectionBusy` and `PaymentConnectionRevokeRequest`; classes `dl-pay-result`, `dl-pay-skeleton-button` and `dl-pay-select`.

### Deprecated

- `PaymentConnectionPendingAction`: renamed to `PaymentConnectionRevokeRequest` (without `| null`), so a revoke waiting for confirmation is not confused with DDS `PendingAction`, which is work in progress. The old name stays as an alias and will be removed later.

### Migration

- Admin (`PaymentConnectionPanel`): stop putting results in `error` / `notice`; report them with `useFeedback` and pass Toss's refusal of the keys as `formResult`, a failed load as `loadError`. Pass `busy={act.current ?? load.current}`; give the "DevsLab 테스트 계정으로 연결" and "현재 연결 적용" buttons their own keys and `loading={act.is(...)}` instead of reusing `"connect"` / `"confirm"`.
- Admin and Contract (`OrderHistory`): pass `busy={list.busy}` with `loadingMore` / `selecting` for the button that runs, and `loadMoreError` instead of a separate line under the table. Remove the `@devslab-kr/pay-ui` entry from `overrides`.

## 0.2.0 — 2026-10-18

Additive. Requires `@devslab-kr/pay-contract` 0.3.0.

### Added

- `PaymentConnectionView`: one company's Toss test account (summary, connect/replace form, version history, revoke with confirmation). Takes a snapshot and actions; never fetches and never holds a stored key. Plain-Korean copy states it is a test account, live payments are not possible yet, the MID is the Toss 상점 ID and one order is at most 1,000,000원.
- `PaymentConnectionStatusPill`, `paymentConnectionProblem`, `isPaymentConnectionInput`, `maskedClientKeyHint` and the `dl-pay-connection*`, `dl-pay-confirm`, `dl-pay-rows`, `dl-pay-history-row*` styles.

### Changed

- `RechargeAmount` and `rechargeAmounts` apply Pay's per-order maximum (`RECHARGE_MAXIMUM_SUPPLY_KRW`, 1,000,000원 supply) through `calculateOrderRecharge` and show it in the help text. `maxSupplyKrw` can only lower it.

## 0.1.0 — 2026-10-17

First version. Replaces the copies of these screens in Admin and Contract.

### Added

- `RechargeAmount` and `RechargeBreakdown`, computing the preview with `calculateRecharge` from `@devslab-kr/pay-contract`.
- `OrderHistory` (taking a `Loadable<T>`, so loading, unavailable, failed and empty states keep the same frame), `OrderSummary` and `TestWalletSummary`.
- `PaymentStatePill` on DDS badges, `paymentStateLabel`, `SETTLING_PAYMENT_STATES`, `rechargeAmounts`, `formatKrw`, `formatKstDateTime`.
- `styles.css` with `dl-pay-*` classes on DDS tokens only.
