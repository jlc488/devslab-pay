import { useId, type FormEvent, type ReactNode } from "react";
import { Button, Field } from "@devslab/dds-react";
import {
  RECHARGE_MAXIMUM_SUPPLY_KRW, isTossMerchantId, isTossTestClientKey, isTossTestSecretKey,
  type PaymentConnectionState, type PaymentConnectionStatus, type PaymentConnectionView as ConnectionVersion,
} from "@devslab-kr/pay-contract";
import { formatKrw, formatKstDateTime } from "./format.js";
import { SkeletonText } from "./loadable.js";
import { Pill, type Tone } from "./status.js";

/** A revoke the user asked for and has not confirmed yet (since 0.3.0; a question waiting for an answer, not running work). */
export type PaymentConnectionRevokeRequest = { kind: "revoke"; connectionId: string; version: number; status: "active" | "superseded" };
/** @deprecated Since 0.3.0. Renamed to {@link PaymentConnectionRevokeRequest} (plus `| null`), so it is not confused with DDS `PendingAction`, which is work in progress. */
export type PaymentConnectionPendingAction = PaymentConnectionRevokeRequest | null;
/**
 * The key of the app's running action, or null (since 0.3.0). Pass the app's `usePendingAction` keys
 * straight through, for example `act.current ?? load.current`. Anything but null locks every control of
 * the view. Only the three keys the view owns show progress, each on its own button: `"load"` on 다시 조회,
 * `"connect"` on the form's submit button and `"confirm"` on the confirm step's revoke button. Any other
 * key (an app-only action such as `"platform"` or `"reapply"`, or a reload nobody pressed such as
 * `"sync"`) locks the view without spinning any of its buttons.
 */
export type PaymentConnectionBusy = "load" | "connect" | "confirm" | (string & {}) | null;
/** Everything the connection screen shows. The app owns requests; the typed keys live here only until submit. */
export type PaymentConnectionSnapshot = {
  data: PaymentConnectionState | null;
  /** True while a load runs. Without `data` the view draws its frame with skeletons; with `data` it keeps showing the data. */
  loading: boolean;
  busy: PaymentConnectionBusy;
  merchantId: string;
  clientKey: string;
  secretKey: string;
  pending: PaymentConnectionRevokeRequest | null;
};
/**
 * What the user did. `load`, `connect` and `confirm` must handle their own failures (tell the user with
 * the app's feedback) and never reject: the view only starts them.
 */
export type PaymentConnectionActions = {
  canSubmit: boolean;
  load(): void | Promise<void>;
  setMerchantId(value: string): void;
  setClientKey(value: string): void;
  setSecretKey(value: string): void;
  connect(): void | Promise<void>;
  ask(pending: PaymentConnectionRevokeRequest): void;
  cancel(): void;
  confirm(): void | Promise<void>;
};
export type PaymentConnectionViewProps = {
  snapshot: PaymentConnectionSnapshot;
  /** False while the app cannot manage connections at all (for example Pay is not bound). */
  ready: boolean;
  actions: PaymentConnectionActions;
  notReadyText?: ReactNode;
  /** App rules shown above the form, for example the recent sign-in requirement. */
  formNote?: ReactNode;
  /** App facts shown under the summary, for example whether the app's own assignment follows the active version. */
  summaryExtra?: ReactNode;
  /**
   * Words for a failed load, shown once in the summary next to 다시 조회 while `data` is null (since 0.3.0).
   * Plain text or inline content: the view supplies the alert role. Defaults to a fixed sentence.
   */
  loadError?: ReactNode;
  /**
   * A result caused by what was typed, for example Toss refusing the keys (since 0.3.0). Shown beside the
   * submit button (under it once the form is one column wide) on a line that is always reserved, so nothing
   * moves when it comes or goes, nor when the data replaces the first-load skeleton. Plain text or
   * inline content: the view supplies the alert role. Other results (connected, revoked, server failures)
   * belong in the app's toast feedback.
   */
  formResult?: ReactNode;
};

