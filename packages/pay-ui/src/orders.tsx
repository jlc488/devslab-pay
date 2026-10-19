import { useId, type ReactNode } from "react";
import { Button } from "@devslab/dds-react";
import type { PublicOrder, TestWallet } from "@devslab-kr/pay-contract";
import { formatKrw, formatKstDateTime } from "./format.js";
import { PaymentStatePill, SETTLING_PAYMENT_STATES, paymentStateLabel } from "./status.js";
import { RechargeBreakdown } from "./recharge.js";
import { SkeletonText, StateNotice, type Loadable } from "./loadable.js";

/** The order fields the history table shows; apps pass their full order objects and get them back. */
export type OrderRow = Pick<PublicOrder, "id" | "orderId" | "state" | "supplyKrw" | "vatKrw" | "totalKrw" | "createdAt">;
export type OrderPageView<T extends OrderRow = OrderRow> = { items: readonly T[]; nextCursor: string | null };
export type OrderHistoryProps<T extends OrderRow> = {
  state: Loadable<OrderPageView<T>>;
  /** Opens one order; omit to hide the column. */
  onSelect?: (order: T) => void;
  /** Called with `nextCursor`; the app appends the older page to `items`. Omit to hide the button. */
  onLoadMore?: (cursor: string) => void;
  /** Locks "주문 보기" and the load-more button while any of the app's actions runs (for example `action.busy`). Shows no progress by itself. */
  busy?: boolean;
  /** The older page is loading: the load-more button shows progress (since 0.3.0). */
  loadingMore?: boolean;
  /** True for the order whose "주문 보기" is loading it, so only that row's button shows progress (since 0.3.0). */
  selecting?: (order: T) => boolean;
  /**
   * Why the older page did not load, beside the load-more button on a line that is always reserved (since 0.3.0).
   * The rows already shown stay. Plain text or inline content: the view supplies the alert role.
   */
  loadMoreError?: ReactNode;
  title?: ReactNode;
  /** Buttons beside the title (for example the app's refresh). */
  actions?: ReactNode;
  emptyText?: ReactNode;
};

