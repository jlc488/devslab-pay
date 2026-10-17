/** Every `error.code` Pay returns in a failed PayResponse. Pay's own error type only accepts these. */
export const PAY_ERROR_CODES = [
 'invalid_input',
 'not_found',
 'immutable_conflict',
 'payment_unavailable',
 'service_access_required',
 'effect_authority_required',
 'effect_authority_unavailable',
 'effect_authority_denied',
] as const;
export type PayErrorCode = typeof PAY_ERROR_CODES[number];
export function isPayErrorCode(value:unknown):value is PayErrorCode{
 return typeof value==='string'&&(PAY_ERROR_CODES as readonly string[]).includes(value);
}
/**
 * Thrown by this package. `invalid_input` means Pay would reject the value with HTTP 400 and the
 * same code; `invalid_response` means a Pay response does not match this contract version.
 * Messages never contain the checked values.
 */
export class PayContractError extends Error {
 constructor(readonly code:'invalid_input'|'invalid_response',message:string){super(message);this.name='PayContractError';}
}
