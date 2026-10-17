# Changelog

All notable changes to `@devslab-kr/pay-ui`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.1.0 — unreleased

First version. Replaces the copies of these screens in Admin and Contract.

### Added

- `RechargeAmount` and `RechargeBreakdown`, computing the preview with `calculateRecharge` from `@devslab-kr/pay-contract`.
- `OrderHistory` (taking a `Loadable<T>`, so loading, unavailable, failed and empty states keep the same frame), `OrderSummary` and `TestWalletSummary`.
- `PaymentStatePill` on DDS badges, `paymentStateLabel`, `SETTLING_PAYMENT_STATES`, `rechargeAmounts`, `formatKrw`, `formatKstDateTime`.
- `styles.css` with `dl-pay-*` classes on DDS tokens only.
