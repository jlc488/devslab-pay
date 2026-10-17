import type {PayScope} from '@devslab-kr/pay-contract';
import type {PayStore,StoredOrder} from './store';
import type {PaymentAdapters} from './adapters';
import type {GatewayPayment,LedgerReceipt} from './domain';
import {conflict} from './domain';
import {EffectAuthorityError} from './effect-authority';
function paid(order:StoredOrder,payment:GatewayPayment|null,status='DONE'){
 return !!payment&&payment.paymentKey===order.payment_key&&payment.orderId===order.provider_order_id&&payment.totalAmount===order.total_krw&&payment.currency==='KRW'&&payment.status===status;
}
function ledger(order:StoredOrder,id:string,receipt:LedgerReceipt|null,state:string){
 return !!receipt&&receipt.companyId===order.company_id&&receipt.operationId===id&&receipt.supplyKrw===order.supply_krw&&receipt.state===state;
}
async function effect(adapters:PaymentAdapters){await adapters.beforeEffect();}
async function credit(store:PayStore,scope:PayScope,order:StoredOrder,adapters:PaymentAdapters){
 const id='payment:'+order.id;
 try{
  await effect(adapters);let receipt=await adapters.ledger.getCredit(order,id);
  if(!receipt){await effect(adapters);receipt=await adapters.ledger.credit(order,id);}
  if(ledger(order,id,receipt,'credited'))await store.transition(order.id,'credited',['credit_pending']);
 }catch(error){if(error instanceof EffectAuthorityError)throw error;/* Paid-but-unsettled fact remains durable. */}
 return store.load(scope,order.id);
}
export async function confirmPayment(store:PayStore,scope:PayScope,initial:StoredOrder,adapters:PaymentAdapters):Promise<StoredOrder>{
 let order=initial;if(!order.payment_key)throw conflict();
 if(['credited','refund_pending','refund_unknown','refunded'].includes(order.state))return order;
 if(order.state==='credit_pending')return credit(store,scope,order,adapters);
 await effect(adapters);
 const claimed=await store.transition(order.id,'confirming',['created']);order=await store.load(scope,order.id);
 if(order.state==='credit_pending')return credit(store,scope,order,adapters);
 if(!['confirming','provider_unknown'].includes(order.state))return order;
 try{
  await effect(adapters);let result=claimed?await adapters.gateway.confirm(order):await adapters.gateway.lookup(order);
  if(!claimed&&(!result||(paid(order,result,result.status)&&['READY','IN_PROGRESS'].includes(result.status)&&result.balanceAmount===order.total_krw))){await effect(adapters);result=await adapters.gateway.confirm(order);}
  if(!paid(order,result)||result!.balanceAmount!==order.total_krw)throw conflict();
  // Persist observed approval before any later, independently authorized effect.
  await store.transition(order.id,'credit_pending',['confirming','provider_unknown']);
 }catch(error){await store.transition(order.id,'provider_unknown',['confirming']);if(error instanceof EffectAuthorityError)throw error;return store.load(scope,order.id);}
 order=await store.load(scope,order.id);return order.state==='credit_pending'?credit(store,scope,order,adapters):order;
}
export async function refundPayment(store:PayStore,scope:PayScope,initial:StoredOrder,reason:string,adapters:PaymentAdapters):Promise<StoredOrder>{
 if(initial.refund_reason&&initial.refund_reason!==reason)throw conflict();if(initial.state==='refunded')return initial;if(!initial.payment_key)throw conflict();
 await effect(adapters);
 const claimed=await store.claimRefund(scope,initial.id,reason);
 let order=await store.load(scope,initial.id);const id='refund:'+order.id;
 try{
  await effect(adapters);
  let hold=claimed?await adapters.ledger.reserveRefund(order,id,reason):await adapters.ledger.getRefund(order,id);
  if(!hold){await effect(adapters);hold=await adapters.ledger.reserveRefund(order,id,reason);}
  if(ledger(order,id,hold,'refunded')){
   if(!hold?.providerRefundId)throw conflict();
   await store.bindRefundReceipt(scope,order.id,hold.providerRefundId);
   await store.transition(order.id,'refunded',['refund_pending','refund_unknown']);return store.load(scope,order.id);
  }
  if(!ledger(order,id,hold,'reserved'))throw conflict();
  let providerRefundId=order.provider_refund_id;
  if(!providerRefundId){
   let canceled:GatewayPayment|null;
   if(claimed){await effect(adapters);canceled=await adapters.gateway.cancel(order,id,reason);}
   else {
    await effect(adapters);canceled=await adapters.gateway.lookup(order);
    if(paid(order,canceled)&&canceled!.balanceAmount===order.total_krw){await effect(adapters);canceled=await adapters.gateway.cancel(order,id,reason);}
   }
   if(!paid(order,canceled,'CANCELED')||canceled!.balanceAmount!==0||typeof canceled!.refundTransactionId!=='string'||!canceled!.refundTransactionId||canceled!.refundTransactionId.length>64)throw conflict();
   providerRefundId=canceled!.refundTransactionId;
   // Keep verified cancellation proof even when authority disappears before finalize.
   order=await store.bindRefundReceipt(scope,order.id,providerRefundId);
  }
  await effect(adapters);const result=await adapters.ledger.finalizeRefund(order,id,providerRefundId);
  if(!ledger(order,id,result,'refunded')||result.providerRefundId!==providerRefundId)throw conflict();
  await store.transition(order.id,'refunded',['refund_pending','refund_unknown']);
 }catch(error){
  // No ambiguous error releases principal. Known cancellation proof is retained.
  await store.transition(order.id,'refund_unknown',['refund_pending']);
  if(error instanceof EffectAuthorityError)throw error;
 }
 return store.load(scope,order.id);
}
