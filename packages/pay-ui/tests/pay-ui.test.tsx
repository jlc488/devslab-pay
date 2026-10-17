import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PublicOrder } from "@devslab-kr/pay-contract";
import { OrderHistory, OrderSummary, RechargeAmount, TestWalletSummary, rechargeAmounts, type Loadable, type OrderPageView } from "../src/index.js";

const order = (id: string, state: PublicOrder["state"], supplyKrw = 1000): PublicOrder => ({
  mode: "test", purpose: "messaging_recharge", id, companyId: "company-a", orderId: `order-${id}`, operationId: `op-${id}`,
  supplyKrw, vatKrw: supplyKrw / 10, totalKrw: supplyKrw * 1.1, currency: "KRW", state,
  createdAt: "2026-10-17T01:02:03.000Z", updatedAt: "2026-10-17T01:02:03.000Z",
});
const ready = (items: PublicOrder[], nextCursor: string | null = null): Loadable<OrderPageView<PublicOrder>> => ({ status: "ready", data: { items, nextCursor } });

function Controlled({ initial = "1000", maxSupplyKrw }: { initial?: string; maxSupplyKrw?: number }) {
  const [value, setValue] = useState(initial);
  return <RechargeAmount value={value} onChange={setValue} {...(maxSupplyKrw === undefined ? {} : { maxSupplyKrw })} />;
}

describe("RechargeAmount", () => {
  it("computes the amounts the way Pay charges them", () => {
    expect(rechargeAmounts("3000")).toMatchObject({ supplyKrw: 3000, vatKrw: 300, totalKrw: 3300 });
    for (const raw of ["", "0", "999", "1500", "-1000", "1000.5", "1e3", "Infinity"]) expect(rechargeAmounts(raw)).toBeNull();
    expect(rechargeAmounts("200000000", 100_000_000)).toBeNull();
  });
  it("updates the breakdown as the user types and explains an invalid amount", async () => {
    render(<Controlled />);
    const list = screen.getByLabelText("결제 금액 구성");
    expect(list.textContent).toContain("1,100원");
    const input = screen.getByLabelText("충전 공급가액 (원)");
    await userEvent.clear(input); await userEvent.type(input, "25000");
    expect(list.textContent).toContain("25,000원"); expect(list.textContent).toContain("2,500원"); expect(list.textContent).toContain("27,500원");
    await userEvent.clear(input); await userEvent.type(input, "1500");
    expect(screen.getByText("1,000원 이상, 1,000원 단위로 입력하세요.")).toBeTruthy();
    expect(list.textContent).not.toContain("원");
  });
  it("applies the app's ceiling", () => {
    render(<Controlled initial="200000000" maxSupplyKrw={100_000_000} />);
    expect(screen.getByText("한 번에 100,000,000원까지 충전할 수 있습니다.")).toBeTruthy();
  });
});

describe("OrderHistory", () => {
  const items = [order("a", "credited", 3000), order("b", "provider_unknown")];
  it("lists orders with states and the VAT split, and opens one order", async () => {
    const onSelect = vi.fn();
    render(<OrderHistory state={ready(items)} onSelect={onSelect} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[1]!.textContent)).toEqual(["충전 완료", "결제 결과 확인 필요"]);
    expect(rows[0]!.textContent).toContain("300원"); expect(rows[0]!.textContent).toContain("3,300원");
    await userEvent.click(within(rows[1]!).getByRole("button", { name: "주문 보기" }));
    expect(onSelect).toHaveBeenCalledWith(items[1]);
  });
  it("asks for older orders with the cursor and hides actions the app does not offer", async () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(<OrderHistory state={ready(items, "next-1")} onLoadMore={onLoadMore} />);
    expect(screen.queryByRole("button", { name: "주문 보기" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "이전 결제 내역 더 보기" }));
    expect(onLoadMore).toHaveBeenCalledWith("next-1");
    rerender(<OrderHistory state={ready(items, "next-1")} onLoadMore={onLoadMore} busy />);
    expect((screen.getByRole("button", { name: "이전 결제 내역 더 보기" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("keeps the frame for loading, empty, unavailable and failed states", async () => {
    const { rerender } = render(<OrderHistory state={{ status: "loading" }} />);
    expect(screen.getByRole("table")).toBeTruthy(); expect(screen.queryByText(/원$/)).toBeNull();
    rerender(<OrderHistory state={ready([])} emptyText="아직 이 회사의 테스트 결제 내역이 없습니다." />);
    expect(screen.getByText("아직 이 회사의 테스트 결제 내역이 없습니다.")).toBeTruthy();
    rerender(<OrderHistory state={{ status: "unavailable", message: "결제 연결이 준비되면 조회할 수 있습니다." }} />);
    expect(screen.queryByRole("table")).toBeNull();
    const onRetry = vi.fn();
    rerender(<OrderHistory state={{ status: "error", message: "결제 내역을 확인하지 못했습니다.", onRetry }} />);
    await userEvent.click(screen.getByRole("button", { name: "다시 조회" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("OrderSummary and TestWalletSummary", () => {
  it("warns against paying again while an order settles and renders the app's actions", async () => {
    const pay = vi.fn();
    const { rerender } = render(<OrderSummary order={order("a", "created")}><button onClick={pay}>테스트 결제 진행</button></OrderSummary>);
    expect(screen.getByRole("heading", { name: "테스트 주문 · 결제 준비" })).toBeTruthy();
    expect(screen.getByText("order-a")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "테스트 결제 진행" }));
    expect(pay).toHaveBeenCalledOnce();
    rerender(<OrderSummary order={order("a", "refund_unknown")} />);
    expect(screen.getByRole("status").textContent).toContain("새로 결제하지 말고");
    expect(screen.getByText("환불 결과 확인 필요")).toBeTruthy();
  });
  it("shows the three test wallet amounts", () => {
    render(<TestWalletSummary wallet={{ mode: "test", availableKrw: 5000, reservedKrw: 1000, refundedKrw: 2000 }} />);
    for (const text of ["5,000원", "1,000원", "2,000원"]) expect(screen.getByText(text)).toBeTruthy();
  });
});
