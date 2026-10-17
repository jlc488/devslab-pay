import {
 CHECKOUT_CALLBACK_ORIGIN,CHECKOUT_CALLBACK_PATHS,CHECKOUT_ORDER_NAME,CUSTOMER_KEY_PATTERN,ORDER_CURSOR_MAX_LENGTH,ORDER_PAGE_MAX_ITEMS,
 PAYMENT_PRICING,PAYMENT_STATES,REASON_CODE_PATTERN,TEST_CLIENT_KEY_PATTERN,VAT_RATE_PERCENT,isCheckoutState,isPayText,isUtcTimestamp,
 type CheckoutOutcome,
} from './constants.js';
import {PayContractError} from './errors.js';
import {calculateRecharge} from './pricing.js';
import type {CheckoutCaptureResult,CheckoutPreparation,OrderPage,PaymentCapabilities,PublicOrder} from './types.js';

/*
 * Response parsers for callers that re-validate what Pay returned. Each checks the shape and the
 * invariants Pay guarantees and returns a fresh object holding only contract fields; unknown extra
 * fields are dropped (Pay may add fields in a minor version). Identity checks that need the caller's
 * context (expected company, order or clock) stay with the caller.
 * Failures throw PayContractError('invalid_response') and never echo response values.
 */

type Row = Record<string,unknown>;
function fail(what:string):never{throw new PayContractError('invalid_response',`Pay ${what} response does not match the contract.`);}
function record(value:unknown,what:string):Row{
 if(typeof value!=='object'||value===null||Array.isArray(value))fail(what);
 return value as Row;
}
function text(value:unknown,what:string):string{if(!isPayText(value))fail(what);return value;}
function timestamp(value:unknown,what:string):string{if(!isUtcTimestamp(value))fail(what);return value;}
function oneOf<T extends string>(value:unknown,allowed:readonly T[],what:string):T{
 if(typeof value!=='string'||!(allowed as readonly string[]).includes(value))fail(what);
 return value as T;
}
function bool(value:unknown,what:string):boolean{if(typeof value!=='boolean')fail(what);return value;}
/** A total Pay can charge: some valid supply amount plus its VAT. */
function rechargeTotal(value:unknown,what:string):number{
 if(typeof value!=='number'||!Number.isSafeInteger(value))fail(what);
 try{if(calculateRecharge(value*100/(100+VAT_RATE_PERCENT)).totalKrw===value)return value;}catch{/* not a payable total */}
 return fail(what);
}

/** getOrder, getOrderByOperation, createOrder, confirmOrder, reconcileOrder, refundOrder. Enforces the recharge amounts and known states. */
export function parsePublicOrder(value:unknown):PublicOrder{
 const what='order',v=record(value,what);
 if(v.mode!=='test'||v.purpose!=='messaging_recharge'||v.currency!=='KRW')fail(what);
 let amounts:ReturnType<typeof calculateRecharge>;
 try{amounts=calculateRecharge(v.supplyKrw);}catch{return fail(what);}
 if(v.vatKrw!==amounts.vatKrw||v.totalKrw!==amounts.totalKrw)fail(what);
 return {
  mode:'test',purpose:'messaging_recharge',id:text(v.id,what),companyId:text(v.companyId,what),orderId:text(v.orderId,what),operationId:text(v.operationId,what),
  supplyKrw:amounts.supplyKrw,vatKrw:amounts.vatKrw,totalKrw:amounts.totalKrw,currency:'KRW',state:oneOf(v.state,PAYMENT_STATES,what),
  createdAt:timestamp(v.createdAt,what),updatedAt:timestamp(v.updatedAt,what),
 };
}
/** listOrders. At most 50 orders per page; `nextCursor` is opaque and only passed back to Pay. */
export function parseOrderPage(value:unknown):OrderPage{
 const what='order page',v=record(value,what);
 if(!Array.isArray(v.items)||v.items.length>ORDER_PAGE_MAX_ITEMS)fail(what);
 const cursor=v.nextCursor;
 if(cursor!==null&&(typeof cursor!=='string'||cursor.length>ORDER_CURSOR_MAX_LENGTH||!/^[A-Za-z0-9_-]+$/.test(cursor)))fail(what);
 return {items:v.items.map(parsePublicOrder),nextCursor:cursor};
}
/** capabilities. `mode: 'test'` always comes with `provider: 'toss'`, `unavailable` with `null`; pricing is fixed. */
export function parseCapabilities(value:unknown):PaymentCapabilities{
 const what='capabilities',v=record(value,what);
 const mode=oneOf(v.mode,['test','unavailable'] as const,what);
 if(mode==='test'?v.provider!=='toss':v.provider!==null)fail(what);
 const c=record(v.capabilities,what),p=record(v.pricing,what);
 if((Object.keys(PAYMENT_PRICING) as (keyof typeof PAYMENT_PRICING)[]).some(k=>p[k]!==PAYMENT_PRICING[k]))fail(what);
 const reasonCode=v.reasonCode;
 if(reasonCode!==null&&(typeof reasonCode!=='string'||!REASON_CODE_PATTERN.test(reasonCode)))fail(what);
 return {
  companyId:text(v.companyId,what),mode,provider:mode==='test'?'toss':null,
  capabilities:{read:bool(c.read,what),checkout:bool(c.checkout,what),refund:bool(c.refund,what)},
  pricing:{...PAYMENT_PRICING},reasonCode,
 };
}
function callbackState(value:unknown,outcome:CheckoutOutcome,what:string):string{
 const prefix=CHECKOUT_CALLBACK_ORIGIN+CHECKOUT_CALLBACK_PATHS[outcome]+'?state=';
 if(typeof value!=='string'||!value.startsWith(prefix)||!isCheckoutState(value.slice(prefix.length)))fail(what);
 return value.slice(prefix.length);
}
/**
 * prepareCheckout. successUrl/failUrl must be exactly the fixed Admin callbacks carrying one shared
 * 43-character state. The caller still compares id, orderId and amount with the order and expiresAt with its clock.
 */
export function parseCheckoutPreparation(value:unknown):CheckoutPreparation{
 const what='checkout preparation',v=record(value,what),a=record(v.amount,what);
 if(v.mode!=='test'||v.provider!=='toss'||v.kind!=='general-test'||v.orderName!==CHECKOUT_ORDER_NAME||a.currency!=='KRW')fail(what);
 if(typeof v.clientKey!=='string'||!TEST_CLIENT_KEY_PATTERN.test(v.clientKey)||typeof v.customerKey!=='string'||!CUSTOMER_KEY_PATTERN.test(v.customerKey))fail(what);
 const state=callbackState(v.successUrl,'success',what);
 if(callbackState(v.failUrl,'fail',what)!==state)fail(what);
 return {
  companyId:text(v.companyId,what),id:text(v.id,what),mode:'test',provider:'toss',kind:'general-test',clientKey:v.clientKey,customerKey:v.customerKey,
  orderId:text(v.orderId,what),amount:{currency:'KRW',value:rechargeTotal(a.value,what)},orderName:CHECKOUT_ORDER_NAME,
  successUrl:v.successUrl as string,failUrl:v.failUrl as string,expiresAt:timestamp(v.expiresAt,what),
 };
}
/** captureCheckoutCallback and checkoutCaptureStatus. */
export function parseCheckoutCaptureResult(value:unknown):CheckoutCaptureResult{
 const what='checkout capture',v=record(value,what);
 return {
  returnTarget:oneOf(v.returnTarget,['contract','admin'] as const,what),companyId:text(v.companyId,what),id:text(v.id,what),
  result:oneOf(v.result,['captured','failed','unknown'] as const,what),
 };
}
