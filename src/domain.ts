import type {PayScope,ConnectionSnapshot,LedgerSnapshot,PaymentState,PublicOrder,PayErrorCode,RechargeAmounts,CheckoutReturn} from '@devslab-kr/pay-contract';
import {PayContractError,calculateRecharge as contractRecharge,calculateOrderRecharge as contractOrderRecharge,resolveCheckoutReturn,canonicalJson,isOperationId,isPayText,isUtcTimestamp} from '@devslab-kr/pay-contract';
export {sha256Hex as sha256} from '@devslab-kr/pay-contract';
export class PayError extends Error {
 constructor(readonly status:400|401|403|404|405|409|503,readonly code:PayErrorCode,message:string){super(message);}
}
export const invalid=()=>new PayError(400,'invalid_input','The request is invalid.');
export const conflict=()=>new PayError(409,'immutable_conflict','The saved payment intent does not match this request.');
export const unavailable=()=>new PayError(503,'payment_unavailable','Payment integration is unavailable.');
/** The published contract's helpers reject input with PayContractError('invalid_input'); Pay reports that as its own 400. */
export function contractFailure(error:unknown):unknown{return error instanceof PayContractError?invalid():error;}
export function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();return value as Record<string,unknown>;}
export function text(value:unknown,max=200):string {if(!isPayText(value,max))throw invalid();return value;}
export function operation(value:unknown):string {if(!isOperationId(value))throw invalid();return value;}
export function exactKeys(value:Record<string,unknown>,required:string[],optional:string[]=[]){if(required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k)))throw invalid();}
export function calculateRecharge(value:unknown):RechargeAmounts{try{return contractRecharge(value);}catch(error){throw contractFailure(error);}}
/** A new order's amounts: Pay's price list plus the per-order maximum. The caller only picks the supply amount. */
export function calculateOrderRecharge(value:unknown):RechargeAmounts{try{return contractOrderRecharge(value);}catch(error){throw contractFailure(error);}}
/** The final redirect entry of a checkout, only from the published registry; anything else is a 400. Never a URL. */
export function checkoutReturn(returnTarget:unknown,returnTo?:unknown):CheckoutReturn{try{return resolveCheckoutReturn(returnTarget,returnTo);}catch(error){throw contractFailure(error);}}
export function validateScope(value:unknown):PayScope {
 const v=object(value);exactKeys(v,['subject','companyId','access']);const subject=text(v.subject),companyId=text(v.companyId);
 if(v.access!=='self'&&v.access!=='company')throw invalid();return {subject,companyId,access:v.access};
}
export function validateConnection(scope:PayScope,value:unknown):ConnectionSnapshot{
 const v=object(value);exactKeys(v,['id','companyId','revision','provider','environment','providerAccountId','credentialSetId']);
 if(v.companyId!==scope.companyId||v.provider!=='toss'||v.environment!=='test')throw invalid();
 return {id:text(v.id),companyId:scope.companyId,revision:text(v.revision),provider:'toss',environment:'test',providerAccountId:text(v.providerAccountId),credentialSetId:text(v.credentialSetId)};
}
export function validateSnapshots(scope:PayScope,connection:unknown,ledger:unknown):{connection:ConnectionSnapshot;ledger:LedgerSnapshot}{
 const c=validateConnection(scope,connection),v=object(ledger);
 exactKeys(v,['provider','companyId','workspaceId','integrationId','revision','credentialSetId','environment','kind','transport']);
 if(v.companyId!==scope.companyId||v.provider!=='notify'||v.environment!=='test'||v.kind!=='notify-test-wallet'||!['notify-service','https-fixed-notify'].includes(String(v.transport)))throw invalid();
 return {connection:c,ledger:{provider:'notify',companyId:scope.companyId,workspaceId:text(v.workspaceId),integrationId:text(v.integrationId),revision:text(v.revision),credentialSetId:text(v.credentialSetId),environment:'test',kind:'notify-test-wallet',transport:v.transport as LedgerSnapshot['transport']}};
}
export interface ReceiptOrder {id:string;company_id:string;provider_order_id:string;payment_key:string|null;supply_krw:number;vat_krw:number;total_krw:number;refund_reason:string|null;provider_refund_id?:string|null;ledger:LedgerSnapshot}
/** A provider receipt Pay fetched itself (confirm/lookup/cancel). `merchantId` is the receipt's `mId`, matched to the saved connection. */
export interface GatewayPayment {paymentKey:string;orderId:string;merchantId:string;totalAmount:number;currency:'KRW';status:string;balanceAmount:number;refundTransactionId?:string}
export interface LedgerReceipt {operationId:string;companyId:string;supplyKrw:number;state:'credited'|'reserved'|'refunded'|'released';providerRefundId?:string}
/**
 * Server-side provider receipt check, field by field against the saved order: payment key, order id,
 * merchant (`mId` = the saved connection's providerAccountId), amount, currency, test mode and balance.
 * Browser callback values never reach this; any mismatch is a conflict and nothing is credited.
 */
