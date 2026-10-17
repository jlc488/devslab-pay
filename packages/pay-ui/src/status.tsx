import type { ReactNode } from "react";
import type { PaymentState } from "@devslab-kr/pay-contract";

export type Tone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

/** DDS badge markup (dot + label, so colour is never the only signal). */
export function Pill({ tone, status, children }: { tone: Tone; status: string; children: ReactNode }) {
  return <span className={tone === "neutral" ? "dds-badge" : `dds-badge dds-badge--${tone}`} data-tone={tone} data-status={status}>{children}</span>;
}

const states: Record<PaymentState, [string, Tone]> = {
  created: ["결제 준비", "neutral"],
  confirming: ["결제 확인 중", "info"],
  provider_unknown: ["결제 결과 확인 필요", "warning"],
  credit_pending: ["충전 반영 중", "info"],
  credited: ["충전 완료", "success"],
  refund_pending: ["환불 처리 중", "info"],
  refund_unknown: ["환불 결과 확인 필요", "warning"],
  refunded: ["환불 완료", "neutral"],
};
/** States where the order is still settling: the payer must not pay again but re-check the same order. */
export const SETTLING_PAYMENT_STATES: readonly PaymentState[] = ["confirming", "provider_unknown", "credit_pending", "refund_pending", "refund_unknown"];

/** Label of an order state; a state a later Pay version adds reads "상태 확인 필요". */
export function paymentStateLabel(state: string): string {
  return Object.hasOwn(states, state) ? states[state as PaymentState][0] : "상태 확인 필요";
}
export function PaymentStatePill({ state }: { state: PaymentState | (string & {}) }) {
  const known = Object.hasOwn(states, state) ? states[state as PaymentState] : (["상태 확인 필요", "warning"] as const);
  return <Pill tone={known[1]} status={`payment.${state}`}>{known[0]}</Pill>;
}
