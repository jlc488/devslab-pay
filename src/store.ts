import type {PayScope,ConnectionSnapshot,LedgerSnapshot,OwnershipFence,LegacyPaymentOrder,PaymentState,ImportReceipt,SourceCommittedProof,OrderPage,CheckoutCallback,CheckoutCaptureResult,ImportDigestInput} from '@devslab-kr/pay-contract';
import {PAYMENT_STATES,ORDER_PAGE_MAX_ITEMS,ORDER_CURSOR_MAX_LENGTH,CHECKOUT_STATE_HASH_PATTERN,importDigest as contractImportDigest,checkoutStateHash as contractCheckoutStateHash} from '@devslab-kr/pay-contract';
import {calculateRecharge,canonical,sha256,validateScope,validateSnapshots,object,text,operation,utc,exactKeys,invalid,conflict,unavailable,PayError,publicOrder,contractFailure} from './domain';
export interface Fingerprints {provider:string|null;ledger:string|null}
interface OrderRow {
 id:string;company_id:string;user_id:string;provider_order_id:string;idempotency_key:string;
 environment:'test';purpose:'messaging_recharge';provider:'toss';supply_krw:number;vat_krw:number;total_krw:number;currency:'KRW';state:PaymentState;
 payment_key:string|null;refund_reason:string|null;provider_refund_id:string|null;connection_json:string;ledger_json:string;provider_fingerprint:string;ledger_fingerprint:string;
 origin:'native'|'legacy';legacy_mode:'sandbox'|null;provenance_json:string|null;revision:number;created_at:string;updated_at:string;
}
export interface StoredOrder extends OrderRow {connection:ConnectionSnapshot;ledger:LedgerSnapshot}
interface ImportRow {order_id:string;migration_id:string;generation:string;digest:string;status:ImportReceipt['state']}
interface NonceRow {state_hash:string;order_id:string;company_id:string;subject:string;scope_access:PayScope['access'];provider_order_id:string;total_krw:number;return_target:'contract'|'admin';ownership_json:string|null;expires_at:string;created_at:string;consumed_at:string|null;result:'pending'|'captured'|'failed';callback_digest:string|null}
type ImportInput={migrationId:string;generation:string;digest:string;order:LegacyPaymentOrder;connection:ConnectionSnapshot;ledger:LedgerSnapshot};
const columns=['id','company_id','user_id','provider_order_id','idempotency_key','environment','purpose','provider','supply_krw','vat_krw','total_krw','currency','state','payment_key','refund_reason','provider_refund_id','connection_json','ledger_json','provider_fingerprint','ledger_fingerprint','origin','legacy_mode','provenance_json','revision','created_at','updated_at'] as const;
const missing=()=>new PayError(404,'not_found','Payment order was not found.');
function hydrate(row:OrderRow):StoredOrder{return {...row,connection:JSON.parse(row.connection_json) as ConnectionSnapshot,ledger:JSON.parse(row.ledger_json) as LedgerSnapshot};}
function receipt(row:ImportRow):ImportReceipt{return {migrationId:row.migration_id,orderId:row.order_id,generation:row.generation,digest:row.digest,state:row.status};}
function fingerprint(value:string|null):string{if(!value||!/^[a-f0-9]{64}$/.test(value))throw unavailable();return value;}
function unique(error:unknown):never{if(error instanceof Error&&/UNIQUE constraint failed|immutable/i.test(error.message))throw conflict();throw error;}
function encode(value:unknown){const bytes=new TextEncoder().encode(JSON.stringify(value));return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function decode(value:string):unknown{try{const binary=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0))));}catch{throw invalid();}}
/** The published cross-service import digest; a value without canonical JSON form is a 400. */
export async function importDigest(input:unknown):Promise<string>{try{return await contractImportDigest(input as ImportDigestInput);}catch(error){throw contractFailure(error);}}
export async function checkoutStateHash(state:string):Promise<string>{try{return await contractCheckoutStateHash(state);}catch(error){throw contractFailure(error);}}
export class PayStore {
 constructor(readonly db:D1Database,readonly now:()=>number=Date.now){}
 private timestamp(){return new Date(this.now()).toISOString();}
 private predicate(scope:PayScope){validateScope(scope);return {sql:'company_id=?'+(scope.access==='self'?' AND user_id=?':''),args:scope.access==='self'?[scope.companyId,scope.subject]:[scope.companyId]};}
 private insert(row:OrderRow,replay=false){return this.db.prepare('INSERT INTO payment_orders('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')'+(replay?' ON CONFLICT(company_id,idempotency_key) DO NOTHING':'')).bind(...columns.map(k=>row[k]));}
 private async snapshots(scope:PayScope,c:ConnectionSnapshot,l:LedgerSnapshot,f:Fingerprints){
  validateSnapshots(scope,c,l);const provider=fingerprint(f.provider),ledger=fingerprint(f.ledger);
  for(const value of [{id:c.credentialSetId,purpose:'payment',fingerprint:provider},{id:l.credentialSetId,purpose:'ledger',fingerprint:ledger}]){
   await this.db.prepare('INSERT INTO credential_material(credential_set_id,company_id,purpose,fingerprint) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').bind(value.id,scope.companyId,value.purpose,value.fingerprint).run();
   const saved=await this.db.prepare('SELECT company_id,purpose,fingerprint FROM credential_material WHERE credential_set_id=?').bind(value.id).first<{company_id:string;purpose:string;fingerprint:string}>();
   if(!saved||saved.company_id!==scope.companyId||saved.purpose!==value.purpose||saved.fingerprint!==value.fingerprint)throw conflict();
  }
  for(const value of [{kind:'payment',id:c.id,revision:c.revision,snapshot:c,fingerprint:provider},{kind:'ledger',id:l.integrationId,revision:l.revision,snapshot:l,fingerprint:ledger}]){
   const serialized=canonical(value.snapshot);
   await this.db.prepare('INSERT INTO integration_versions(kind,integration_id,revision,company_id,snapshot_json,fingerprint) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(value.kind,value.id,value.revision,scope.companyId,serialized,value.fingerprint).run();
   const saved=await this.db.prepare('SELECT company_id,snapshot_json,fingerprint FROM integration_versions WHERE kind=? AND integration_id=? AND revision=?').bind(value.kind,value.id,value.revision).first<{company_id:string;snapshot_json:string;fingerprint:string}>();
   if(!saved||saved.company_id!==scope.companyId||saved.snapshot_json!==serialized||saved.fingerprint!==value.fingerprint)throw conflict();
  }
  return {provider,ledger};
 }
 async findByOperation(scope:PayScope,key:string,supply:number):Promise<StoredOrder|null>{
  validateScope(scope);operation(key);calculateRecharge(supply);
  const row=await this.db.prepare('SELECT * FROM payment_orders WHERE company_id=? AND idempotency_key=?').bind(scope.companyId,key).first<OrderRow>();
  if(!row)return null;if(row.user_id!==scope.subject||row.supply_krw!==supply)throw conflict();return hydrate(row);
 }
 async create(scope:PayScope,key:string,supply:number,c:ConnectionSnapshot,l:LedgerSnapshot,f:Fingerprints):Promise<StoredOrder>{
  validateScope(scope);operation(key);const amounts=calculateRecharge(supply);validateSnapshots(scope,c,l);
  const prior=await this.findByOperation(scope,key,supply);
  if(prior){if(prior.connection_json!==canonical(c)||prior.ledger_json!==canonical(l)||prior.provider_fingerprint!==f.provider||prior.ledger_fingerprint!==f.ledger)throw conflict();return prior;}
  const fingerprints=await this.snapshots(scope,c,l,f),id=crypto.randomUUID(),now=this.timestamp();
  const row:OrderRow={id,company_id:scope.companyId,user_id:scope.subject,provider_order_id:'test_'+id,idempotency_key:key,environment:'test',purpose:'messaging_recharge',provider:'toss',supply_krw:amounts.supplyKrw,vat_krw:amounts.vatKrw,total_krw:amounts.totalKrw,currency:'KRW',state:'created',payment_key:null,refund_reason:null,provider_refund_id:null,connection_json:canonical(c),ledger_json:canonical(l),provider_fingerprint:fingerprints.provider,ledger_fingerprint:fingerprints.ledger,origin:'native',legacy_mode:null,provenance_json:null,revision:1,created_at:now,updated_at:now};
  try{await this.insert(row,true).run();}catch(error){unique(error);}
  const saved=await this.findByOperation(scope,key,supply);if(!saved||saved.connection_json!==row.connection_json||saved.ledger_json!==row.ledger_json||saved.provider_fingerprint!==row.provider_fingerprint||saved.ledger_fingerprint!==row.ledger_fingerprint)throw conflict();return saved;
 }
 async load(scope:PayScope,id:string):Promise<StoredOrder>{
  text(id);const p=this.predicate(scope),row=await this.db.prepare('SELECT * FROM payment_orders WHERE id=? AND '+p.sql).bind(id,...p.args).first<OrderRow>();
  if(!row)throw missing();return hydrate(row);
 }
 async list(scope:PayScope,cursor?:string):Promise<OrderPage>{
  const p=this.predicate(scope);let suffix='',args:(string|number)[]=[...p.args];
  if(cursor!==undefined){if(typeof cursor!=='string'||cursor.length>ORDER_CURSOR_MAX_LENGTH)throw invalid();const v=object(decode(cursor));exactKeys(v,['companyId','subject','access','createdAt','id']);if(v.companyId!==scope.companyId||v.subject!==(scope.access==='self'?scope.subject:'*')||v.access!==scope.access)throw invalid();const createdAt=utc(v.createdAt),id=text(v.id);suffix=' AND (created_at<? OR (created_at=? AND id<?))';args.push(createdAt,createdAt,id);}
  const result=await this.db.prepare('SELECT * FROM payment_orders WHERE '+p.sql+suffix+' ORDER BY created_at DESC,id DESC LIMIT '+(ORDER_PAGE_MAX_ITEMS+1)).bind(...args).all<OrderRow>();
  const rows=result.results.slice(0,ORDER_PAGE_MAX_ITEMS),last=rows.at(-1);
  return {items:rows.map(publicOrder),nextCursor:result.results.length>ORDER_PAGE_MAX_ITEMS&&last?encode({companyId:scope.companyId,subject:scope.access==='self'?scope.subject:'*',access:scope.access,createdAt:last.created_at,id:last.id}):null};
 }
 async bindPayment(scope:PayScope,id:string,key:string):Promise<StoredOrder>{
  text(key);const row=await this.load(scope,id);if(row.payment_key&&row.payment_key!==key)throw conflict();
  const p=this.predicate(scope);
  try{await this.db.prepare('UPDATE payment_orders SET payment_key=? WHERE id=? AND '+p.sql+' AND (payment_key IS NULL OR payment_key=?)').bind(key,id,...p.args,key).run();}catch(error){unique(error);}
  const saved=await this.load(scope,id);if(saved.payment_key!==key)throw conflict();return saved;
 }
 async bindRefundReceipt(scope:PayScope,id:string,providerRefundId:string):Promise<StoredOrder>{
  text(providerRefundId,64);const row=await this.load(scope,id);
  if(!['refund_pending','refund_unknown'].includes(row.state)||(row.provider_refund_id&&row.provider_refund_id!==providerRefundId))throw conflict();
  const p=this.predicate(scope);
  await this.db.prepare('UPDATE payment_orders SET provider_refund_id=?,revision=revision+1,updated_at=? WHERE id=? AND '+p.sql+' AND provider_refund_id IS NULL').bind(providerRefundId,this.timestamp(),id,...p.args).run();
  const saved=await this.load(scope,id);if(saved.provider_refund_id!==providerRefundId)throw conflict();return saved;
 }
 async transition(id:string,next:PaymentState,from:PaymentState[]):Promise<boolean>{
  if(!PAYMENT_STATES.includes(next)||!from.length||from.some(s=>!PAYMENT_STATES.includes(s)))throw invalid();
  const result=await this.db.prepare('UPDATE payment_orders SET state=?,revision=revision+1,updated_at=? WHERE id=? AND state IN ('+from.map(()=>'?').join(',')+')').bind(next,this.timestamp(),id,...from).run();return result.meta.changes===1;
 }
 async claimRefund(scope:PayScope,id:string,reason:string):Promise<boolean>{
  text(reason);const row=await this.load(scope,id);if(row.refund_reason&&row.refund_reason!==reason)throw conflict();if(row.state==='refunded')return false;
  const p=this.predicate(scope),result=await this.db.prepare("UPDATE payment_orders SET state='refund_pending',refund_reason=?,revision=revision+1,updated_at=? WHERE id=? AND "+p.sql+" AND state='credited' AND (refund_reason IS NULL OR refund_reason=?)").bind(reason,this.timestamp(),id,...p.args,reason).run();
  if(result.meta.changes===1)return true;const saved=await this.load(scope,id);if(saved.refund_reason!==reason||!['refund_pending','refund_unknown','refunded'].includes(saved.state))throw conflict();return false;
 }
 private validateImport(scope:PayScope,input:ImportInput){
  validateScope(scope);if(scope.access!=='company')throw new PayError(403,'service_access_required','Administrative import access is required.');
  text(input.migrationId);text(input.generation);if(!/^[a-f0-9]{64}$/.test(input.digest))throw conflict();
  const o=object(input.order);exactKeys(o,['id','company_id','user_id','provider_order_id','idempotency_key','supply_krw','vat_krw','total_krw','currency','mode','state','payment_key','refund_reason','revision','created_at','updated_at','provenance'],['notify_workspace_id','provider_refund_id']);
  const amounts=calculateRecharge(o.supply_krw),provenance=object(o.provenance);exactKeys(provenance,['source','table','quiescentMarker']);
  if(o.company_id!==scope.companyId)throw invalid();
  if(o.mode!=='sandbox'||provenance.source!=='admin'||provenance.table!=='messaging_test_payment_orders')throw invalid();
  if(provenance.quiescentMarker!==input.generation)throw conflict();
  if(o.currency!=='KRW'||o.vat_krw!==amounts.vatKrw||o.total_krw!==amounts.totalKrw||!PAYMENT_STATES.includes(o.state as PaymentState)||!Number.isSafeInteger(o.revision)||Number(o.revision)<1)throw invalid();
  for(const k of ['id','user_id','provider_order_id','idempotency_key'])text(o[k]);
  if(o.payment_key!==null)text(o.payment_key);if(o.refund_reason!==null)text(o.refund_reason);
  if(o.state!=='created'&&o.payment_key===null)throw invalid();if(String(o.state).startsWith('refund')&&o.refund_reason===null)throw invalid();
  if(o.provider_refund_id!==undefined&&o.provider_refund_id!==null){text(o.provider_refund_id,64);if(!['refund_pending','refund_unknown','refunded'].includes(String(o.state))||o.refund_reason===null||o.payment_key===null)throw invalid();}
  utc(o.created_at);utc(o.updated_at);if(String(o.updated_at)<String(o.created_at))throw invalid();
  validateSnapshots(scope,input.connection,input.ledger);if(o.notify_workspace_id!==input.ledger.workspaceId)throw conflict();
 }
 async importReplay(scope:PayScope,input:ImportInput):Promise<ImportReceipt|null>{
  this.validateImport(scope,input);
  const {migrationId,generation,order,connection,ledger}=input;
  if(await importDigest({migrationId,generation,order,connection,ledger})!==input.digest)throw conflict();
  const prior=await this.db.prepare('SELECT * FROM payment_imports WHERE order_id=?').bind(order.id).first<ImportRow>();
  if(prior){await this.load(scope,order.id);if(prior.migration_id!==migrationId||prior.generation!==generation||prior.digest!==input.digest)throw conflict();return receipt(prior);}
  if(await this.db.prepare('SELECT id FROM payment_orders WHERE id=?').bind(order.id).first())throw conflict();return null;
 }
 async importLegacy(scope:PayScope,input:ImportInput,f:Fingerprints):Promise<ImportReceipt>{
  const prior=await this.importReplay(scope,input);if(prior)return prior;
  const {migrationId,generation,order:o,connection:c,ledger:l}=input;
  const fp=await this.snapshots(scope,c,l,f),now=this.timestamp();
  const row:OrderRow={id:o.id,company_id:o.company_id,user_id:o.user_id,provider_order_id:o.provider_order_id,idempotency_key:o.idempotency_key,environment:'test',purpose:'messaging_recharge',provider:'toss',supply_krw:o.supply_krw,vat_krw:o.vat_krw,total_krw:o.total_krw,currency:'KRW',state:o.state,payment_key:o.payment_key,refund_reason:o.refund_reason,provider_refund_id:o.provider_refund_id??null,connection_json:canonical(c),ledger_json:canonical(l),provider_fingerprint:fp.provider,ledger_fingerprint:fp.ledger,origin:'legacy',legacy_mode:'sandbox',provenance_json:canonical(o.provenance),revision:o.revision,created_at:o.created_at,updated_at:o.updated_at};
  try{await this.db.batch([this.insert(row),this.db.prepare("INSERT INTO payment_imports(order_id,migration_id,generation,digest,source_json,status,created_at,updated_at) VALUES(?,?,?,?,?,'staged',?,?)").bind(o.id,migrationId,generation,input.digest,canonical({migrationId,generation,order:o,connection:c,ledger:l}),now,now)]);}catch(error){
   const raced=await this.db.prepare('SELECT * FROM payment_imports WHERE order_id=?').bind(o.id).first<ImportRow>();
   if(raced&&raced.migration_id===migrationId&&raced.generation===generation&&raced.digest===input.digest)return receipt(raced);unique(error);
  }
  return this.importStatus(scope,o.id,{migrationId,generation,digest:input.digest});
 }
 private fence(value:OwnershipFence){const v=object(value);exactKeys(v,['migrationId','generation','digest']);text(v.migrationId);text(v.generation);if(typeof v.digest!=='string'||!/^[a-f0-9]{64}$/.test(v.digest))throw conflict();}
 async importStatus(scope:PayScope,id:string,ownership:OwnershipFence):Promise<ImportReceipt>{
  await this.load(scope,id);this.fence(ownership);const row=await this.db.prepare('SELECT * FROM payment_imports WHERE order_id=?').bind(id).first<ImportRow>();
  if(!row||row.migration_id!==ownership.migrationId||row.generation!==ownership.generation||row.digest!==ownership.digest)throw conflict();return receipt(row);
 }
 async activateImport(scope:PayScope,id:string,ownership:OwnershipFence,proof:SourceCommittedProof):Promise<ImportReceipt>{
  if(scope.access!=='company')throw new PayError(403,'service_access_required','Administrative import access is required.');
  const p=object(proof);exactKeys(p,['sourceWriter','generation','digest']);if(p.sourceWriter!=='pay'||p.generation!==ownership.generation||p.digest!==ownership.digest)throw conflict();
  const prior=await this.importStatus(scope,id,ownership);if(prior.state==='aborted')throw conflict();
  await this.db.prepare("UPDATE payment_imports SET status='active',updated_at=? WHERE order_id=? AND generation=? AND digest=? AND status='staged'").bind(this.timestamp(),id,ownership.generation,ownership.digest).run();
  const saved=await this.importStatus(scope,id,ownership);if(saved.state!=='active')throw conflict();return saved;
 }
 async abortImport(scope:PayScope,id:string,ownership:OwnershipFence):Promise<ImportReceipt>{
  if(scope.access!=='company')throw new PayError(403,'service_access_required','Administrative import access is required.');
  const prior=await this.importStatus(scope,id,ownership);if(prior.state==='active')throw conflict();
  await this.db.prepare("UPDATE payment_imports SET status='aborted',updated_at=? WHERE order_id=? AND generation=? AND digest=? AND status='staged'").bind(this.timestamp(),id,ownership.generation,ownership.digest).run();
  const saved=await this.importStatus(scope,id,ownership);if(saved.state!=='aborted')throw conflict();return saved;
 }
 async assertWritable(row:StoredOrder,ownership?:OwnershipFence):Promise<void>{
  if(row.origin==='native')return;if(!ownership)throw conflict();
  const status=await this.importStatus({companyId:row.company_id,subject:row.user_id,access:'self'},row.id,ownership);if(status.state!=='active')throw conflict();
 }
 async issueCheckout(scope:PayScope,id:string,returnTarget:'contract'|'admin',ownership?:OwnershipFence):Promise<{state:string;expiresAt:string}>{
  if(returnTarget!=='contract'&&returnTarget!=='admin')throw invalid();
  const row=await this.load(scope,id);await this.assertWritable(row,ownership);if(row.state!=='created'||row.payment_key)throw conflict();
  const bytes=crypto.getRandomValues(new Uint8Array(32)),state=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const hash=await checkoutStateHash(state),expiresAt=new Date(this.now()+600000).toISOString();
  const created=await this.db.prepare("INSERT INTO checkout_nonces(state_hash,order_id,company_id,subject,scope_access,provider_order_id,total_krw,return_target,ownership_json,expires_at,created_at,result) SELECT ?,?,?,?,?,?,?,?,?,?,?,'pending' WHERE EXISTS(SELECT 1 FROM payment_orders WHERE id=? AND company_id=? AND state='created' AND payment_key IS NULL)").bind(hash,row.id,row.company_id,scope.subject,scope.access,row.provider_order_id,row.total_krw,returnTarget,ownership?canonical(ownership):null,expiresAt,this.timestamp(),row.id,row.company_id).run();
  if(created.meta.changes!==1)throw conflict();return {state,expiresAt};
 }
 private captureResult(row:NonceRow):CheckoutCaptureResult{return {returnTarget:row.return_target,companyId:row.company_id,id:row.order_id,result:row.result==='pending'?'unknown':row.result};}
 async checkoutStatus(stateHash:string):Promise<CheckoutCaptureResult>{
  if(typeof stateHash!=='string'||!CHECKOUT_STATE_HASH_PATTERN.test(stateHash))throw invalid();
  const row=await this.db.prepare('SELECT * FROM checkout_nonces WHERE state_hash=?').bind(stateHash).first<NonceRow>();if(!row)throw missing();if(row.result==='pending'&&this.now()>=Date.parse(row.expires_at))throw conflict();return this.captureResult(row);
 }
 async captureCheckout(callback:CheckoutCallback):Promise<CheckoutCaptureResult>{
  const c=object(callback);if(c.outcome==='success')exactKeys(c,['outcome','state','paymentKey','orderId','amount']);else if(c.outcome==='fail')exactKeys(c,['outcome','state'],['code','orderId']);else throw invalid();
  const hash=await checkoutStateHash(c.state as string),row=await this.db.prepare('SELECT * FROM checkout_nonces WHERE state_hash=?').bind(hash).first<NonceRow>();if(!row)throw missing();
  if(c.outcome==='success'){text(c.paymentKey);text(c.orderId);if(!Number.isSafeInteger(c.amount)||Number(c.amount)<=0)throw invalid();if(c.orderId!==row.provider_order_id||c.amount!==row.total_krw)throw conflict();}
  if(c.outcome==='fail'&&c.orderId!==undefined){text(c.orderId);if(c.orderId!==row.provider_order_id)throw conflict();}
  if(c.code!==undefined)text(c.code,200);
  const digest=await sha256(canonical(c.outcome==='success'?{outcome:'success',paymentKey:c.paymentKey,orderId:c.orderId,amount:c.amount}:{outcome:'fail',...(c.orderId!==undefined?{orderId:c.orderId}:{}),...(c.code!==undefined?{code:c.code}:{})}));
  if(row.result!=='pending'){if(row.callback_digest!==digest)throw conflict();return this.captureResult(row);}
  if(this.now()>=Date.parse(row.expires_at))throw conflict();
  const scope:PayScope={subject:row.subject,companyId:row.company_id,access:row.scope_access},order=await this.load(scope,row.order_id);
  await this.assertWritable(order,row.ownership_json?JSON.parse(row.ownership_json) as OwnershipFence:undefined);
  if(order.provider_order_id!==row.provider_order_id||order.total_krw!==row.total_krw)throw conflict();
  const now=this.timestamp();
  const outcome=c.outcome==='success'?'captured':'failed',statements:D1PreparedStatement[]=[];
  if(c.outcome==='success'){
   if(order.payment_key&&order.payment_key!==c.paymentKey)throw conflict();
   statements.push(
    this.db.prepare("UPDATE payment_orders SET payment_key=? WHERE id=? AND company_id=? AND (payment_key IS NULL OR payment_key=?) AND EXISTS(SELECT 1 FROM checkout_nonces WHERE state_hash=? AND result='pending' AND expires_at>?)").bind(c.paymentKey,row.order_id,row.company_id,c.paymentKey,hash,now),
    this.db.prepare("UPDATE checkout_nonces SET result='captured',callback_digest=?,consumed_at=? WHERE state_hash=? AND result='pending' AND expires_at>? AND EXISTS(SELECT 1 FROM payment_orders WHERE id=? AND company_id=? AND payment_key=?)").bind(digest,now,hash,now,row.order_id,row.company_id,c.paymentKey)
   );
  }else statements.push(this.db.prepare("UPDATE checkout_nonces SET result='failed',callback_digest=?,consumed_at=? WHERE state_hash=? AND result='pending' AND expires_at>?").bind(digest,now,hash,now));
  // A zero-row UPDATE is successful SQL. The final CHECK deliberately converts
  // any missed prerequisite into a SQL error, rolling back this entire D1 batch.
  statements.push(this.db.prepare("INSERT INTO checkout_capture_receipts(state_hash,callback_digest,outcome,committed_at,receipt_guard) VALUES(?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM checkout_nonces WHERE state_hash=? AND callback_digest=? AND result=? AND consumed_at=?) AND (?='failed' OR EXISTS(SELECT 1 FROM payment_orders WHERE id=? AND company_id=? AND payment_key=?)) THEN 1 ELSE 0 END)").bind(hash,digest,outcome,now,hash,digest,outcome,now,outcome,row.order_id,row.company_id,c.outcome==='success'?c.paymentKey:null));
  try{await this.db.batch(statements);}catch(error){
   const committed=await this.db.prepare('SELECT * FROM checkout_nonces WHERE state_hash=?').bind(hash).first<NonceRow>();
   if(committed&&committed.result!=='pending'&&committed.callback_digest===digest)return this.captureResult(committed);
   if(error instanceof Error&&/constraint|immutable|consumed/i.test(error.message))throw conflict();throw error;
  }
  const saved=await this.db.prepare('SELECT * FROM checkout_nonces WHERE state_hash=?').bind(hash).first<NonceRow>();if(!saved||saved.result==='pending'||saved.callback_digest!==digest)throw conflict();return this.captureResult(saved);
 }
}