export function parseProviderReceipt(order:Pick<ReceiptOrder,'payment_key'|'provider_order_id'|'total_krw'>&{connection:Pick<ConnectionSnapshot,'providerAccountId'>},value:unknown,canceled=false):GatewayPayment{
 const v=object(value);
 if(v.isLiveMode===true||v.paymentKey!==order.payment_key||v.orderId!==order.provider_order_id||typeof v.mId!=='string'||v.mId!==order.connection.providerAccountId||v.totalAmount!==order.total_krw||v.currency!=='KRW'||typeof v.status!=='string'||!Number.isSafeInteger(v.balanceAmount)||Number(v.balanceAmount)<0||Number(v.balanceAmount)>order.total_krw)throw conflict();
 const result:GatewayPayment={paymentKey:text(v.paymentKey),orderId:order.provider_order_id,merchantId:order.connection.providerAccountId,totalAmount:order.total_krw,currency:'KRW',status:v.status,balanceAmount:Number(v.balanceAmount)};
 if(canceled||v.status==='CANCELED'){
  if(v.status!=='CANCELED'||v.balanceAmount!==0||!Array.isArray(v.cancels)||v.cancels.length!==1)throw conflict();
  const cancel=object(v.cancels[0]);if(cancel.cancelStatus!=='DONE'||cancel.cancelAmount!==order.total_krw||cancel.refundableAmount!==0)throw conflict();
  result.refundTransactionId=text(cancel.transactionKey,64);
 }
 return result;
}
export function parseLedgerReceipt(order:ReceiptOrder,id:string,value:unknown,allowed:string[]):LedgerReceipt{
 const v=object(value);
 if(v.mode!=='test'||v.workspaceId!==order.ledger.workspaceId||v.operationId!==id||v.supplyKrw!==order.supply_krw||typeof v.state!=='string'||!allowed.includes(v.state))throw conflict();
 if(v.state==='credited'){
  if(v.provider!=='toss'||v.currency!=='KRW'||v.providerOrderId!==order.provider_order_id||v.providerPaymentId!==order.payment_key||v.vatKrw!==order.vat_krw||v.totalKrw!==order.total_krw)throw conflict();
 }else if(v.creditOperationId!=='payment:'+order.id||v.reason!==order.refund_reason)throw conflict();
 const providerRefundId=v.state==='refunded'?text(v.providerRefundId,64):undefined;if(providerRefundId&&order.provider_refund_id&&order.provider_refund_id!==providerRefundId)throw conflict();
 return {operationId:id,companyId:order.company_id,supplyKrw:order.supply_krw,state:v.state as LedgerReceipt['state'],...(providerRefundId?{providerRefundId}:{})};
}
export function publicOrder(row:{id:string;company_id:string;provider_order_id:string;idempotency_key:string;supply_krw:number;vat_krw:number;total_krw:number;state:PaymentState;created_at:string;updated_at:string}):PublicOrder{
 return {mode:'test',purpose:'messaging_recharge',id:row.id,companyId:row.company_id,orderId:row.provider_order_id,operationId:row.idempotency_key,supplyKrw:row.supply_krw,vatKrw:row.vat_krw,totalKrw:row.total_krw,currency:'KRW',state:row.state,createdAt:row.created_at,updatedAt:row.updated_at};
}
/** Pay's canonical JSON (published as canonicalJson); values without a canonical form are a 400. */
export function canonical(value:unknown):string {try{return canonicalJson(value);}catch(error){throw contractFailure(error);}}
export function utc(value:unknown):string {if(!isUtcTimestamp(value))throw invalid();return value;}
