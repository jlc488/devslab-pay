import type {TestWallet,PayScope,PayEffectAuthority} from '@devslab-kr/pay-contract';
import type {Env} from './env';
import type {StoredOrder} from './store';
import type {GatewayPayment,LedgerReceipt} from './domain';
import type {ResolvedSnapshots} from './registry';
import {parseProviderReceipt,parseLedgerReceipt,object,text,unavailable} from './domain';
import {boundedJson} from './http';
import {checkEffectAuthority,withEffectAuthority} from './effect-authority';
export interface PaymentGateway {confirm(order:StoredOrder):Promise<GatewayPayment>;lookup(order:StoredOrder):Promise<GatewayPayment|null>;cancel(order:StoredOrder,operationId:string,reason:string):Promise<GatewayPayment>}
export interface PaymentLedger {getCredit(order:StoredOrder,id:string):Promise<LedgerReceipt|null>;credit(order:StoredOrder,id:string):Promise<LedgerReceipt>;getRefund(order:StoredOrder,id:string):Promise<LedgerReceipt|null>;reserveRefund(order:StoredOrder,id:string,reason:string):Promise<LedgerReceipt>;finalizeRefund(order:StoredOrder,id:string,providerRefundId:string):Promise<LedgerReceipt>;wallet():Promise<TestWallet>}
export interface PaymentAdapters {gateway:PaymentGateway;ledger:PaymentLedger;beforeEffect():Promise<void>|void}
export function externalGate(env:Env):void{if(env.PAY_EXTERNAL_ACTIONS_ENABLED!=='true')throw unavailable();}
async function financialCall(env:Env,authority:PayEffectAuthority|undefined,url:string,headers:Record<string,string>,input?:unknown,local=false):Promise<Response>{
 externalGate(env);
 const request=new Request(url,{method:input===undefined?'GET':'POST',redirect:'manual',headers:{...headers,accept:'application/json','content-type':'application/json'},signal:AbortSignal.timeout(20000),...(input===undefined?{}:{body:JSON.stringify(input)})});
 const transport=local?env.NOTIFY_LOCAL_SERVICE:undefined;
 if(local&&!transport)throw unavailable();
 const response=await withEffectAuthority(authority,async()=>{externalGate(env);return transport?transport.fetch(request):fetch(request);});
 if(response.status>=300&&response.status<400)throw unavailable();return response;
}
export function paymentAdapters(env:Env,_scope:PayScope,resolved:ResolvedSnapshots,authority?:PayEffectAuthority):PaymentAdapters{
 const gatewayHeaders={authorization:'Basic '+btoa(resolved.provider.secret+':')};
 async function toss(path:string,input?:unknown,idempotency?:string):Promise<unknown|null>{
  const response=await financialCall(env,authority,'https://api.tosspayments.com'+path,{...gatewayHeaders,...(idempotency?{'Idempotency-Key':idempotency}:{})},input);
  const raw=await boundedJson(response);
  if(response.status===404&&input===undefined&&object(raw).code==='NOT_FOUND_PAYMENT')return null;
  if(!response.ok)throw unavailable();return raw;
 }
 const base='https://notify.devslab.kr/admin/workspaces/'+encodeURIComponent(resolved.ledger.workspaceId)+'/test-wallet';
 async function notify(path:string,input?:unknown):Promise<unknown|null>{
  const response=await financialCall(env,authority,base+path,{authorization:'Bearer '+resolved.ledgerCredential.secret},input,resolved.ledger.transport==='notify-service');
  if(response.status===404&&input===undefined)return null;if(!response.ok)throw unavailable();return boundedJson(response);
 }
 const required=(receipt:LedgerReceipt|null)=>{if(!receipt)throw unavailable();return receipt;};
 const ledgerReceipt=(o:StoredOrder,id:string,raw:unknown,states:string[])=>raw===null?null:parseLedgerReceipt(o,id,raw,states);
 return {
  beforeEffect:async()=>{externalGate(env);await checkEffectAuthority(authority);externalGate(env);},
  gateway:{
   async confirm(o){if(!o.payment_key)throw unavailable();const raw=await toss('/v1/payments/confirm',{paymentKey:o.payment_key,orderId:o.provider_order_id,amount:o.total_krw},'confirm:'+o.id);const result=parseProviderReceipt(o,raw);if(result.status!=='DONE'||result.balanceAmount!==o.total_krw)throw unavailable();return result;},
   async lookup(o){const key=text(o.payment_key);const raw=await toss('/v1/payments/'+encodeURIComponent(key));return raw===null?null:parseProviderReceipt(o,raw);},
   async cancel(o,id,reason){if(id!=='refund:'+o.id)throw unavailable();const key=text(o.payment_key);return parseProviderReceipt(o,await toss('/v1/payments/'+encodeURIComponent(key)+'/cancel',{cancelReason:reason,cancelAmount:o.total_krw},id),true);}
  },
  ledger:{
   async getCredit(o,id){return ledgerReceipt(o,id,await notify('/payment-credits/'+encodeURIComponent(id)),['credited']);},
   async credit(o,id){if(id!=='payment:'+o.id)throw unavailable();return required(ledgerReceipt(o,id,await notify('/payment-credits',{operationId:id,provider:'toss',providerOrderId:o.provider_order_id,providerPaymentId:o.payment_key,supplyKrw:o.supply_krw,vatKrw:o.vat_krw,totalKrw:o.total_krw,currency:'KRW'}),['credited']));},
   async getRefund(o,id){return ledgerReceipt(o,id,await notify('/refund-reservations/'+encodeURIComponent(id)),['reserved','refunded','released']);},
   async reserveRefund(o,id,reason){if(id!=='refund:'+o.id||reason!==o.refund_reason)throw unavailable();return required(ledgerReceipt(o,id,await notify('/refund-reservations',{operationId:id,creditOperationId:'payment:'+o.id,supplyKrw:o.supply_krw,reason}),['reserved']));},
   async finalizeRefund(o,id,providerRefundId){const raw=await notify('/refund-reservations/'+encodeURIComponent(id)+'/finalize',{providerRefundId});if(object(raw).providerRefundId!==providerRefundId)throw unavailable();return required(ledgerReceipt(o,id,raw,['refunded']));},
   async wallet(){const raw=object(await notify(''));if(raw.mode!=='test'||!['availableKrw','reservedKrw','refundedKrw'].every(k=>Number.isSafeInteger(raw[k])&&Number(raw[k])>=0)||(raw.workspaceId!==undefined&&raw.workspaceId!==resolved.ledger.workspaceId))throw unavailable();return {mode:'test',availableKrw:Number(raw.availableKrw),reservedKrw:Number(raw.reservedKrw),refundedKrw:Number(raw.refundedKrw)};}
  }
 };
}
