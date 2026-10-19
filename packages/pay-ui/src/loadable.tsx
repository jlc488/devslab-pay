import type { ReactNode } from "react";
import { Button } from "@devslab/dds-react";

/**
 * What a data component is showing. The app decides the words for `unavailable` (not set up, no
 * permission) and `error` (the request failed); the component keeps the same frame in every state.
 */
export type Loadable<T> =
  | { status: "loading" }
  | { status: "unavailable"; message: ReactNode }
  /**
   * `retrying` (since 0.3.0): the retry the user pressed is running, so 다시 조회 shows progress and cannot be pressed again.
   * `retryDisabled` (since 0.3.1): another action of the app runs, so 다시 조회 is locked without showing progress, for
   * example `list.busy && !list.is("retry")`. Without it the button looked pressable while the app ignored the press.
   */
  | { status: "error"; message: ReactNode; onRetry?: () => void; retrying?: boolean; retryDisabled?: boolean }
  | { status: "ready"; data: T };

/**
 * Notice for the `unavailable` and `error` states. 다시 조회 keeps its working width while idle (`dl-pay-spinner-room`),
 * so the notice wraps the same way, and keeps its height, whether the retry runs or not.
 */
export function StateNotice({ state }: { state: Extract<Loadable<unknown>, { status: "unavailable" | "error" }> }) {
  if (state.status === "unavailable") return <div className="dl-pay-notice"><p>{state.message}</p></div>;
  return (
    <div className="dl-pay-notice dl-pay-notice--error" role="alert">
      <p>{state.message}</p>
      {state.onRetry && (
        <Button tone="secondary" size="sm" className="dl-pay-spinner-room" loading={state.retrying === true}
          disabled={state.retrying === true || state.retryDisabled === true} onClick={state.onRetry}>다시 조회</Button>
      )}
    </div>
  );
}

/** A skeleton bar sized by the surrounding text (no inline style, so strict CSP pages render it); hidden from assistive technology. */
export function SkeletonText({ size = "medium" }: { size?: "short" | "medium" | "long" }) {
  return <span className={`dds-skeleton dds-skeleton--text dl-pay-skeleton dl-pay-skeleton--${size}`} aria-hidden="true" />;
}
