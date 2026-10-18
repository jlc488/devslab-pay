import type { ReactNode } from "react";
import { Field } from "@devslab/dds-react";
import { RECHARGE_MAXIMUM_SUPPLY_KRW, RECHARGE_MINIMUM_SUPPLY_KRW, RECHARGE_STEP_SUPPLY_KRW, VAT_RATE_PERCENT, calculateOrderRecharge, type RechargeAmounts } from "@devslab-kr/pay-contract";
import { formatKrw } from "./format.js";

/**
 * The amounts Pay would charge for the typed supply amount of a new order, or null when Pay would reject
 * it (including above Pay's per-order maximum since 0.2.0) or it exceeds the app's own ceiling. Uses the
 * contract's calculation, so the preview cannot disagree with Pay.
 */
export function rechargeAmounts(raw: string, maxSupplyKrw?: number): RechargeAmounts | null {
  if (!/^\d{1,16}$/.test(raw.trim())) return null;
  const supply = Number(raw.trim());
  if (maxSupplyKrw !== undefined && supply > maxSupplyKrw) return null;
  try { return calculateOrderRecharge(supply); } catch { return null; }
}

export type RechargeAmountProps = {
  /** The typed supply amount as text, so an in-progress edit is never rewritten. */
  value: string;
  onChange: (value: string) => void;
  label?: ReactNode;
  disabled?: boolean;
  /** An app-side ceiling below Pay's own per-order maximum (Contract caps a single recharge lower). */
  maxSupplyKrw?: number;
};

const rule = (max: number) => `${formatKrw(RECHARGE_MINIMUM_SUPPLY_KRW)} 이상 · ${formatKrw(RECHARGE_STEP_SUPPLY_KRW)} 단위 · 최대 ${formatKrw(max)}`;

/** Supply-amount input with the balance/VAT/total breakdown beside it (stacked when narrow). */
export function RechargeAmount({ value, onChange, label = "충전 공급가액 (원)", disabled = false, maxSupplyKrw: appMax }: RechargeAmountProps) {
  const maxSupplyKrw = Math.min(appMax ?? RECHARGE_MAXIMUM_SUPPLY_KRW, RECHARGE_MAXIMUM_SUPPLY_KRW);
  const amounts = rechargeAmounts(value, maxSupplyKrw);
  const overMax = /^\d+$/.test(value.trim()) && Number(value.trim()) > maxSupplyKrw;
  const error = !value.trim() || amounts ? undefined
    : overMax ? `한 번에 ${formatKrw(maxSupplyKrw)}까지 충전할 수 있습니다.`
      : `${formatKrw(RECHARGE_MINIMUM_SUPPLY_KRW)} 이상, ${formatKrw(RECHARGE_STEP_SUPPLY_KRW)} 단위로 입력하세요.`;
  return (
    <div className="dl-pay-recharge">
      <div className="dl-pay-recharge__grid">
        <Field label={label} className={error ? "dds-field--error" : undefined} helpText={error ?? rule(maxSupplyKrw)}>
          {(control) => (
            <input {...control} className="dds-input" aria-invalid={error ? true : undefined} type="number" inputMode="numeric" min={RECHARGE_MINIMUM_SUPPLY_KRW} step={RECHARGE_STEP_SUPPLY_KRW}
              max={maxSupplyKrw} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
          )}
        </Field>
        <RechargeBreakdown amounts={amounts} />
      </div>
    </div>
  );
}

/** Balance credited, VAT and the payable total. Without valid amounts the rows stay with a dash. */
export function RechargeBreakdown({ amounts }: { amounts: Pick<RechargeAmounts, "supplyKrw" | "vatKrw" | "totalKrw"> | null }) {
  const show = (value: number | undefined) => (value === undefined ? "—" : formatKrw(value));
  return (
    <dl className="dl-pay-breakdown" aria-label="결제 금액 구성">
      <div><dt>잔액에 반영</dt><dd>{show(amounts?.supplyKrw)}</dd></div>
      <div><dt>부가세 {VAT_RATE_PERCENT}%</dt><dd>{show(amounts?.vatKrw)}</dd></div>
      <div className="dl-pay-breakdown__total"><dt>총 결제 금액</dt><dd>{show(amounts?.totalKrw)}</dd></div>
    </dl>
  );
}