/** Pay returns only the last 4 characters of a client key. */
export const maskedClientKeyHint = (hint: string) => `····${hint}`;
/** The first rule a typed value breaks, in plain words; "" when empty or valid. Same rules Pay enforces. */
export function paymentConnectionProblem(field: "merchantId" | "clientKey" | "secretKey", value: string): string {
  if (!value) return "";
  if (/\s/.test(value)) return "공백 없이 입력하세요.";
  if (field === "merchantId") return isTossMerchantId(value) ? "" : "영문·숫자·_·- 로 2~64자를 입력하세요.";
  if (field === "clientKey") return isTossTestClientKey(value) ? "" : "test_ck_ 로 시작하는 테스트 클라이언트 키를 입력하세요. 실제 결제용 키는 받지 않습니다.";
  return isTossTestSecretKey(value) ? "" : "test_sk_ 로 시작하는 테스트 시크릿 키를 입력하세요. 실제 결제용 키는 받지 않습니다.";
}
export const isPaymentConnectionInput = (merchantId: string, clientKey: string, secretKey: string) =>
  isTossMerchantId(merchantId) && isTossTestClientKey(clientKey) && isTossTestSecretKey(secretKey);

const statuses: Record<PaymentConnectionStatus, [string, Tone]> = {
  active: ["사용 중", "success"],
  superseded: ["교체됨", "neutral"],
  revoked: ["해제됨", "danger"],
};
export function PaymentConnectionStatusPill({ status }: { status: PaymentConnectionStatus | (string & {}) }) {
  const known = Object.hasOwn(statuses, status) ? statuses[status as PaymentConnectionStatus] : (["상태 확인 필요", "warning"] as const);
  return <Pill tone={known[1]} status={`connection.${status}`}>{known[0]}</Pill>;
}

function confirmCopy(pending: PaymentConnectionRevokeRequest) {
  if (pending.status === "active") return {
    title: "사용 중인 연결을 해제할까요?",
    body: "해제하면 새 키를 연결하기 전까지 새 테스트 결제를 시작할 수 없습니다. 이미 결제된 주문의 결과 확인과 결제 취소는 계속할 수 있습니다.",
    action: "연결 해제",
  };
  return {
    title: `버전 ${pending.version}을 해제할까요?`,
    body: "이 키로 열어 둔 결제창과 승인 확인이 더는 진행되지 않습니다. 이미 결제된 주문의 결과 확인과 결제 취소는 계속할 수 있습니다. 되돌릴 수 없습니다.",
    action: "이 버전 해제",
  };
}
function Confirm({ pending, busy, actions }: { pending: PaymentConnectionRevokeRequest; busy: PaymentConnectionBusy; actions: PaymentConnectionActions }) {
  const copy = confirmCopy(pending);
  const id = useId();
  // Any running action locks both buttons (a connect must not overlap a revoke); only the revoke itself spins.
  return (
    <div className="dl-pay-confirm" role="group" aria-labelledby={id}>
      <p id={id}><strong>{copy.title}</strong></p>
      <p>{copy.body}</p>
      <div className="dl-pay-actions">
        <Button tone="danger" loading={busy === "confirm"} disabled={busy !== null} onClick={() => void actions.confirm()}>{copy.action}</Button>
        <Button tone="secondary" disabled={busy !== null} onClick={actions.cancel}>취소</Button>
      </div>
    </div>
  );
}

const factLabels = ["결제사", "상점 ID (MID)", "사용 중인 키", "연결 일시"] as const;

