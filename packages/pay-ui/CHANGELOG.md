# Changelog

All notable changes to `@devslab-kr/pay-ui`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.3.1 — 2026-10-20

Nothing moves while an action runs, and the order history's first-load skeleton has the loaded table's columns and row height. Measured with Admin's and Contract's own stylesheets at 1280 and 390px (and with a touch pointer): every column edge, row height, box height and button edge is the same before and during progress. Additive: `Loadable` error `retryDisabled` and the class `dl-pay-spinner-room`; the apps need no change to get the fixes.

### Fixed

- `OrderHistory`: while one row's "주문 보기" spun, the other columns moved 2–10px. The 0.3.0 room for the spinner (`7.5rem` on the column) was in root units and narrower than the spinning button (98px) plus the cell padding. "주문 보기" now keeps the spinner's room while idle, so every row's button is the same width spinning or not and their right edges line up, and the columns have fixed widths (see Changed).
- `OrderHistory` first load: the skeleton put column edges up to 62px from where the loaded rows put them, and its rows were 42px against the loaded 43px (53px against 53px is now also true with a touch pointer), so the table jumped when the data came. Skeleton rows now hold a pill and a "주문 보기" built from the real controls' classes and painted as skeletons, in the same fixed columns. In a contrast theme (forced colors), which would repaint their transparent label and border, these stand-ins keep their room and draw nothing, like the DDS skeleton bars, instead of an inert "주문 보기" in every row. The "이전 결제 내역 더 보기" line still appears only once the data says there is an older page.
- 다시 조회 (`Loadable` error and `PaymentConnectionView`'s failed load), "이전 결제 내역 더 보기", the connect/replace submit button and the confirm step's revoke button grew 24px (16px spinner + 8px gap) when they spun. The notice rewrapped and grew (Admin at 390px: 58→90px, 66→110px with a two-line message), the result line beside the buttons moved 24px and 취소 shifted right 24px. They now keep the spinner's room while idle.
- A `Loadable` error's 다시 조회 stayed pressable while another action of the app ran, and the press was ignored (`usePendingAction.run` does not start a second action): a silent no-op. Apps can now lock it with `retryDisabled`.

### Changed

- `OrderHistory` columns have fixed widths that follow the text each column holds: the cells' `.875rem` (DDS table) for dates and amounts, the 13px label for state pills and "주문 보기", never root units alone. The order number takes the remaining width and ends with an ellipsis (the full number is its title) instead of stopping at `14rem`. Below the sum of the columns (about 955px with "주문 보기", at default font settings) the table scrolls inside its frame, as before. New classes on the `<col>` elements: `dl-pay-col-time`, `dl-pay-col-state`, `dl-pay-col-amount`, `dl-pay-col-select`; the table carries `dl-pay-table--select` when `onSelect` is given.
- The package's buttons that can spin are 24px wider while idle (the spinner's room). The submit button's first-load stand-in is 24px wider to match.

### Added

- `Loadable` error state `retryDisabled`: 다시 조회 is disabled, without progress, while another action of the app runs. Wire it as `retryDisabled: list.busy && !list.is("retry")`.
- Class `dl-pay-spinner-room` for a DDS `Button` that shows progress: it keeps the spinner's room while idle. Every button of the package that can spin uses it; apps can give it to their own buttons in this package's slots (`OrderHistory` `actions`, `OrderSummary` children, `PaymentConnectionView` `formNote` and `summaryExtra`).
- Classes `dl-pay-ghost` (a skeleton stand-in built from a real control's classes) and `dl-pay-ghost--pill`.

### Migration

- Optional for both apps. Where an `OrderHistory` error state shares its `usePendingAction` with other actions, pass `retryDisabled` (Admin payments: `history.busy && !history.is('retry')`; Contract checkout: `action.busy && !action.is('retry')`, and drop the comment that says 0.3.0 cannot lock the button).
- Own buttons that spin in the package's slots: add `className="dl-pay-spinner-room"` so they keep their width too. Admin: 내역 새로고침 (`OrderHistory` `actions`), "DevsLab 테스트 계정으로 연결" (`PaymentConnectionView` `formNote`) and "현재 연결 적용" (`summaryExtra`). Contract: 테스트 결제 진행 and 주문 결과 다시 확인 (`OrderSummary` children).
- Nothing else: no prop or class the apps use was removed. The `dl-pay-select` cells stay; only their `7.5rem` width is gone.

## 0.3.0 — 2026-10-20

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