/** Recharge orders, newest first, with state pills and the VAT split. */
export function OrderHistory<T extends OrderRow>({ state, onSelect, onLoadMore, busy = false, loadingMore = false, selecting, loadMoreError, title = "결제 내역", actions, emptyText = "아직 결제 내역이 없습니다." }: OrderHistoryProps<T>) {
  const id = useId();
  const page = state.status === "ready" ? state.data : null;
  // Busy only while the list itself changes; another action of the app (busy) does not make the rows stale.
  return (
    <section className="dl-pay-section" aria-labelledby={`${id}-title`} aria-busy={state.status === "loading" || loadingMore}>
      <div className="dl-pay-head">
        <h2 id={`${id}-title`} className="dl-pay-title">{title}</h2>
        {actions && <div className="dl-pay-actions">{actions}</div>}
      </div>
      {state.status === "unavailable" || state.status === "error" ? <StateNotice state={state} />
        : page && page.items.length === 0 ? <div className="dl-pay-notice"><p>{emptyText}</p></div>
          : (
            <div className="dds-table-wrap dl-pay-table-wrap">
              <table className="dds-table dl-pay-table">
                <caption className="dds-visually-hidden">결제 내역</caption>
                <thead>
                  <tr>
                    <th scope="col">주문 일시 (KST)</th>
                    <th scope="col">상태</th>
                    <th scope="col" data-numeric="">공급가액</th>
                    <th scope="col" data-numeric="">부가세</th>
                    <th scope="col" data-numeric="">결제 금액</th>
                    <th scope="col">주문 번호</th>
                    {onSelect && <th scope="col" className="dl-pay-select"><span className="dds-visually-hidden">상세</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {!page
                    ? [0, 1, 2].map((key) => (
                      <tr key={key} aria-hidden="true">
                        <td><SkeletonText size="long" /></td><td><SkeletonText size="short" /></td>
                        <td data-numeric=""><SkeletonText size="short" /></td><td data-numeric=""><SkeletonText size="short" /></td><td data-numeric=""><SkeletonText size="short" /></td>
                        <td><SkeletonText size="long" /></td>{onSelect && <td className="dl-pay-select" />}
                      </tr>
                    ))
                    : page.items.map((order) => (
                      <tr key={order.id}>
                        <td className="dl-pay-time"><time dateTime={order.createdAt}>{formatKstDateTime(order.createdAt)}</time></td>
                        <td><PaymentStatePill state={order.state} /></td>
                        <td data-numeric="">{formatKrw(order.supplyKrw)}</td>
                        <td data-numeric="">{formatKrw(order.vatKrw)}</td>
                        <td data-numeric="">{formatKrw(order.totalKrw)}</td>
                        <td><span className="dl-pay-id" title={order.orderId}>{order.orderId}</span></td>
                        {onSelect && <td className="dl-pay-select"><Button tone="secondary" size="sm" loading={selecting?.(order) ?? false} disabled={busy} onClick={() => onSelect(order)}>주문 보기</Button></td>}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
      {page?.nextCursor && onLoadMore && (
        <div className="dl-pay-actions">
          <Button tone="secondary" loading={loadingMore} disabled={busy} onClick={() => onLoadMore(page.nextCursor!)}>이전 결제 내역 더 보기</Button>
          <div className="dl-pay-result" role="alert">{loadMoreError}</div>
        </div>
      )}
    </section>
  );
}

export type OrderSummaryProps = {
  order: Pick<PublicOrder, "mode" | "orderId" | "state" | "supplyKrw" | "vatKrw" | "totalKrw">;
  title?: ReactNode;
  /** The app's buttons for this order (pay, re-check, refund). */
  children?: ReactNode;
};

/** One order: state, order number, the amount split, a do-not-pay-again note while settling, and actions. */
export function OrderSummary({ order, title, children }: OrderSummaryProps) {
  const id = useId();
  const settling = (SETTLING_PAYMENT_STATES as readonly string[]).includes(order.state);
  const heading = title ?? (order.mode === "test" ? "테스트 주문" : "주문");
  return (
    <section className="dl-pay-section dl-pay-order" aria-labelledby={`${id}-title`}>
      {/* The state is part of the heading; screen readers get one name, "테스트 주문 · 충전 완료". */}
      <h3 id={`${id}-title`} className="dl-pay-title dl-pay-order__head">
        <span aria-hidden="true">{heading}</span>
        <span aria-hidden="true"><PaymentStatePill state={order.state} /></span>
        <span className="dds-visually-hidden">{heading} · {paymentStateLabel(order.state)}</span>
      </h3>
      <dl className="dl-pay-facts">
        <div><dt>주문 번호</dt><dd><span className="dl-pay-mono">{order.orderId}</span></dd></div>
      </dl>
      <RechargeBreakdown amounts={order} />
      {settling && <p className="dl-pay-lead" role="status">처리 중인 주문입니다. 새로 결제하지 말고 같은 주문의 결과를 다시 확인해 주세요.</p>}
      {children && <div className="dl-pay-actions">{children}</div>}
    </section>
  );
}

/** The test wallet next to a test checkout: balance, amount held for refunds, refunded total. */
export function TestWalletSummary({ wallet, title = "테스트 잔액" }: { wallet: TestWallet; title?: ReactNode }) {
  const id = useId();
  return (
    <section className="dl-pay-section" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="dl-pay-title">{title}</h3>
      <dl className="dl-pay-tiles">
        <div className="dl-pay-tile"><dt>사용 가능</dt><dd>{formatKrw(wallet.availableKrw)}</dd></div>
        <div className="dl-pay-tile"><dt>환불 보류</dt><dd>{formatKrw(wallet.reservedKrw)}</dd></div>
        <div className="dl-pay-tile"><dt>환불 누계</dt><dd>{formatKrw(wallet.refundedKrw)}</dd></div>
      </dl>
    </section>
  );
}
