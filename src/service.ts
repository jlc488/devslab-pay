import type {PayCommand,PayResponse,PayResult,PaymentCapabilities,PaymentConfig,CheckoutPreparation,ScopedPayCommand,PayEffectAuthority} from '@devslab-kr/pay-contract';
import type {Env} from './env';
import {PayStore} from './store';
import type {StoredOrder} from './store';
import {PayError,object,exactKeys,validateScope,validateSnapshots,canonical,sha256,text,operation,calculateOrderRecharge,checkoutReturn,publicOrder,invalid,conflict,unavailable} from './domain';
import {inspectConnection,resolveSnapshots} from './registry';
import {connectionState,connectConnection,revokeConnection,verifyTossSecretKey,type ConnectionUse,type TossVerifier} from './connections';
import type {ResolvedSnapshots} from './registry';
import {externalGate,paymentAdapters} from './adapters';
import {confirmPayment,refundPayment} from './payments';
import {checkEffectAuthority} from './effect-authority';
import {PAYMENT_PRICING,CHECKOUT_ORDER_NAME,checkoutCallbackUrl} from '@devslab-kr/pay-contract';
const fields:Record<string,{required:string[];optional?:string[]}> = {
 capabilities:{required:[],optional:['connection','ledger']},config:{required:[],optional:['connection','ledger']},inspectConnection:{required:['connection']},getOrderByOperation:{required:['operationId','supplyKrw']},
 listOrders:{required:[],optional:['cursor']},createOrder:{required:['operationId','supplyKrw','connection','ledger']},getOrder:{required:['id']},
 prepareCheckout:{required:['id','returnTarget'],optional:['returnTo','ownership']},confirmOrder:{required:['id','paymentKey','orderId','amount'],optional:['ownership']},reconcileOrder:{required:['id'],optional:['ownership']},refundOrder:{required:['id','reason'],optional:['ownership']},
 importLegacy:{required:['migrationId','generation','digest','order','connection','ledger']},importStatus:{required:['id','ownership']},activateImport:{required:['id','ownership','sourceCommitted']},abortImport:{required:['id','ownership']},
 connectionState:{required:[]},connectConnection:{required:['merchantId','clientKey','secretKey']},revokeConnection:{required:['connectionId']}
};
export class PayApplication {
 readonly store:PayStore;
 /** `verifyToss` is the read-only Toss key probe; tests replace it so no test reaches Toss. */
 constructor(readonly env:Env,private readonly verifyToss:TossVerifier=verifyTossSecretKey){this.store=new PayStore(env.DB);}
 async dispatch(command:PayCommand,effectAuthority?:PayEffectAuthority):Promise<PayResponse>{
  try{return {ok:true,result:await this.execute(command,effectAuthority)};}catch(error){
   const safe=error instanceof PayError?error:unavailable();return {ok:false,status:safe.status,error:{code:safe.code,message:safe.message}};
  }
 }
 private async readiness(command:Extract<ScopedPayCommand,{action:'capabilities'|'config'}>):Promise<ResolvedSnapshots>{
  if(!command.connection||!command.ledger)throw unavailable();
  return resolveSnapshots(this.env,command.scope,command.connection,command.ledger,'new');
 }
 private async saved(scope:ScopedPayCommand['scope'],row:StoredOrder,use:ConnectionUse):Promise<ResolvedSnapshots>{
  const resolved=await resolveSnapshots(this.env,scope,row.connection,row.ledger,use);
  if(row.provider_fingerprint!==resolved.fingerprints.provider||row.ledger_fingerprint!==resolved.fingerprints.ledger)throw unavailable();return resolved;
 }
 private async execute(command:PayCommand,effectAuthority?:PayEffectAuthority):Promise<PayResult>{
  const raw=object(command);
  if(raw.action==='captureCheckoutCallback'){
   const {action:_,...callback}=raw;return this.store.captureCheckout(callback as Extract<PayCommand,{action:'captureCheckoutCallback'}>);
  }
  if(raw.action==='checkoutCaptureStatus'){exactKeys(raw,['action','stateHash']);return this.store.checkoutStatus(raw.stateHash as string);}
  const spec=typeof raw.action==='string'&&Object.hasOwn(fields,raw.action)?fields[raw.action]:undefined;if(!spec)throw invalid();
  exactKeys(raw,['action','scope',...spec.required],spec.optional);const scope=validateScope(raw.scope),c=command as ScopedPayCommand;
  switch(c.action){
   case 'inspectConnection':return inspectConnection(this.env,scope,c.connection);
   case 'connectionState':return connectionState(this.env.DB,scope);
   case 'connectConnection':return connectConnection(this.env,scope,raw,effectAuthority,this.verifyToss);
   case 'revokeConnection':return revokeConnection(this.env,scope,raw,effectAuthority);
   case 'capabilities':{
    let ready=false;try{await this.readiness(c);externalGate(this.env);ready=true;}catch{}
    return {companyId:scope.companyId,mode:ready?'test':'unavailable',provider:ready?'toss':null,capabilities:{read:true,checkout:ready,refund:ready},pricing:PAYMENT_PRICING,reasonCode:ready?null:'payment_unavailable'} satisfies PaymentCapabilities;
   }
   case 'config':{
    externalGate(this.env);const resolved=await this.readiness(c),adapters=paymentAdapters(this.env,scope,resolved,effectAuthority),wallet=await adapters.ledger.wallet(),page=await this.store.list(scope),lastOrder=page.items.find(o=>o.state!=='refunded');
    return {mode:'test',provider:'toss',clientKey:resolved.provider.clientKey,...(lastOrder?{lastOrder}:{}),wallet} satisfies PaymentConfig;
   }
   case 'getOrderByOperation':{const row=await this.store.findByOperation(scope,c.operationId,c.supplyKrw);if(!row)throw new PayError(404,'not_found','Payment order was not found.');return publicOrder(row);}
   case 'listOrders':return this.store.list(scope,c.cursor);
   case 'getOrder':return publicOrder(await this.store.load(scope,c.id));
   case 'createOrder':{
    // Pay decides every amount from its price list and caps one order; the caller only picks the supply.
    operation(c.operationId);calculateOrderRecharge(c.supplyKrw);
    const previous=await this.store.findByOperation(scope,c.operationId,c.supplyKrw);if(previous)return publicOrder(previous);
    await checkEffectAuthority(effectAuthority);externalGate(this.env);const snapshots=validateSnapshots(scope,c.connection,c.ledger),resolved=await resolveSnapshots(this.env,scope,snapshots.connection,snapshots.ledger,'new');
    return publicOrder(await this.store.create(scope,c.operationId,c.supplyKrw,snapshots.connection,snapshots.ledger,resolved.fingerprints));
   }
   case 'prepareCheckout':{
    // The final redirect is chosen from the published registry only, before any effect or nonce.
    const returnTo=checkoutReturn(c.returnTarget,c.returnTo);
    const row=await this.store.load(scope,c.id);await this.store.assertWritable(row,c.ownership);
    if(row.state!=='created'||row.payment_key)throw conflict();await checkEffectAuthority(effectAuthority);externalGate(this.env);
    const resolved=await this.saved(scope,row,'continue');await checkEffectAuthority(effectAuthority);externalGate(this.env);const nonce=await this.store.issueCheckout(scope,row.id,returnTo,c.ownership);
    const customerKey='pay_'+(await sha256(canonical({companyId:scope.companyId,subject:scope.subject,providerAccountId:row.connection.providerAccountId}))).slice(0,32);
    return {companyId:scope.companyId,id:row.id,mode:'test',provider:'toss',kind:'general-test',clientKey:resolved.provider.clientKey,customerKey,orderId:row.provider_order_id,amount:{currency:'KRW',value:row.total_krw},orderName:CHECKOUT_ORDER_NAME,successUrl:checkoutCallbackUrl('success',nonce.state),failUrl:checkoutCallbackUrl('fail',nonce.state),expiresAt:nonce.expiresAt} satisfies CheckoutPreparation;
   }
   case 'confirmOrder':case 'reconcileOrder':{
    let row=await this.store.load(scope,c.id);await this.store.assertWritable(row,c.ownership);
    if(c.action==='confirmOrder'){
     text(c.paymentKey);if(c.orderId!==row.provider_order_id||c.amount!==row.total_krw||!Number.isSafeInteger(c.amount))throw conflict();
     if(row.payment_key&&row.payment_key!==c.paymentKey)throw conflict();
    }else if(!row.payment_key)throw conflict();
    const refundRecovery=c.action==='reconcileOrder'&&['refund_pending','refund_unknown'].includes(row.state);
    if(!refundRecovery&&['credited','refund_pending','refund_unknown','refunded'].includes(row.state))return publicOrder(row);
    await checkEffectAuthority(effectAuthority);externalGate(this.env);const resolved=await this.saved(scope,row,c.action==='confirmOrder'?'continue':'settle');
    if(refundRecovery){if(!row.refund_reason)throw conflict();return publicOrder(await refundPayment(this.store,scope,row,row.refund_reason,paymentAdapters(this.env,scope,resolved,effectAuthority)));}
    if(c.action==='confirmOrder')row=await this.store.bindPayment(scope,row.id,c.paymentKey);
    return publicOrder(await confirmPayment(this.store,scope,row,paymentAdapters(this.env,scope,resolved,effectAuthority)));
   }
   case 'refundOrder':{
    const reason=text(c.reason),row=await this.store.load(scope,c.id);await this.store.assertWritable(row,c.ownership);
    if(row.refund_reason&&row.refund_reason!==reason)throw conflict();if(row.state==='refunded')return publicOrder(row);
    await checkEffectAuthority(effectAuthority);externalGate(this.env);const resolved=await this.saved(scope,row,'settle');
    return publicOrder(await refundPayment(this.store,scope,row,reason,paymentAdapters(this.env,scope,resolved,effectAuthority)));
   }
   case 'importLegacy':{
    const prior=await this.store.importReplay(scope,c);if(prior)return prior;
    const resolved=await resolveSnapshots(this.env,scope,c.connection,c.ledger,'settle');
    return this.store.importLegacy(scope,c,resolved.fingerprints);
   }
   case 'importStatus':return this.store.importStatus(scope,c.id,c.ownership);
   case 'activateImport':return this.store.activateImport(scope,c.id,c.ownership,c.sourceCommitted);
   case 'abortImport':return this.store.abortImport(scope,c.id,c.ownership);
  }
 }
}
