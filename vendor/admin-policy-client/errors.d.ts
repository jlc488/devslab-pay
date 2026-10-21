import type { PayErrorCode } from '@devslab-kr/pay-contract';
/**
 * Thrown by this package. `invalid_input` means Admin would reject the value with HTTP 400;
 * `invalid_response` means an Admin response (or RPC result) does not match this contract version.
 * `reason` narrows `invalid_input` for callers that show a field-specific message. Messages never
 * contain the checked values (phone numbers, text, tokens, profile data).
 */
export type AdminContractErrorReason = 'invalid_request' | 'text_too_long' | 'invalid_recipient' | 'duplicate_recipient';
export declare class AdminContractError extends Error {
    readonly code: 'invalid_input' | 'invalid_response';
    readonly reason: AdminContractErrorReason | null;
    constructor(code: 'invalid_input' | 'invalid_response', message: string, reason?: AdminContractErrorReason | null);
}
/**
 * Every `error.code` an Admin `/api/service/contract/*` endpoint can answer with, besides the codes Pay
 * returns through the payments facade (`PayErrorCode` of `@devslab-kr/pay-contract`), which Admin passes
 * through unchanged. Every error body is `{ error: { code, message } }`; messages are for people, codes
 * are the contract.
 */
export declare const ADMIN_FACADE_ERROR_CODES: readonly ['invalid_origin', 'json_required', 'too_large', 'invalid_input', 'invalid_filter', 'invalid_operation_id', 'invalid_role', 'not_found', 'method_not_allowed', 'invalid_token', 'oidc_unconfigured', 'rate_limited', 'temporarily_unavailable', 'approval_required', 'contact_verification_required', 'mfa_required', 'password_change_required', 'service_access_required', 'service_access_changed', 'decision_conflict', 'revision_conflict', 'company_profile_unavailable', 'notify_unconfigured', 'notify_unavailable', 'notify_rejected', 'notify_response_invalid', 'notify_not_linked', 'notify_mapping_conflict', 'notify_workspace_disabled', 'notify_messages_unsupported', 'reader_required', 'reader_unavailable', 'writer_unavailable', 'credential_set_unavailable', 'messaging_send_unavailable', 'binding_changed', 'quote_changed_or_expired', 'send_operation_conflict', 'price_changed', 'payment_unavailable', 'payment_authority_unavailable', 'payment_response_invalid', 'payment_order_conflict', 'invalid_state', 'legacy_order_requires_migration', 'payment_migration_pending', 'payment_migration_conflict', 'payment_operation_in_flight', 'payment_writer_changed', 'historical_snapshot_required'];
export type AdminFacadeErrorCode = typeof ADMIN_FACADE_ERROR_CODES[number];
/** Any code a facade endpoint can answer with, including Pay's codes passed through the payments facade. */
export type ContractFacadeErrorCode = AdminFacadeErrorCode | PayErrorCode;
export declare function isAdminFacadeErrorCode(value: unknown): value is AdminFacadeErrorCode;
/** The error body of every facade endpoint. Unknown snake_case codes are kept as strings. */
export interface AdminErrorEnvelope {
    error: {
        code: AdminFacadeErrorCode | (string & {});
        message: string;
    };
}
/** Reads `{ error: { code, message } }`; throws `invalid_response` for anything else. */
export declare function parseAdminErrorEnvelope(value: unknown): AdminErrorEnvelope;
