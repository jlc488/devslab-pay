import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PublicOrder } from "@devslab-kr/pay-contract";
import { OrderHistory, OrderSummary, PaymentConnectionView, RechargeAmount, TestWalletSummary, rechargeAmounts, type Loadable, type OrderPageView, type PaymentConnectionActions, type PaymentConnectionSnapshot } from "../src/index.js";

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
  it("shows Pay's per-order maximum and refuses more, below which an app may set a lower ceiling", () => {
    expect(rechargeAmounts("1000000")).toMatchObject({ supplyKrw: 1_000_000, totalKrw: 1_100_000 });
    expect(rechargeAmounts("1001000")).toBeNull();
    const { unmount } = render(<Controlled initial="1001000" />);
    expect(screen.getByText("한 번에 1,000,000원까지 충전할 수 있습니다.")).toBeTruthy();
    unmount();
    render(<Controlled initial="1000" />);
    expect(screen.getByText("1,000원 이상 · 1,000원 단위 · 최대 1,000,000원")).toBeTruthy();
    cleanup();
    render(<Controlled initial="60000" maxSupplyKrw={50_000} />);
    expect(screen.getByText("한 번에 50,000원까지 충전할 수 있습니다.")).toBeTruthy();
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
  it("shows progress only on the button whose request runs, while the app's busy locks the rest", () => {
    const props = { state: ready(items, "next-1"), onSelect: vi.fn(), onLoadMore: vi.fn(), busy: true };
    const { rerender } = render(<OrderHistory {...props} loadingMore />);
    const history = screen.getByRole("region", { name: "결제 내역" });
    const more = screen.getByRole("button", { name: "이전 결제 내역 더 보기" }) as HTMLButtonElement;
    const [first, second] = screen.getAllByRole("button", { name: "주문 보기" }) as HTMLButtonElement[];
    expect(more.getAttribute("aria-busy")).toBe("true");
    for (const button of [first!, second!]) { expect(button.disabled).toBe(true); expect(button.getAttribute("aria-busy")).toBeNull(); }
    expect(history.getAttribute("aria-busy")).toBe("true");
    rerender(<OrderHistory {...props} selecting={(row) => row.id === "b"} />);
    expect(second!.getAttribute("aria-busy")).toBe("true");
    expect(first!.getAttribute("aria-busy")).toBeNull(); expect(first!.disabled).toBe(true);
    expect(more.getAttribute("aria-busy")).toBeNull(); expect(more.disabled).toBe(true);
    // Opening one order does not make the list itself stale.
    expect(history.getAttribute("aria-busy")).toBe("false");
  });
  it("keeps the orders and says why older ones did not load, next to the button", () => {
    const { rerender } = render(<OrderHistory state={ready(items, "next-1")} onLoadMore={vi.fn()} />);
    const more = screen.getByRole("button", { name: "이전 결제 내역 더 보기" });
    const line = within(more.parentElement!).getByRole("alert");
    expect(line.textContent).toBe("");
    rerender(<OrderHistory state={ready(items, "next-1")} onLoadMore={vi.fn()} loadMoreError="이전 결제 내역을 불러오지 못했습니다." />);
    expect(within(more.parentElement!).getByRole("alert")).toBe(line);
    expect(line.textContent).toBe("이전 결제 내역을 불러오지 못했습니다.");
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(2);
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
    rerender(<OrderHistory state={{ status: "error", message: "결제 내역을 확인하지 못했습니다.", onRetry, retrying: true }} />);
    const retry = screen.getByRole("button", { name: "다시 조회" }) as HTMLButtonElement;
    expect(retry.getAttribute("aria-busy")).toBe("true"); expect(retry.disabled).toBe(true);
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

describe("PaymentConnectionView", () => {
  const active = { id: "pcv_" + "a".repeat(32), provider: "toss", environment: "test", version: 2, status: "active", merchantId: "tvivarepublica", clientKeyHint: "0001", fingerprint: "b".repeat(64), createdAt: "2026-10-18T01:02:03.000Z", revokedAt: null } as const;
  const old = { ...active, id: "pcv_" + "c".repeat(32), version: 1, status: "superseded" } as const;
  const base: PaymentConnectionSnapshot = { data: { companyId: "company-a", active, history: [active, old] }, loading: false, busy: null, merchantId: "", clientKey: "", secretKey: "", pending: null };
  const typed = { merchantId: "tvivarepublica", clientKey: "test_ck_FAKEclient0001", secretKey: "test_sk_FAKEsecret0001" };
  const fields = ["상점 ID (MID)", "클라이언트 키", "시크릿 키"];
  function actions(patch: Partial<PaymentConnectionActions> = {}): PaymentConnectionActions {
    return { canSubmit: false, load: vi.fn(), setMerchantId: vi.fn(), setClientKey: vi.fn(), setSecretKey: vi.fn(), connect: vi.fn(), ask: vi.fn(), cancel: vi.fn(), confirm: vi.fn(), ...patch };
  }
  it("says it is a test account, names the MID and the order maximum, and shows only the client-key hint", () => {
    render(<PaymentConnectionView snapshot={base} ready actions={actions()} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("테스트");expect(text).toContain("실제 돈이 오가는 결제는 아직 할 수 없습니다");expect(text).toContain("1,000,000원");
    expect(screen.getByText("상점 ID (MID)", { selector: "dt" })).toBeTruthy();
    expect(screen.getByLabelText("상점 ID (MID)")).toBeTruthy();
    expect(text).toContain("····0001");expect(text).not.toContain("b".repeat(64));
    expect((screen.getByLabelText("시크릿 키") as HTMLInputElement).type).toBe("password");
  });
  it("explains a wrong key in words and submits only a valid form", async () => {
    const connect = vi.fn();
    const { rerender } = render(<PaymentConnectionView snapshot={{ ...base, secretKey: "live_sk_FAKE0001" }} ready actions={actions({ connect })} />);
    expect(screen.getByText(/test_sk_ 로 시작하는 테스트 시크릿 키/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "새 키로 교체" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<PaymentConnectionView snapshot={{ ...base, merchantId: "tvivarepublica", clientKey: "test_ck_FAKEclient0001", secretKey: "test_sk_FAKEsecret0001" }} ready actions={actions({ connect, canSubmit: true })} />);
    await userEvent.click(screen.getByRole("button", { name: "새 키로 교체" }));
    expect(connect).toHaveBeenCalledTimes(1);
  });
  it("asks before revoking the active or an older version", async () => {
    const ask = vi.fn();
    render(<PaymentConnectionView snapshot={base} ready actions={actions({ ask })} />);
    await userEvent.click(screen.getByRole("button", { name: "연결 해제" }));
    expect(ask).toHaveBeenLastCalledWith({ kind: "revoke", connectionId: active.id, version: 2, status: "active" });
    await userEvent.click(screen.getByRole("button", { name: "이 버전 해제" }));
    expect(ask).toHaveBeenLastCalledWith({ kind: "revoke", connectionId: old.id, version: 1, status: "superseded" });
    cleanup();
    const confirm = vi.fn();
    render(<PaymentConnectionView snapshot={{ ...base, pending: { kind: "revoke", connectionId: old.id, version: 1, status: "superseded" } }} ready actions={actions({ confirm })} />);
    expect(screen.getByText("버전 1을 해제할까요?")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "이 버전 해제" }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it("shows progress only on the button whose action runs and locks every other control meanwhile", () => {
    const revokingOld = { kind: "revoke", connectionId: old.id, version: 1, status: "superseded" } as const;
    const view = () => screen.getByRole("region", { name: "결제 연결" }).parentElement!;
    // Two screens put every button of the view on screen, with the form filled in: one with the confirm step open
    // (its revoke and 취소), one without it (the ask buttons 연결 해제 and the older version's 이 버전 해제).
    const screens = [
      { pending: revokingOld, names: ["새 키로 교체", "연결 해제", "이 버전 해제", "취소"], confirmSpins: "이 버전 해제" },
      { pending: null, names: ["새 키로 교체", "연결 해제", "이 버전 해제"], confirmSpins: null },
    ];
    for (const { pending, names, confirmSpins } of screens) {
      const screenWith = (busy: PaymentConnectionSnapshot["busy"]) =>
        <PaymentConnectionView snapshot={{ ...base, ...typed, pending, busy }} ready actions={actions({ canSubmit: true })} />;
      const { rerender, unmount } = render(screenWith(null));
      for (const button of screen.getAllByRole("button") as HTMLButtonElement[]) { expect(button.disabled).toBe(false); expect(button.getAttribute("aria-busy")).toBeNull(); }
      // App-only keys ("platform", "reapply") and reloads nobody pressed ("sync", or "load" while data is shown)
      // lock the view without spinning its buttons.
      const keys: [PaymentConnectionSnapshot["busy"], string | null][] = [["connect", "새 키로 교체"], ["confirm", confirmSpins], ["load", null], ["platform", null], ["reapply", null], ["sync", null]];
      for (const [busy, spinning] of keys) {
        rerender(screenWith(busy));
        const buttons = screen.getAllByRole("button") as HTMLButtonElement[];
        expect(buttons.map((button) => button.textContent).sort()).toEqual([...names].sort());
        for (const button of buttons) {
          expect(button.disabled, `${busy}: ${button.textContent}`).toBe(true);
          expect(button.getAttribute("aria-busy") === "true", `${busy}: ${button.textContent}`).toBe(button.textContent === spinning);
        }
        for (const label of fields) expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(true);
        // An action is not the data loading: the view as a whole is not announced as busy.
        expect(view().getAttribute("aria-busy"), `${busy}: view`).not.toBe("true");
      }
      unmount();
    }
  });
  it("shows a refused key beside the submit button, on a line that is there before the result comes", () => {
    const { rerender } = render(<PaymentConnectionView snapshot={{ ...base, ...typed }} ready actions={actions({ canSubmit: true })} />);
    const form = screen.getByRole("button", { name: "새 키로 교체" }).closest("form")!;
    const line = within(form).getByRole("alert");
    expect(line.textContent).toBe("");
    rerender(<PaymentConnectionView snapshot={{ ...base, ...typed }} ready actions={actions({ canSubmit: true })} formResult="Toss가 이 키를 받지 않았습니다. 키를 다시 확인해 주세요." />);
    expect(within(form).getByRole("alert")).toBe(line);
    expect(line.textContent).toBe("Toss가 이 키를 받지 않았습니다. 키를 다시 확인해 주세요.");
  });
  it("draws the form and history while the first load runs and fills them in place", () => {
    const { rerender } = render(<PaymentConnectionView snapshot={{ ...base, data: null, loading: true }} ready actions={actions({ canSubmit: true })} />);
    const view = screen.getByRole("region", { name: "결제 연결" }).parentElement!;
    expect(view.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("불러오고");
    const inputs = fields.map((label) => screen.getByLabelText(label) as HTMLInputElement);
    for (const input of inputs) expect(input.disabled).toBe(true);
    for (const button of screen.queryAllByRole("button") as HTMLButtonElement[]) expect(button.disabled).toBe(true);
    expect(screen.getByRole("heading", { name: "연결 이력" })).toBeTruthy();
    rerender(<PaymentConnectionView snapshot={base} ready actions={actions({ canSubmit: true })} />);
    // The same fields, now usable: the form did not pop in under the summary when the data came.
    fields.forEach((label, index) => expect(screen.getByLabelText(label)).toBe(inputs[index]));
    for (const input of inputs) expect(input.disabled).toBe(false);
    expect(screen.queryByRole("status")).toBeNull();
    expect(view.getAttribute("aria-busy")).not.toBe("true");
  });
  it("says once why the load failed, next to 다시 조회, and spins it only for the retry", async () => {
    const load = vi.fn();
    const failed = { ...base, data: null };
    const { rerender } = render(<PaymentConnectionView snapshot={failed} ready actions={actions({ load })} loadError="결제 서비스에 연결하지 못했습니다." />);
    expect(screen.getAllByText("결제 서비스에 연결하지 못했습니다.")).toHaveLength(1);
    const notice = screen.getByRole("alert");
    expect(notice.textContent).toContain("결제 서비스에 연결하지 못했습니다.");
    await userEvent.click(within(notice).getByRole("button", { name: "다시 조회" })); expect(load).toHaveBeenCalledOnce();
    rerender(<PaymentConnectionView snapshot={{ ...failed, busy: "load" }} ready actions={actions({ load })} loadError="결제 서비스에 연결하지 못했습니다." />);
    const retry = screen.getByRole("button", { name: "다시 조회" }) as HTMLButtonElement;
    expect(retry.getAttribute("aria-busy")).toBe("true"); expect(retry.disabled).toBe(true);
    rerender(<PaymentConnectionView snapshot={{ ...failed, busy: "sync" }} ready actions={actions({ load })} />);
    expect(retry.getAttribute("aria-busy")).toBeNull(); expect(retry.disabled).toBe(true);
    expect(notice.textContent).toContain("결제 연결 정보를 확인하지 못했습니다.");
  });
  it("keeps the frame for not ready and empty states", () => {
    const { rerender } = render(<PaymentConnectionView snapshot={base} ready={false} actions={actions()} notReadyText="준비 중" />);
    expect(screen.getByText("준비 중")).toBeTruthy();expect(screen.queryByLabelText("시크릿 키")).toBeNull();
    rerender(<PaymentConnectionView snapshot={{ ...base, data: { companyId: "company-a", active: null, history: [] } }} ready actions={actions()} />);
    expect(screen.getByText(/아직 사용 중인 Toss 테스트 계정이 없습니다/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "연결하고 확인" })).toBeTruthy();
  });
});
