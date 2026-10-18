# Changelog

All notable changes to `@devslab-kr/pay-ui`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.2.0 — unreleased

Additive. Requires `@devslab-kr/pay-contract` 0.3.0.

### Added

- `PaymentConnectionView`: one company's Toss test account (summary, connect/replace form, version history, revoke with confirmation). Takes a snapshot and actions; never fetches and never holds a stored key. Plain-Korean copy states it is a test account, live payments are not possible yet, the MID is the Toss 상점 ID and one order is at most 1,000,000원.
- `PaymentConnectionStatusPill`, `paymentConnectionProblem`, `isPaymentConnectionInput`, `maskedClientKeyHint` and the `dl-pay-connection*`, `dl-pay-confirm`, `dl-pay-rows`, `dl-pay-history-row*` styles.

### Changed

- `RechargeAmount` and `rechargeAmounts` apply Pay's per-order maximum (`RECHARGE_MAXIMUM_SUPPLY_KRW`, 1,000,000원 supply) through `calculateOrderRecharge` and show it in the help text. `maxSupplyKrw` can only lower it.

## 0.1.0 — unreleased

First version. Replaces the copies of these screens in Admin and Contract.

### Added

- `RechargeAmount` and `RechargeBreakdown`, computing the preview with `calculateRecharge` from `@devslab-kr/pay-contract`.
- `OrderHistory` (taking a `Loadable<T>`, so loading, unavailable, failed and empty states keep the same frame), `OrderSummary` and `TestWalletSummary`.
- `PaymentStatePill` on DDS badges, `paymentStateLabel`, `SETTLING_PAYMENT_STATES`, `rechargeAmounts`, `formatKrw`, `formatKstDateTime`.
- `styles.css` with `dl-pay-*` classes on DDS tokens only.
