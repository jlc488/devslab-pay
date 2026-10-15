import type {PayScope,ConnectionSnapshot,LedgerSnapshot,PaymentState,PublicOrder} from './contracts';
export class PayError extends Error {
 constructor(readonly status:400|401|403|404|405|409|503,readonly code:string,message:string){super(message);}
}
export const invalid=()=>new PayError(400,'invalid_input','The request is invalid.');
export const conflict=()=>new PayError(409,'immutable_conflict','The saved payment intent does not match this request.');
export const unavailable=()=>new PayError(503,'payment_unavailable','Payment integration is unavailable.');
export const states:PaymentState[]=['created','confirming','provider_unknown','credit_pending','credited','refund_pending','refund_unknown','refunded'];
export function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();return value as Record<string,unknown>;}
export function text(value:unknown,max=200):string {if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw invalid();return value;}
export function operation(value:unknown):string {if(typeof value!=='string'||!/^[A-Za-z0-9:_-]{1,200}$/.test(value))throw invalid();return value;}
export function exactKeys(value:Record<string,unknown>,required:string[],optional:string[]=[]){if(required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k)))throw invalid();}
export function calculateRecharge(value:unknown){
 if(!Number.isSafeInteger(value)||Number(value)<1000||Number(value)%1000!==0)throw invalid();
 const supplyKrw=Number(value),vatKrw=supplyKrw/10,totalKrw=supplyKrw+vatKrw;
 if(!Number.isSafeInteger(vatKrw)||!Number.isSafeInteger(totalKrw))throw invalid();
 return {supplyKrw,vatKrw,totalKrw,walletCreditKrw:supplyKrw,currency:'KRW' as const};
}
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
export interface GatewayPayment {paymentKey:string;orderId:string;totalAmount:number;currency:'KRW';status:string;balanceAmount:number;refundTransactionId?:string}
export interface LedgerReceipt {operationId:string;companyId:string;supplyKrw:number;state:'credited'|'reserved'|'refunded'|'released';providerRefundId?:string}
export function parseProviderReceipt(order:Pick<ReceiptOrder,'payment_key'|'provider_order_id'|'total_krw'>,value:unknown,canceled=false):GatewayPayment{
 const v=object(value);
 if(v.isLiveMode===true||v.paymentKey!==order.payment_key||v.orderId!==order.provider_order_id||v.totalAmount!==order.total_krw||v.currency!=='KRW'||typeof v.status!=='string'||!Number.isSafeInteger(v.balanceAmount)||Number(v.balanceAmount)<0||Number(v.balanceAmount)>order.total_krw)throw conflict();
 const result:GatewayPayment={paymentKey:text(v.paymentKey),orderId:order.provider_order_id,totalAmount:order.total_krw,currency:'KRW',status:v.status,balanceAmount:Number(v.balanceAmount)};
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
export function canonical(value:unknown):string {
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
 throw invalid();
}
export async function sha256(value:string):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('');}
export function utc(value:unknown):string {if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))throw invalid();const d=new Date(value);if(!Number.isFinite(d.getTime())||d.toISOString()!==value)throw invalid();return value;}
