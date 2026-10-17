import {PayContractError} from './errors.js';

export const PAYMENT_STATES = ['created','confirming','provider_unknown','credit_pending','credited','refund_pending','refund_unknown','refunded'] as const;

/* ---- Pricing ---- */
export const RECHARGE_MINIMUM_SUPPLY_KRW = 1000;
export const RECHARGE_STEP_SUPPLY_KRW = 1000;
/** Since 0.2.0: the largest supply amount of one new order (`calculateOrderRecharge`). Existing orders above it stay readable. */
export const RECHARGE_MAXIMUM_SUPPLY_KRW = 1000000;
/** VAT is added on top of the supply amount; the wallet is credited with the supply amount only. */
export const VAT_RATE_PERCENT = 10;
export const MESSAGE_UNIT_PRICE_KRW = 100;
/** The `pricing` block of every PaymentCapabilities response. */
export const PAYMENT_PRICING = {minimumSupplyKrw:1000,stepSupplyKrw:1000,vatRatePercent:10,vatIncluded:false,unitPriceKrw:100} as const;

/* ---- Formats ---- */
/** Pay's bounded text: non-blank, at most `max` UTF-16 units, no C0 control characters or DEL. */
export const PAY_TEXT_MAX_LENGTH = 200;
export function isPayText(value:unknown,max:number=PAY_TEXT_MAX_LENGTH):value is string{
 return typeof value==='string'&&!!value.trim()&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
}
/** Caller-chosen idempotency key of createOrder/getOrderByOperation (`operationId`). */
export const OPERATION_ID_PATTERN = /^[A-Za-z0-9:_-]{1,200}$/;
export function isOperationId(value:unknown):value is string{return typeof value==='string'&&OPERATION_ID_PATTERN.test(value);}
/** Timestamps Pay emits: `Date#toISOString()` output with milliseconds, UTC. */
export const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export function isUtcTimestamp(value:unknown):value is string{
 if(typeof value!=='string'||!UTC_TIMESTAMP_PATTERN.test(value))return false;
 const date=new Date(value);return Number.isFinite(date.getTime())&&date.toISOString()===value;
}
export const ORDER_PAGE_MAX_ITEMS = 50;
export const ORDER_CURSOR_MAX_LENGTH = 2048;

/* ---- Checkout ---- */
/** Checkout state: 32 random bytes, base64url without padding (43 characters). */
export const CHECKOUT_STATE_LENGTH = 43;
export const CHECKOUT_STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export function isCheckoutState(value:unknown):value is string{return typeof value==='string'&&CHECKOUT_STATE_PATTERN.test(value);}
/** `stateHash` of checkoutCaptureStatus: lowercase hex SHA-256 of the UTF-8 checkout state. */
export const CHECKOUT_STATE_HASH_PATTERN = /^[a-f0-9]{64}$/;
export const CHECKOUT_CALLBACK_ORIGIN = 'https://admin.devslab.kr';
export const CHECKOUT_CALLBACK_PATHS = {success:'/api/payments/callback/success',fail:'/api/payments/callback/fail'} as const;
export type CheckoutOutcome = keyof typeof CHECKOUT_CALLBACK_PATHS;
/** The exact successUrl/failUrl Pay hands to the payment window: the fixed callback with only `state`. */
export function checkoutCallbackUrl(outcome:CheckoutOutcome,state:string):string{
 if(!Object.hasOwn(CHECKOUT_CALLBACK_PATHS,outcome)||!isCheckoutState(state))throw new PayContractError('invalid_input','The checkout callback is invalid.');
 return CHECKOUT_CALLBACK_ORIGIN+CHECKOUT_CALLBACK_PATHS[outcome]+'?state='+state;
}
export const CHECKOUT_ORDER_NAME = 'DevsLab 문자 충전 테스트';
export const TEST_CLIENT_KEY_PATTERN = /^test_ck_[A-Za-z0-9_-]+$/;
export const CUSTOMER_KEY_PATTERN = /^pay_[a-f0-9]{32}$/;
export const REASON_CODE_PATTERN = /^[a-z0-9_]{1,100}$/;