/** The company's own Toss test account: summary, connect/replace form and version history. */
export function PaymentConnectionView({ snapshot, ready, actions, notReadyText = "결제 서비스 연결이 준비되면 Toss 테스트 계정을 연결할 수 있습니다.", formNote, summaryExtra, loadError, formResult }: PaymentConnectionViewProps) {
  const { data, loading, busy, merchantId, clientKey, secretKey, pending } = snapshot;
  const id = useId();
  const working = busy !== null;
  // No data yet while a load runs: the form and history are drawn at their real size, so nothing moves when data comes.
  const skeleton = ready && !data && loading;
  const frame = ready && (data !== null || loading);
  const locked = working || !data;
  const active = data?.active ?? null;
  const problems = {
    merchantId: paymentConnectionProblem("merchantId", merchantId),
    clientKey: paymentConnectionProblem("clientKey", clientKey),
    secretKey: paymentConnectionProblem("secretKey", secretKey),
  };
  function submit(event: FormEvent) { event.preventDefault(); if (actions.canSubmit && !locked) void actions.connect(); }

  let summary: ReactNode;
  if (!ready) summary = <div className="dl-pay-notice"><p>{notReadyText}</p></div>;
  else if (skeleton) summary = (
    <>
      <p className="dds-visually-hidden" role="status">결제 연결 정보를 불러오고 있습니다.</p>
      <dl className="dl-pay-facts dl-pay-facts--wide" aria-hidden="true">
        {factLabels.map((label) => <div key={label}><dt>{label}</dt><dd><SkeletonText size={label === "연결 일시" ? "medium" : "long"} /></dd></div>)}
      </dl>
      <div className="dl-pay-actions" aria-hidden="true"><span className="dds-skeleton dl-pay-skeleton-button" /></div>
    </>
  );
  else if (!data) summary = (
    <div className="dl-pay-notice dl-pay-notice--error" role="alert">
      <p>{loadError ?? "결제 연결 정보를 확인하지 못했습니다."}</p>
      <Button tone="secondary" size="sm" loading={busy === "load"} disabled={working} onClick={() => void actions.load()}>다시 조회</Button>
    </div>
  );
  else summary = (
    <>
      {active ? (
        <dl className="dl-pay-facts dl-pay-facts--wide">
          <div><dt>결제사</dt><dd>Toss Payments · 테스트</dd></div>
          <div><dt>상점 ID (MID)</dt><dd><span className="dl-pay-mono">{active.merchantId}</span></dd></div>
          <div><dt>사용 중인 키</dt><dd>클라이언트 키 <span className="dl-pay-mono">{maskedClientKeyHint(active.clientKeyHint)}</span> · 버전 {active.version}</dd></div>
          <div><dt>연결 일시</dt><dd><time dateTime={active.createdAt}>{formatKstDateTime(active.createdAt)} KST</time></dd></div>
        </dl>
      ) : (
        <div className="dl-pay-notice"><p>아직 사용 중인 Toss 테스트 계정이 없습니다. 아래에 상점 ID와 테스트 키를 입력하면 연결됩니다.</p></div>
      )}
      {summaryExtra}
      {active && (pending?.connectionId === active.id
        ? <Confirm pending={pending} busy={busy} actions={actions} />
        : <div className="dl-pay-actions"><Button tone="danger" disabled={working} onClick={() => actions.ask({ kind: "revoke", connectionId: active.id, version: active.version, status: "active" })}>연결 해제</Button></div>)}
    </>
  );

  return (
    <div className="dl-pay-connection" aria-busy={ready && loading}>
      <section className="dl-pay-section" aria-labelledby={`${id}-summary`}>
        <h2 id={`${id}-summary`} className="dl-pay-title">결제 연결</h2>
        <p className="dl-pay-lead">
          이 회사의 Toss Payments <strong>테스트</strong> 계정입니다. 테스트 결제만 할 수 있고, 실제 돈이 오가는 결제는 아직 할 수 없습니다.
          주문 1건은 공급가액 최대 {formatKrw(RECHARGE_MAXIMUM_SUPPLY_KRW)}까지입니다.
        </p>
        {summary}
      </section>
      {frame && (
        <section className="dl-pay-section" aria-labelledby={`${id}-form`}>
          <h2 id={`${id}-form`} className="dl-pay-title">
            {skeleton ? <><SkeletonText size="long" /><span className="dds-visually-hidden">Toss 테스트 키 입력</span></> : active ? "테스트 키 교체" : "Toss 테스트 계정 연결"}
          </h2>
          <p className="dl-pay-lead">
            Toss Payments 개발자센터의 API 키 화면에 있는 <strong>테스트</strong> 키를 입력하세요. 시크릿 키는 Toss에서 먼저 확인한 뒤 암호화해 보관하고,
            저장한 뒤에는 누구도 다시 볼 수 없습니다. 화면에는 클라이언트 키 마지막 4자리만 표시합니다. Toss 확인에는 몇 초 걸릴 수 있습니다.
          </p>
          {formNote}
          <form className="dl-pay-connection-form" onSubmit={submit} autoComplete="off">
            <Field label="상점 ID (MID)" className={problems.merchantId ? "dds-field--error" : undefined} helpText={problems.merchantId || "Toss가 발급한 상점 ID"}>
              {(control) => <input {...control} className="dds-input" aria-invalid={problems.merchantId ? true : undefined} type="text" name="toss-merchant-id" autoComplete="off" spellCheck={false} autoCapitalize="off" maxLength={64} value={merchantId} disabled={locked} onChange={(event) => actions.setMerchantId(event.target.value)} />}
            </Field>
            <Field label="클라이언트 키" className={problems.clientKey ? "dds-field--error" : undefined} helpText={problems.clientKey || "test_ck_ 로 시작하는 키"}>
              {(control) => <input {...control} className="dds-input" aria-invalid={problems.clientKey ? true : undefined} type="password" name="toss-client-key" autoComplete="off" spellCheck={false} autoCapitalize="off" maxLength={200} value={clientKey} disabled={locked} onChange={(event) => actions.setClientKey(event.target.value)} />}
            </Field>
            <Field label="시크릿 키" className={problems.secretKey ? "dds-field--error" : undefined} helpText={problems.secretKey || "test_sk_ 로 시작하는 키"}>
              {(control) => <input {...control} className="dds-input" aria-invalid={problems.secretKey ? true : undefined} type="password" name="toss-secret-key" autoComplete="off" spellCheck={false} autoCapitalize="off" maxLength={200} value={secretKey} disabled={locked} onChange={(event) => actions.setSecretKey(event.target.value)} />}
            </Field>
            <div className="dl-pay-connection-form__actions">
              {skeleton
                ? <span className="dds-skeleton dl-pay-skeleton-button" aria-hidden="true" />
                : <Button type="submit" loading={busy === "connect"} disabled={!actions.canSubmit || working}>{active ? "새 키로 교체" : "연결하고 확인"}</Button>}
              <div className="dl-pay-result" role="alert">{formResult}</div>
            </div>
          </form>
        </section>
      )}
      {frame && (
        <section className="dl-pay-section" aria-labelledby={`${id}-history`}>
          <h2 id={`${id}-history`} className="dl-pay-title">연결 이력</h2>
          {data?.history.some((item) => item.status === "superseded") && <p className="dl-pay-lead">교체된 예전 키가 밖으로 새었다면 ‘이 버전 해제’로 막으세요.</p>}
          {!data
            ? (
              <ul className="dl-pay-rows" aria-hidden="true">
                {[0, 1].map((key) => (
                  <li key={key} className="dl-pay-history-row">
                    <div className="dl-pay-history-row__line">
                      <SkeletonText size="short" /><SkeletonText size="short" /><SkeletonText size="long" /><SkeletonText size="short" /><SkeletonText size="medium" />
                      <span className="dl-pay-history-row__action" />
                    </div>
                  </li>
                ))}
              </ul>
            )
            : !data.history.length
              ? <div className="dl-pay-notice"><p>아직 연결한 Toss 테스트 키가 없습니다.</p></div>
              : <ul className="dl-pay-rows">{data.history.map((item) => <HistoryRow key={item.id} item={item} pending={pending} busy={busy} actions={actions} />)}</ul>}
        </section>
      )}
    </div>
  );
}

function HistoryRow({ item, pending, busy, actions }: { item: ConnectionVersion; pending: PaymentConnectionRevokeRequest | null; busy: PaymentConnectionBusy; actions: PaymentConnectionActions }) {
  const confirming = pending?.connectionId === item.id && item.status === "superseded";
  return (
    <li className="dl-pay-history-row">
      <div className="dl-pay-history-row__line">
        <strong>버전 {item.version}</strong>
        <PaymentConnectionStatusPill status={item.status} />
        <span className="dl-pay-mono dl-pay-clip" title={item.merchantId}>{item.merchantId}</span>
        <span className="dl-pay-mono">{maskedClientKeyHint(item.clientKeyHint)}</span>
        <time dateTime={item.createdAt}>{formatKstDateTime(item.createdAt)} KST</time>
        <span className="dl-pay-history-row__action">
          {item.status === "superseded" && !confirming && <Button tone="danger" size="sm" disabled={busy !== null} onClick={() => actions.ask({ kind: "revoke", connectionId: item.id, version: item.version, status: "superseded" })}>이 버전 해제</Button>}
        </span>
      </div>
      {confirming && <Confirm pending={pending} busy={busy} actions={actions} />}
    </li>
  );
}
