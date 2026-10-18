import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import {URL as NodeURL} from 'node:url';
import {PayStore,importDigest} from '../src/store';
import type {PayScope,ConnectionSnapshot,LedgerSnapshot,LegacyPaymentOrder,OwnershipFence,PayCommand} from '@devslab-kr/pay-contract';
import type {StoredOrder} from '../src/store';
import type {GatewayPayment,LedgerReceipt} from '../src/domain';
import type {PaymentAdapters,PaymentGateway,PaymentLedger} from '../src/adapters';
import {registerConnection,vaultEnv} from './connection-fixture';
function boundaries(value:{gateway?:Partial<PaymentGateway>;ledger?:Partial<PaymentLedger>}):PaymentAdapters {
 const unexpected=async():Promise<never>=>{throw Error('Unexpected scripted boundary');};
 return {beforeEffect:()=>{},gateway:{confirm:unexpected,lookup:unexpected,cancel:unexpected,...value.gateway},ledger:{getCredit:unexpected,credit:unexpected,getRefund:unexpected,reserveRefund:unexpected,finalizeRefund:unexpected,wallet:unexpected,...value.ledger}};
}

const self:PayScope={subject:'alice',companyId:'company-a',access:'self'};
const owner:PayScope={subject:'global-owner',companyId:'company-a',access:'company'};
const connection:ConnectionSnapshot={id:'p-a',companyId:'company-a',revision:'1',provider:'toss',environment:'test',providerAccountId:'merchant-a',credentialSetId:'toss-general-test-v1'};
const ledger:LedgerSnapshot={environment:'test',kind:'notify-test-wallet',transport:'https-fixed-notify',provider:'notify',companyId:'company-a',workspaceId:'workspace-a',integrationId:'n-a',revision:'1',credentialSetId:'notify-test-ledger-v1'};
const fingerprints={provider:'a'.repeat(64),ledger:'b'.repeat(64)};
let mf:Miniflare,store:PayStore,db:D1Database;
beforeAll(async()=>{mf=new Miniflare({...convertV4MiniflareOptions({cf:false,workers:[{name:'pay-tests',modules:true,script:"export default {fetch(){return new Response('not found',{status:404})}}",compatibilityDate:'2026-10-13',d1Databases:{DB:'pay-test-db'},outboundService:async()=>new Response('blocked',{status:503})}]}),telemetry:{enabled:false}});db=await mf.getD1Database('DB','pay-tests');for(const file of (await readdir(new NodeURL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){const sql=await readFile(new NodeURL('../migrations/'+file,import.meta.url),'utf8');await db.batch(sql.split('-- statement').filter(s=>s.trim()).map(s=>db.prepare(s)));}store=new PayStore(db);});
afterAll(async()=>{await mf?.dispose();});
async function created(...args:Parameters<PayStore['create']>){const row=await store.create(...args);expect(row,'persisted order must have a durable identity').toMatchObject({id:expect.any(String)});return row;}
async function imported(...args:Parameters<PayStore['importLegacy']>){const receipt=await store.importLegacy(...args);expect(receipt,'import must return a durable staged receipt').toMatchObject({orderId:expect.any(String)});return receipt;}
describe('real local D1 orders (one migration setup)',()=>{
 it('persists company-operation replay, rejects changed actor/amount/snapshot and hides private fields',async()=>{const first=await created(self,'replay:1',1000,connection,ledger,fingerprints);expect(first).toMatchObject({company_id:'company-a',user_id:'alice',supply_krw:1000,vat_krw:100,total_krw:1100,state:'created'});expect((await created(self,'replay:1',1000,connection,ledger,fingerprints)).id).toBe(first.id);await expect(store.create({...self,subject:'bob'},'replay:1',1000,connection,ledger,fingerprints)).rejects.toMatchObject({status:409});await expect(store.create(self,'replay:1',2000,connection,ledger,fingerprints)).rejects.toMatchObject({status:409});await expect(store.create(self,'replay:1',1000,{...connection,revision:'2'},ledger,fingerprints)).rejects.toMatchObject({status:409});});
 it('enforces company and initiating-user predicates on detail and history',async()=>{const a=await created(self,'scope:alice',1000,connection,ledger,fingerprints);await created({...self,subject:'bob'},'scope:bob',1000,connection,ledger,fingerprints);await expect(store.load({...self,subject:'bob'},a.id)).rejects.toMatchObject({status:404});await expect(store.load({...owner,companyId:'company-b'},a.id)).rejects.toMatchObject({status:404});expect((await store.load(owner,a.id)).id).toBe(a.id);const page=await store.list(self);expect(page.items.some((x:any)=>x.operationId==='scope:bob')).toBe(false);expect(JSON.stringify(page)).not.toContain('credentialSetId');expect(JSON.stringify(page)).not.toContain('payment_key');expect((await store.list(owner)).items.some((x:any)=>x.operationId==='scope:bob')).toBe(true);});
 it('claims confirming once and preserves one unique private payment key',async()=>{const a=await created(self,'cas:a',1000,connection,ledger,fingerprints),b=await created(self,'cas:b',1000,connection,ledger,fingerprints);await store.bindPayment(self,a.id,'payment-private-a');const claims=await Promise.all([store.transition(a.id,'confirming',['created']),store.transition(a.id,'confirming',['created'])]);expect(claims.filter(Boolean)).toHaveLength(1);await expect(store.bindPayment(self,a.id,'different')).rejects.toMatchObject({status:409});await expect(store.bindPayment(self,b.id,'payment-private-a')).rejects.toMatchObject({status:409});});
 it('enforces schema money and immutable snapshots even for direct SQL writes',async()=>{const a=await created(self,'schema:a',1000,connection,ledger,fingerprints);await expect(db.prepare("INSERT INTO payment_orders(id,company_id,user_id,provider_order_id,idempotency_key,supply_krw,vat_krw,total_krw,connection_json,ledger_json,provider_fingerprint,ledger_fingerprint,created_at,updated_at) SELECT id||'-invalid',company_id,user_id,provider_order_id||'-invalid',idempotency_key||'-invalid',supply_krw,vat_krw,1101,connection_json,ledger_json,provider_fingerprint,ledger_fingerprint,created_at,updated_at FROM payment_orders WHERE id=?").bind(a.id).run()).rejects.toThrow();await expect(db.prepare("UPDATE payment_orders SET connection_json='{}' WHERE id=?").bind(a.id).run()).rejects.toThrow();await expect(db.prepare('UPDATE payment_orders SET user_id=? WHERE id=?').bind('intruder',a.id).run()).rejects.toThrow();});
 it('uses scoped bounded keyset pagination and rejects foreign cursors',async()=>{for(let i=0;i<52;i++)await created({...self,companyId:'page-a'},'page:'+i,1000,{...connection,id:'p-page',companyId:'page-a',credentialSetId:'toss-page'},{...ledger,integrationId:'n-page',companyId:'page-a',credentialSetId:'notify-page'},fingerprints);const scope={...self,companyId:'page-a'};const first=await store.list(scope);expect(first.items).toHaveLength(50);expect(first.nextCursor).toEqual(expect.any(String));const last=await store.list(scope,first.nextCursor!);expect(last.items).toHaveLength(2);expect(last.nextCursor).toBeNull();await expect(store.list(self,first.nextCursor!)).rejects.toMatchObject({status:400});await expect(store.list(self,'x'.repeat(2049))).rejects.toMatchObject({status:400});});
 it('persists refund reason with hold intent and rejects changed replay',async()=>{const a=await created(self,'refund:claim',1000,connection,ledger,fingerprints);await store.transition(a.id,'credited',['created']);expect(await store.claimRefund(self,a.id,'Original')).toBe(true);expect(await store.claimRefund(self,a.id,'Original')).toBe(false);await expect(store.claimRefund(self,a.id,'Changed')).rejects.toMatchObject({status:409});expect(await store.load(self,a.id)).toMatchObject({state:'refund_pending',refund_reason:'Original'});});
});
describe('fenced immutable legacy import',()=>{
 const source=(id:string,state:LegacyPaymentOrder['state']='provider_unknown'):LegacyPaymentOrder=>({id,company_id:'company-a',user_id:'alice',provider_order_id:'test_'+id,idempotency_key:'legacy:'+id,supply_krw:1000,vat_krw:100,total_krw:1100,currency:'KRW',mode:'sandbox',state,payment_key:'private-'+id,refund_reason:null,notify_workspace_id:'workspace-a',revision:7,created_at:'2026-09-01T01:02:03.000Z',updated_at:'2026-09-03T04:05:06.000Z',provenance:{source:'admin',table:'messaging_test_payment_orders',quiescentMarker:'generation-1'}});
 const input=async(id:string,state?:LegacyPaymentOrder['state'])=>{const value={migrationId:'migration-'+id,generation:'generation-1',order:source(id,state),connection,ledger};return {...value,digest:await importDigest(value)};};
 it('uses canonical SHA256 and preserves exact source values and private key without exposing them',async()=>{expect(await importDigest({b:2,a:1})).toBe('43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777');const value=await input('legacy-a');const receipt=await imported(owner,value,fingerprints);expect(receipt).toMatchObject({migrationId:value.migrationId,orderId:'legacy-a',digest:value.digest,generation:'generation-1',state:'staged'});const row=await store.load(self,'legacy-a');expect(row).toMatchObject({id:'legacy-a',user_id:'alice',provider_order_id:'test_legacy-a',payment_key:'private-legacy-a',revision:7,state:'provider_unknown',created_at:'2026-09-01T01:02:03.000Z',updated_at:'2026-09-03T04:05:06.000Z'});expect(JSON.stringify(await store.list(owner))).not.toContain('private-legacy-a');expect(await imported(owner,value,fingerprints)).toEqual(receipt);await expect(store.importLegacy(owner,{...value,order:{...value.order,state:'credited'}},fingerprints)).rejects.toMatchObject({status:409});});
 it('blocks staged effects, requires source commit proof, and never aborts active imports',async()=>{const value=await input('legacy-active');await imported(owner,value,fingerprints);const ownership:OwnershipFence={migrationId:value.migrationId,generation:value.generation,digest:value.digest};const row=await store.load(self,'legacy-active');await expect(store.assertWritable(row,ownership)).rejects.toMatchObject({status:409});await expect(store.activateImport(owner,row.id,ownership,{sourceWriter:'admin' as any,generation:value.generation,digest:value.digest})).rejects.toMatchObject({status:409});expect(await store.activateImport(owner,row.id,ownership,{sourceWriter:'pay',generation:value.generation,digest:value.digest})).toMatchObject({state:'active'});await expect(store.assertWritable(row)).rejects.toMatchObject({status:409});await expect(store.assertWritable(row,{...ownership,generation:'stale'})).rejects.toMatchObject({status:409});await expect(store.assertWritable(row,ownership)).resolves.toBeUndefined();await expect(store.abortImport(owner,row.id,ownership)).rejects.toMatchObject({status:409});});
 it('aborts only staged generation and refuses activation afterward',async()=>{const value=await input('legacy-abort');await imported(owner,value,fingerprints);const own={migrationId:value.migrationId,generation:value.generation,digest:value.digest};expect(await store.abortImport(owner,'legacy-abort',own)).toMatchObject({state:'aborted'});expect(await store.abortImport(owner,'legacy-abort',own)).toMatchObject({state:'aborted'});await expect(store.activateImport(owner,'legacy-abort',own,{sourceWriter:'pay',generation:own.generation,digest:own.digest})).rejects.toMatchObject({status:409});});
 it('preserves every legacy state and rejects unquiescent or foreign import',async()=>{for(const state of ['created','confirming','provider_unknown','credit_pending','credited','refund_pending','refund_unknown','refunded'] as const){const value=await input('state-'+state,state);if(state.startsWith('refund'))value.order.refund_reason='Original reason';value.digest=await importDigest({migrationId:value.migrationId,generation:value.generation,order:value.order,connection,ledger});await imported(owner,value,fingerprints);expect((await store.load(self,value.order.id)).state).toBe(state);}const bad=await input('bad-freeze');await expect(store.importLegacy(owner,{...bad,generation:'different'},fingerprints)).rejects.toMatchObject({status:409});await expect(store.importLegacy({...owner,companyId:'other'},bad,fingerprints)).rejects.toMatchObject({status:400});});
});

describe('private RPC over real local D1',()=>{
 it('denies malformed scope and keeps absent configuration unavailable',async()=>{const {PayApplication}=await import('../src/service');const app=new PayApplication({DB:db});expect(await app.dispatch({action:'capabilities',scope:self})).toMatchObject({ok:true,result:{companyId:'company-a',mode:'unavailable',capabilities:{read:true,checkout:false,refund:false}}});expect(await app.dispatch({action:'config',scope:self})).toMatchObject({ok:false,status:503});expect(await app.dispatch({action:'capabilities',scope:{...self,access:'owner'}} as any)).toMatchObject({ok:false,status:400});});
 it('returns existing same-intent order before resolving removed current keys and rejects actor changes',async()=>{const saved=await created(self,'rpc:replay',1000,connection,ledger,fingerprints);const {PayApplication}=await import('../src/service');const app=new PayApplication({DB:db});expect(await app.dispatch({action:'getOrderByOperation',scope:self,operationId:'rpc:replay',supplyKrw:1000})).toMatchObject({ok:true,result:{id:saved.id}});expect(await app.dispatch({action:'createOrder',scope:self,operationId:'rpc:replay',supplyKrw:1000,connection:{...connection,revision:'999'},ledger})).toMatchObject({ok:true,result:{id:saved.id}});expect(await app.dispatch({action:'getOrderByOperation',scope:{...self,subject:'bob'},operationId:'rpc:replay',supplyKrw:1000})).toMatchObject({ok:false,status:409});});
 it('rejects browser identity mismatch and missing stored payment identity before unavailable adapters',async()=>{const row=await created(self,'rpc:confirm',1000,connection,ledger,fingerprints);const {PayApplication}=await import('../src/service');const app=new PayApplication({DB:db});expect(await app.dispatch({action:'confirmOrder',scope:self,id:row.id,paymentKey:'private-key',orderId:'foreign',amount:1100})).toMatchObject({ok:false,status:409});expect(await app.dispatch({action:'reconcileOrder',scope:self,id:row.id})).toMatchObject({ok:false,status:409});expect((await store.load(self,row.id)).state).toBe('created');});
});

describe('durable state machine with failing scripted boundaries (not service integration)',()=>{
 it('keeps ambiguous approval recoverable and never fabricates wallet credit',async()=>{const row=await created(self,'flow:unknown',1000,connection,ledger,fingerprints);await store.bindPayment(self,row.id,'flow-private');const {confirmPayment}=await import('../src/payments');const loaded=await store.load(self,row.id);const result=await confirmPayment(store,self,loaded,boundaries({gateway:{confirm:async()=>{throw Error('private provider detail');},lookup:async()=>{throw Error('private provider detail');}},ledger:{getCredit:async()=>{throw Error('must not credit');}}}));expect(result.state).toBe('provider_unknown');expect((await store.load(self,row.id)).payment_key).toBe('flow-private');});
 it('retains durable credit_pending on ledger uncertainty',async()=>{const row=await created(self,'flow:credit',1000,connection,ledger,fingerprints);await store.bindPayment(self,row.id,'flow-credit-private');await store.transition(row.id,'credit_pending',['created']);const {confirmPayment}=await import('../src/payments');const result=await confirmPayment(store,self,await store.load(self,row.id),boundaries({gateway:{},ledger:{getCredit:async()=>{throw Error('lost ledger result');}}}));expect(result.state).toBe('credit_pending');});
 it('holds principal before cancel and preserves refund_unknown on ambiguous cancel',async()=>{const row=await created(self,'flow:refund',1000,connection,ledger,fingerprints);await store.bindPayment(self,row.id,'flow-refund-private');await store.transition(row.id,'credited',['created']);let held=false,cancelObservedHold=false;const {refundPayment}=await import('../src/payments');const result=await refundPayment(store,self,await store.load(self,row.id),'Original reason',boundaries({gateway:{cancel:async()=>{cancelObservedHold=held;throw Error('cancel timed out');}},ledger:{reserveRefund:async()=>{held=true;return {companyId:'company-a',operationId:'refund:'+row.id,supplyKrw:1000,state:'reserved'};}}}));expect(result).toMatchObject({state:'refund_unknown',refund_reason:'Original reason'});expect(held).toBe(true);expect(cancelObservedHold).toBe(true);});
});







describe('real D1 checkout callback journal (no provider or ledger calls)',()=>{
 async function nonce(localStore:PayStore,id:string){const value=await localStore.issueCheckout(self,id,'contract');expect(value).toMatchObject({state:expect.any(String),expiresAt:expect.any(String)});return value;}
 it('stores only a 256bit state hash and captures one matching key without changing financial state',async()=>{const row=await created(self,'checkout:capture',1000,connection,ledger,fingerprints),issued=await nonce(store,row.id);expect(issued.state).toMatch(/^[A-Za-z0-9_-]{43}$/);const saved=await db.prepare('SELECT * FROM checkout_nonces WHERE order_id=?').bind(row.id).first<any>();expect(JSON.stringify(saved)).not.toContain(issued.state);expect(saved.state_hash).toMatch(/^[a-f0-9]{64}$/);const result=await store.captureCheckout({outcome:'success',state:issued.state,paymentKey:'callback-private-key',orderId:row.provider_order_id,amount:1100});expect(result).toEqual({returnTarget:'contract',returnTo:{service:'contract',path:'/notify'},companyId:'company-a',id:row.id,result:'captured'});const captured=await store.load(self,row.id);expect(captured).toMatchObject({state:'created',revision:1,payment_key:'callback-private-key',updated_at:row.updated_at});expect(JSON.stringify(result)).not.toContain('callback-private-key');expect(await store.captureCheckout({outcome:'success',state:issued.state,paymentKey:'callback-private-key',orderId:row.provider_order_id,amount:1100})).toEqual(result);await expect(store.captureCheckout({outcome:'success',state:issued.state,paymentKey:'second-private-key',orderId:row.provider_order_id,amount:1100})).rejects.toMatchObject({status:409});expect((await store.load(self,row.id)).payment_key).toBe('callback-private-key');});
 it('rejects expired, tampered, wrong-order or wrong-amount state before any private key change',async()=>{let now=Date.parse('2026-10-15T00:00:00.000Z');const clockStore=new PayStore(db,()=>now),row=await created(self,'checkout:expiry',1000,connection,ledger,fingerprints),issued=await nonce(clockStore,row.id);const callback={outcome:'success' as const,state:issued.state,paymentKey:'expiry-private',orderId:row.provider_order_id,amount:1100};await expect(clockStore.captureCheckout({...callback,state:'a'.repeat(43)})).rejects.toMatchObject({status:404});await expect(clockStore.captureCheckout({...callback,orderId:'foreign'})).rejects.toMatchObject({status:409});await expect(clockStore.captureCheckout({...callback,amount:1000})).rejects.toMatchObject({status:409});now+=600001;await expect(clockStore.captureCheckout(callback)).rejects.toMatchObject({status:409});expect(await store.load(self,row.id)).toMatchObject({payment_key:null,state:'created',revision:1});});
 it('consumes failure only once, discards provider details and reports pending as unknown',async()=>{const row=await created(self,'checkout:failed',1000,connection,ledger,fingerprints),issued=await nonce(store,row.id);const {checkoutStateHash}=await import('../src/store');expect(await store.checkoutStatus(await checkoutStateHash(issued.state))).toEqual({returnTarget:'contract',returnTo:{service:'contract',path:'/notify'},companyId:'company-a',id:row.id,result:'unknown'});const failed=await store.captureCheckout({outcome:'fail',state:issued.state,code:'PRIVATE_PROVIDER_DETAIL'});expect(failed).toEqual({returnTarget:'contract',returnTo:{service:'contract',path:'/notify'},companyId:'company-a',id:row.id,result:'failed'});expect(JSON.stringify(failed)).not.toContain('PRIVATE_PROVIDER_DETAIL');expect(await store.load(self,row.id)).toMatchObject({payment_key:null,state:'created'});await expect(store.captureCheckout({outcome:'success',state:issued.state,paymentKey:'never-saved',orderId:row.provider_order_id,amount:1100})).rejects.toMatchObject({status:409});});
});


describe('real D1 callback concurrency and rollback guards',()=>{
 it('rolls back all writes when first-key CAS misses for a different nonce',async()=>{const row=await created(self,'checkout:race-keys',1000,connection,ledger,fingerprints);const first=await store.issueCheckout(self,row.id,'contract'),second=await store.issueCheckout(self,row.id,'contract');const make=(state:string,key:string)=>({outcome:'success' as const,state,paymentKey:key,orderId:row.provider_order_id,amount:1100});const results=await Promise.allSettled([store.captureCheckout(make(first.state,'race-key-a')),store.captureCheckout(make(second.state,'race-key-b'))]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);const nonces=await db.prepare('SELECT result FROM checkout_nonces WHERE order_id=?').bind(row.id).all<{result:string}>();expect(nonces.results.map(n=>n.result).sort()).toEqual(['captured','pending']);const receipts=await db.prepare('SELECT COUNT(*) AS count FROM checkout_capture_receipts WHERE state_hash IN (SELECT state_hash FROM checkout_nonces WHERE order_id=?)').bind(row.id).first<number>('count');expect(receipts).toBe(1);expect(await store.load(self,row.id)).toMatchObject({state:'created',revision:1});});
 it('commits only one immutable outcome under a success/fail race',async()=>{const row=await created(self,'checkout:race-outcome',1000,connection,ledger,fingerprints),issued=await store.issueCheckout(self,row.id,'contract');const results=await Promise.allSettled([store.captureCheckout({outcome:'success',state:issued.state,paymentKey:'outcome-private',orderId:row.provider_order_id,amount:1100}),store.captureCheckout({outcome:'fail',state:issued.state})]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);const nonce=await db.prepare('SELECT result FROM checkout_nonces WHERE order_id=?').bind(row.id).first<{result:string}>(),saved=await store.load(self,row.id);expect(saved.state).toBe('created');expect(saved.payment_key).toBe(nonce?.result==='captured'?'outcome-private':null);});
 it('replays committed capture and hash status after TTL while refusing a fresh checkout',async()=>{let now=Date.parse('2026-10-15T00:00:00.000Z');const clockStore=new PayStore(db,()=>now),row=await created(self,'checkout:committed-expiry',1000,connection,ledger,fingerprints),issued=await clockStore.issueCheckout(self,row.id,'admin');const callback={outcome:'success' as const,state:issued.state,paymentKey:'retained-private',orderId:row.provider_order_id,amount:1100};const captured=await clockStore.captureCheckout(callback);now+=700000;expect(await clockStore.captureCheckout(callback)).toEqual(captured);const {checkoutStateHash}=await import('../src/store');expect(await clockStore.checkoutStatus(await checkoutStateHash(issued.state))).toEqual(captured);await expect(clockStore.issueCheckout(self,row.id,'admin')).rejects.toMatchObject({status:409});});
 it('denies non-created orders and staged/aborted imports before nonce issuance',async()=>{const row=await created(self,'checkout:uncertain',1000,connection,ledger,fingerprints);await store.transition(row.id,'provider_unknown',['created']);await expect(store.issueCheckout(self,row.id,'contract')).rejects.toMatchObject({status:409});await expect(store.issueCheckout(owner,'legacy-abort','admin',{migrationId:'migration-legacy-abort',generation:'generation-1',digest:'f'.repeat(64)})).rejects.toMatchObject({status:409});});
});





describe('real D1 callback guard failure and gate isolation',()=>{
 it('turns a zero-change nonce guard into SQL error and rolls back the order claim and receipt',async()=>{const row=await created(self,'checkout:guard-miss',1000,connection,ledger,fingerprints),issued=await store.issueCheckout(self,row.id,'contract');await db.prepare("CREATE TRIGGER test_ignore_nonce BEFORE UPDATE OF result ON checkout_nonces BEGIN SELECT RAISE(IGNORE); END").run();try{await expect(store.captureCheckout({outcome:'success',state:issued.state,paymentKey:'must-rollback',orderId:row.provider_order_id,amount:1100})).rejects.toMatchObject({status:409});expect(await store.load(self,row.id)).toMatchObject({payment_key:null,state:'created',revision:1});expect(await db.prepare('SELECT result FROM checkout_nonces WHERE order_id=?').bind(row.id).first<string>('result')).toBe('pending');expect(await db.prepare('SELECT COUNT(*) AS count FROM checkout_capture_receipts WHERE state_hash IN (SELECT state_hash FROM checkout_nonces WHERE order_id=?)').bind(row.id).first<number>('count')).toBe(0);}finally{await db.prepare('DROP TRIGGER test_ignore_nonce').run();}});
 it('allows only nonfinancial capture/status with the financial gate OFF',async()=>{const row=await created(self,'checkout:gate-off',1000,connection,ledger,fingerprints),issued=await store.issueCheckout(self,row.id,'contract');const {PayApplication}=await import('../src/service');const app=new PayApplication({DB:db,PAY_EXTERNAL_ACTIONS_ENABLED:'false'});expect(await app.dispatch({action:'captureCheckoutCallback',outcome:'success',state:issued.state,paymentKey:'gate-private',orderId:row.provider_order_id,amount:1100})).toMatchObject({ok:true,result:{result:'captured'}});expect(await app.dispatch({action:'reconcileOrder',scope:self,id:row.id})).toMatchObject({ok:false,status:503});expect(await app.dispatch({action:'prepareCheckout',scope:self,id:row.id,returnTarget:'contract'})).toMatchObject({ok:false,status:409});expect(await store.load(self,row.id)).toMatchObject({state:'created',revision:1,payment_key:'gate-private'});});
});


describe('effect authority revocation with real D1 and scripted boundaries (ordering only)',()=>{
 it('durably records provider fact before revocation prevents the later ledger call',async()=>{const row=await created(self,'authority:provider-fact',1000,connection,ledger,fingerprints);await store.bindPayment(self,row.id,'authority-private');const {checkEffectAuthority}=await import('../src/effect-authority'),{confirmPayment}=await import('../src/payments');let allowed=true,ledgerCalls=0;const adapters=boundaries({gateway:{confirm:async order=>{allowed=false;return {paymentKey:order.payment_key!,orderId:order.provider_order_id,merchantId:'merchant-a',totalAmount:1100,currency:'KRW',status:'DONE',balanceAmount:1100};}},ledger:{getCredit:async()=>{ledgerCalls++;throw Error('must not reach ledger after revocation');}}});adapters.beforeEffect=()=>checkEffectAuthority({check:async()=>allowed});await expect(confirmPayment(store,self,await store.load(self,row.id),adapters)).rejects.toMatchObject({status:403});expect(await store.load(self,row.id)).toMatchObject({state:'credit_pending',payment_key:'authority-private'});expect(ledgerCalls).toBe(0);});
});


describe('effect authority refund proof ordering (real D1, scripted boundaries only)',()=>{
 it('keeps the known refund proof when authority is revoked before ledger finalize',async()=>{const row=await created(self,'authority:refund-proof',1000,connection,ledger,fingerprints);await store.bindPayment(self,row.id,'refund-authority-private');await store.transition(row.id,'credited',['created']);const {checkEffectAuthority}=await import('../src/effect-authority'),{refundPayment}=await import('../src/payments');let allowed=true,finalizeCalls=0;const adapters=boundaries({gateway:{cancel:async order=>{allowed=false;return {paymentKey:order.payment_key!,orderId:order.provider_order_id,merchantId:'merchant-a',totalAmount:1100,currency:'KRW',status:'CANCELED',balanceAmount:0,refundTransactionId:'immutable-refund-proof'};}},ledger:{reserveRefund:async order=>({companyId:order.company_id,operationId:'refund:'+order.id,supplyKrw:1000,state:'reserved'}),finalizeRefund:async()=>{finalizeCalls++;throw Error('must not finalize after revocation');}}});adapters.beforeEffect=()=>checkEffectAuthority({check:async()=>allowed});await expect(refundPayment(store,self,await store.load(self,row.id),'Original reason',adapters)).rejects.toMatchObject({status:403});expect(await store.load(self,row.id)).toMatchObject({state:'refund_unknown',refund_reason:'Original reason',provider_refund_id:'immutable-refund-proof'});expect(finalizeCalls).toBe(0);});
});

describe('checkout failure order identity v1.6 (actual D1, no financial effects)',()=>{
 it('captures a matching optional provider order identity without changing financial state',async()=>{const row=await created(self,'failure:matching-order',1000,connection,ledger,fingerprints),issued=await store.issueCheckout(self,row.id,'contract');const {PayApplication}=await import('../src/service'),app=new PayApplication({DB:db});expect(await app.dispatch({action:'captureCheckoutCallback',outcome:'fail',state:issued.state,orderId:row.provider_order_id,code:'PAY_PROCESS_CANCELED'})).toMatchObject({ok:true,result:{id:row.id,result:'failed'}});expect(await store.load(self,row.id)).toMatchObject({payment_key:null,state:'created',revision:1});});
 it('rejects a foreign optional order before consuming nonce, receipt or private claim',async()=>{const row=await created(self,'failure:foreign-order',1000,connection,ledger,fingerprints),issued=await store.issueCheckout(self,row.id,'contract');const {PayApplication}=await import('../src/service'),app=new PayApplication({DB:db});expect(await app.dispatch({action:'captureCheckoutCallback',outcome:'fail',state:issued.state,orderId:'foreign-order'})).toMatchObject({ok:false,status:409});expect(await db.prepare('SELECT result FROM checkout_nonces WHERE order_id=?').bind(row.id).first<string>('result')).toBe('pending');expect(await db.prepare('SELECT COUNT(*) AS n FROM checkout_capture_receipts WHERE state_hash IN (SELECT state_hash FROM checkout_nonces WHERE order_id=?)').bind(row.id).first<number>('n')).toBe(0);expect(await store.load(self,row.id)).toMatchObject({payment_key:null,state:'created',revision:1});});
 it('accepts cancellation without orderId and preserves optional-field identity on replay',async()=>{const row=await created(self,'failure:no-order',1000,connection,ledger,fingerprints),issued=await store.issueCheckout(self,row.id,'contract');const {PayApplication}=await import('../src/service'),app=new PayApplication({DB:db});const callback={action:'captureCheckoutCallback' as const,outcome:'fail' as const,state:issued.state,code:'PAY_PROCESS_CANCELED'};const result=await app.dispatch(callback);expect(result).toMatchObject({ok:true,result:{result:'failed'}});expect(await app.dispatch(callback)).toEqual(result);expect(await app.dispatch({...callback,orderId:row.provider_order_id})).toMatchObject({ok:false,status:409});});
});


describe('checkout failure order identity and expired unused status',()=>{
 it('does not disclose a redirect receipt for an expired unused state hash',async()=>{let now=Date.parse('2026-10-15T00:00:00.000Z');const clockStore=new PayStore(db,()=>now),row=await created(self,'failure:expired-status',1000,connection,ledger,fingerprints),issued=await clockStore.issueCheckout(self,row.id,'contract');now+=600001;const {checkoutStateHash}=await import('../src/store');await expect(clockStore.checkoutStatus(await checkoutStateHash(issued.state))).rejects.toMatchObject({status:409});expect(await store.load(self,row.id)).toMatchObject({payment_key:null,state:'created'});});
});


describe('checkout failure order identity and explicit historical recovery',()=>{
 it('treats refund_unknown reconcile as a guarded recovery of the saved refund intent',async()=>{const row=await created(self,'refund:explicit-reconcile',1000,connection,ledger,fingerprints);await store.bindPayment(self,row.id,'refund-reconcile-private');await store.transition(row.id,'credited',['created']);await store.claimRefund(self,row.id,'Saved original reason');await store.transition(row.id,'refund_unknown',['refund_pending']);const {PayApplication}=await import('../src/service'),app=new PayApplication({DB:db,PAY_EXTERNAL_ACTIONS_ENABLED:'false'});expect(await app.dispatch({action:'reconcileOrder',scope:self,id:row.id})).toMatchObject({ok:false,status:503});expect(await store.load(self,row.id)).toMatchObject({state:'refund_unknown',refund_reason:'Saved original reason',payment_key:'refund-reconcile-private'});});
});


describe('legacy cancellation proof import v1.7 (actual D1)',()=>{
 const source=(id:string):LegacyPaymentOrder=>({id,company_id:'company-a',user_id:'alice',provider_order_id:'test_'+id,idempotency_key:'legacy:'+id,supply_krw:1000,vat_krw:100,total_krw:1100,currency:'KRW',mode:'sandbox',state:'refund_unknown',payment_key:'private-'+id,refund_reason:'Original source reason',notify_workspace_id:'workspace-a',revision:9,created_at:'2026-09-01T00:00:00.000Z',updated_at:'2026-09-03T00:00:00.000Z',provenance:{source:'admin',table:'messaging_test_payment_orders',quiescentMarker:'legacy-proof-generation'}});
 async function payload(order:LegacyPaymentOrder){const value={migrationId:'proof-migration-'+order.id,generation:'legacy-proof-generation',order,connection,ledger};return {...value,digest:await importDigest(value)};}
 it('preserves the exact supplied first cancellation proof and rejects a changed proof',async()=>{const order={...source('import-known-proof'),provider_refund_id:'source-verified-proof'},value=await payload(order);await expect(store.importLegacy(owner,value,fingerprints)).resolves.toMatchObject({state:'staged',digest:value.digest});expect(await store.load(self,order.id)).toMatchObject({state:'refund_unknown',provider_refund_id:'source-verified-proof',refund_reason:'Original source reason',payment_key:'private-import-known-proof',revision:9});expect(await store.importLegacy(owner,value,fingerprints)).toMatchObject({digest:value.digest,state:'staged'});const changed=await payload({...order,provider_refund_id:'different-proof'});await expect(store.importLegacy(owner,changed,fingerprints)).rejects.toMatchObject({status:409});await expect(db.prepare('UPDATE payment_orders SET provider_refund_id=? WHERE id=?').bind('different-proof',order.id).run()).rejects.toThrow();expect(JSON.stringify(await store.list(owner))).not.toContain('source-verified-proof');});
 it('keeps an old frozen payload without the optional proof byte-equivalent in the saved digest',async()=>{const order=source('import-old-no-proof'),value=await payload(order);const result=await store.importLegacy(owner,value,fingerprints);expect(result).toMatchObject({digest:value.digest,state:'staged'});const json=await db.prepare('SELECT source_json FROM payment_imports WHERE order_id=?').bind(order.id).first<string>('source_json');expect(Object.hasOwn(JSON.parse(json!).order,'provider_refund_id')).toBe(false);expect((await store.load(self,order.id)).provider_refund_id).toBeNull();expect(await store.importLegacy(owner,value,fingerprints)).toEqual(result);});
});


describe('private action allowlist prototype rejection',()=>{
 it.each(['toString','constructor','__proto__'])('rejects inherited %s as malformed rather than transient failure',async action=>{const {PayApplication}=await import('../src/service'),app=new PayApplication({DB:db});expect(await app.dispatch({action,scope:self} as any)).toMatchObject({ok:false,status:400,error:{code:'invalid_input'}});});
});

describe('published wire contract parsers accept what Pay returns (real D1, no provider or ledger calls)',()=>{
 it('parses actual capabilities, orders, pages, checkout preparation and capture results without loss',async()=>{
  const {PayApplication}=await import('../src/service');
  const contract=await import('@devslab-kr/pay-contract');
  const c=(await registerConnection(db,'company-a',connection.providerAccountId,'Contract1')).connection,l={...ledger,integrationId:'n-contract',credentialSetId:'ledger-contract'};
  const registry={[l.credentialSetId]:{companyId:'company-a',provider:'notify',environment:'test',purpose:'ledger',workspaceId:l.workspaceId,secretBinding:'PAY_NOTIFY_TEST_LEDGER_CONTRACT'}};
  const app=new PayApplication({...vaultEnv(db),PAY_EXTERNAL_ACTIONS_ENABLED:'true',PAY_LEDGER_REGISTRY_JSON:JSON.stringify(registry),PAY_NOTIFY_TEST_LEDGER_CONTRACT:'contract-ledger-fixture'});
  const authority={check:async()=>true};
  const ok=async(command:Parameters<typeof app.dispatch>[0])=>{const response=await app.dispatch(command,authority);if(!response.ok)throw Error('Pay rejected '+command.action+': '+response.error.code);return response.result;};
  for(const value of [await ok({action:'capabilities',scope:self,connection:c,ledger:l}),await ok({action:'capabilities',scope:self})])expect(contract.parseCapabilities(value)).toEqual(value);
  const order=await ok({action:'createOrder',scope:self,operationId:'contract:parse',supplyKrw:2000,connection:c,ledger:l});
  expect(contract.parsePublicOrder(order)).toEqual(order);
  const page=await ok({action:'listOrders',scope:self});
  expect(contract.parseOrderPage(page)).toEqual(page);
  const prepared=await ok({action:'prepareCheckout',scope:self,id:(order as {id:string}).id,returnTarget:'contract'});
  expect(contract.parseCheckoutPreparation(prepared)).toEqual(prepared);
  const state=new URL((prepared as {successUrl:string}).successUrl).searchParams.get('state')!;
  const captured=await ok({action:'captureCheckoutCallback',outcome:'fail',state});
  expect(contract.parseCheckoutCaptureResult(captured)).toEqual(captured);
  const status=await ok({action:'checkoutCaptureStatus',stateHash:await contract.checkoutStateHash(state)});
  expect(contract.parseCheckoutCaptureResult(status)).toEqual(captured);
 });
});

describe('checkout return registry (pay-contract 0.2.0, real D1, no provider or ledger calls)',()=>{
 let c:ConnectionSnapshot;const l={...ledger,integrationId:'n-return',credentialSetId:'ledger-return'};
 beforeAll(async()=>{c=(await registerConnection(db,'company-a',connection.providerAccountId,'Return1')).connection;});
 const registry={[l.credentialSetId]:{companyId:'company-a',provider:'notify',environment:'test',purpose:'ledger',workspaceId:l.workspaceId,secretBinding:'PAY_NOTIFY_TEST_LEDGER_RETURN'}};
 const env={PAY_EXTERNAL_ACTIONS_ENABLED:'true',PAY_LEDGER_REGISTRY_JSON:JSON.stringify(registry),PAY_NOTIFY_TEST_LEDGER_RETURN:'return-ledger-fixture'};
 const authority={check:async()=>true};
 async function app(){const {PayApplication}=await import('../src/service');return new PayApplication({...vaultEnv(db),...env});}
 async function order(key:string,scope:PayScope=self){const a=await app(),r=await a.dispatch({action:'createOrder',scope,operationId:key,supplyKrw:1000,connection:c,ledger:l},authority);if(!r.ok)throw Error('createOrder '+r.error.code);return (r.result as {id:string}).id;}
 const nonces=async(id:string)=>db.prepare('SELECT COUNT(*) AS n FROM checkout_nonces WHERE order_id=?').bind(id).first<number>('n');
 it('saves the chosen registry entry and builds only the registry redirect from the capture',async()=>{
  const contract=await import('@devslab-kr/pay-contract');
  for(const [scope,returnTarget,path,expected] of [
   [self,'contract','/notify','https://contract.devslab.kr/notify?paymentOrder=ID&paymentResult=failed'],
   [owner,'admin','/payments','https://admin.devslab.kr/payments?companyId=company-a&testOrderId=ID&paymentResult=failed'],
  ] as const){
   const a=await app(),id=await order('return:'+returnTarget,scope);
   const prepared=await a.dispatch({action:'prepareCheckout',scope,id,returnTarget,returnTo:{service:returnTarget,path}} as PayCommand,authority);
   if(!prepared.ok)throw Error('prepareCheckout '+prepared.error.code);
   const state=new URL((prepared.result as {successUrl:string}).successUrl).searchParams.get('state')!;
   const captured=await a.dispatch({action:'captureCheckoutCallback',outcome:'fail',state});
   expect(captured).toEqual({ok:true,result:{returnTarget,returnTo:{service:returnTarget,path},companyId:'company-a',id,result:'failed'}});
   const parsed=contract.parseCheckoutCaptureResult((captured as {result:unknown}).result);
   expect(contract.checkoutReturnUrl(parsed)).toBe(expected.replace('ID',id));
   expect(await db.prepare('SELECT return_target,return_path FROM checkout_nonces WHERE order_id=?').bind(id).first()).toEqual({return_target:returnTarget,return_path:path});
  }
 });
 it.each([
  ['an absolute URL',{service:'contract',path:'https://evil.example/notify'}],
  ['a protocol-relative URL',{service:'contract',path:'//evil.example/notify'}],
  ['a backslash host',{service:'contract',path:'/\\evil.example'}],
  ['an encoded slash',{service:'contract',path:'%2Fnotify'}],
  ['an encoded traversal',{service:'contract',path:'/notify%2F..%2Fadmin'}],
  ['a path traversal',{service:'contract',path:'/notify/../payments'}],
  ['a dot segment prefix',{service:'contract',path:'/./notify'}],
  ['a case variant',{service:'contract',path:'/Notify'}],
  ['a trailing slash',{service:'contract',path:'/notify/'}],
  ['a query suffix',{service:'contract',path:'/notify?next=https://evil.example'}],
  ['a fragment suffix',{service:'contract',path:'/notify#x'}],
  ['leading whitespace',{service:'contract',path:' /notify'}],
  ['another service path',{service:'contract',path:'/payments'}],
  ['a different service than returnTarget',{service:'admin',path:'/payments'}],
  ['an unknown service',{service:'evil',path:'/notify'}],
  ['an inherited service name',{service:'__proto__',path:'/notify'}],
  ['an extra origin field',{service:'contract',path:'/notify',origin:'https://evil.example'}],
  ['a raw URL string','https://contract.devslab.kr/notify'],
  ['an array',['contract','/notify']],
 ])('rejects %s before any nonce exists',async(name,returnTo)=>{
  const a=await app(),id=await order('return:reject:'+name.replace(/[^a-z]/g,'-'));
  expect(await a.dispatch({action:'prepareCheckout',scope:self,id,returnTarget:'contract',returnTo} as unknown as PayCommand,authority)).toMatchObject({ok:false,status:400,error:{code:'invalid_input'}});
  expect(await nonces(id)).toBe(0);
 });
 it('rejects an unregistered returnTarget and a raw URL target',async()=>{
  const a=await app(),id=await order('return:target');
  for(const returnTarget of ['https://evil.example','//evil.example','contract/../admin','toString'])
   expect(await a.dispatch({action:'prepareCheckout',scope:self,id,returnTarget} as unknown as PayCommand,authority)).toMatchObject({ok:false,status:400});
  expect(await nonces(id)).toBe(0);
 });
 it('bounds the saved path in SQL, keeps it immutable and fails closed for a path the registry no longer lists',async()=>{
  const row=await created(self,'return:sql',1000,connection,ledger,fingerprints),issued=await store.issueCheckout(self,row.id,{service:'contract',path:'/notify'});
  const {checkoutStateHash}=await import('../src/store'),hash=await checkoutStateHash(issued.state);
  await expect(db.prepare('UPDATE checkout_nonces SET return_path=? WHERE state_hash=?').bind('/payments',hash).run()).rejects.toThrow();
  const insert=(path:string,fill:string)=>db.prepare('INSERT INTO checkout_nonces(state_hash,order_id,company_id,subject,scope_access,provider_order_id,total_krw,return_target,return_path,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(fill.repeat(64),row.id,'company-a','alice','self',row.provider_order_id,1100,'contract',path,new Date(Date.now()+600000).toISOString(),new Date().toISOString()).run();
  for(const [path,fill] of [['//evil.example','c'],['https://evil.example','d'],['/notify/../payments','e'],['notify','f']] as const)await expect(insert(path,fill)).rejects.toThrow();
  await insert('/retired','9');
  await expect(store.checkoutStatus('9'.repeat(64))).rejects.toMatchObject({status:503});
 });
});

describe('settlement only after Pay verified the provider payment itself (real D1, scripted boundaries)',()=>{
 const done=(o:StoredOrder):GatewayPayment=>({paymentKey:o.payment_key!,orderId:o.provider_order_id,merchantId:'merchant-a',totalAmount:o.total_krw,currency:'KRW',status:'DONE',balanceAmount:o.total_krw});
 const receipt=(o:StoredOrder,id:string):LedgerReceipt=>({operationId:id,companyId:o.company_id,supplyKrw:o.supply_krw,state:'credited'});
 it.each([
  ['a foreign order id',{orderId:'test_other'}],
  ['a foreign merchant',{merchantId:'merchant-b'}],
  ['a different amount',{totalAmount:1000}],
  ['a different currency',{currency:'USD'}],
  ['an unpaid status',{status:'WAITING_FOR_DEPOSIT'}],
  ['a partially cancelled balance',{balanceAmount:100}],
 ])('never touches the ledger when the fetched receipt has %s',async(name,patch)=>{
  const key=name.replace(/[^a-z]/g,'-'),row=await created(self,'settle:'+key,1000,connection,ledger,fingerprints);await store.bindPayment(self,row.id,'settle-key-'+key);
  let ledgerCalls=0;const {confirmPayment}=await import('../src/payments');
  const result=await confirmPayment(store,self,await store.load(self,row.id),boundaries({gateway:{confirm:async o=>({...done(o),...patch}) as GatewayPayment},ledger:{getCredit:async()=>{ledgerCalls++;return null;},credit:async()=>{ledgerCalls++;throw Error('must not credit');}}}));
  expect(result.state).toBe('provider_unknown');expect(ledgerCalls).toBe(0);
 });
 it('credits once with the per-order idempotency key after a verified receipt, and never again on replay',async()=>{
  const row=await created(self,'settle:verified',1000,connection,ledger,fingerprints);await store.bindPayment(self,row.id,'settle-verified-key');
  const credits:string[]=[];let saved:LedgerReceipt|null=null;const {confirmPayment}=await import('../src/payments');
  const adapters=boundaries({gateway:{confirm:async o=>done(o),lookup:async o=>done(o)},ledger:{getCredit:async()=>saved,credit:async(o,id)=>{credits.push(id);saved=receipt(o,id);return saved;}}});
  expect((await confirmPayment(store,self,await store.load(self,row.id),adapters)).state).toBe('credited');
  expect(credits).toEqual(['payment:'+row.id]);
  expect((await confirmPayment(store,self,await store.load(self,row.id),adapters)).state).toBe('credited');
  expect(credits).toHaveLength(1);
 });
 it('resumes credit_pending through the existing ledger receipt instead of a second credit',async()=>{
  const row=await created(self,'settle:resume',1000,connection,ledger,fingerprints);await store.bindPayment(self,row.id,'settle-resume-key');await store.transition(row.id,'credit_pending',['created']);
  let credits=0;const {confirmPayment}=await import('../src/payments');
  const result=await confirmPayment(store,self,await store.load(self,row.id),boundaries({ledger:{getCredit:async(o,id)=>receipt(o,id),credit:async()=>{credits++;throw Error('second credit');}}}));
  expect(result.state).toBe('credited');expect(credits).toBe(0);
 });
 it('rejects a browser-supplied amount or order that differs from the saved order before binding a payment key',async()=>{
  const row=await created(self,'settle:browser',1000,connection,ledger,fingerprints);const {PayApplication}=await import('../src/service'),a=new PayApplication({DB:db});
  for(const patch of [{amount:1000},{amount:110000},{amount:1100.5},{amount:'1100'},{orderId:'test_other'}])
   expect(await a.dispatch({action:'confirmOrder',scope:self,id:row.id,paymentKey:'browser-key',orderId:row.provider_order_id,amount:1100,...patch} as unknown as PayCommand)).toMatchObject({ok:false,status:409});
  expect(await store.load(self,row.id)).toMatchObject({state:'created',payment_key:null});
 });
});

describe('Pay decides amounts and caps one order (real D1)',()=>{
 it('derives VAT and total from the price list, caps the supply and refuses caller totals',async()=>{
  const {PayApplication}=await import('../src/service'),a=new PayApplication({DB:db});
  const {RECHARGE_MAXIMUM_SUPPLY_KRW}=await import('@devslab-kr/pay-contract');
  for(const supplyKrw of [RECHARGE_MAXIMUM_SUPPLY_KRW+1000,Number.MAX_SAFE_INTEGER,1500,999,0,-1000,'1000',1000.5])
   expect(await a.dispatch({action:'createOrder',scope:self,operationId:'amount:'+String(supplyKrw).replace(/[^0-9]/g,'n'),supplyKrw,connection,ledger} as unknown as PayCommand)).toMatchObject({ok:false,status:400,error:{code:'invalid_input'}});
  expect(await a.dispatch({action:'createOrder',scope:self,operationId:'amount:total',supplyKrw:1000,totalKrw:1,connection,ledger} as unknown as PayCommand)).toMatchObject({ok:false,status:400});
  await expect(store.create(self,'amount:store-over',RECHARGE_MAXIMUM_SUPPLY_KRW+1000,connection,ledger,fingerprints)).rejects.toMatchObject({status:400});
  expect(await db.prepare("SELECT COUNT(*) AS n FROM payment_orders WHERE idempotency_key LIKE 'amount:%'").first('n')).toBe(0);
  expect(await created(self,'amount:max',RECHARGE_MAXIMUM_SUPPLY_KRW,connection,ledger,fingerprints)).toMatchObject({supply_krw:1000000,vat_krw:100000,total_krw:1100000});
 });
});

describe('refund needs fresh authority, the order scope and a wallet hold first (real D1, scripted boundaries)',()=>{
 it('denies refunds without current authority or outside the order scope and leaves the order untouched',async()=>{
  const row=await created(self,'refund-guard:scope',1000,connection,ledger,fingerprints);await store.bindPayment(self,row.id,'refund-guard-key');await store.transition(row.id,'credited',['created']);
  const {PayApplication}=await import('../src/service'),a=new PayApplication({DB:db,PAY_EXTERNAL_ACTIONS_ENABLED:'true'});
  expect(await a.dispatch({action:'refundOrder',scope:self,id:row.id,reason:'Customer'})).toMatchObject({ok:false,status:503,error:{code:'effect_authority_required'}});
  expect(await a.dispatch({action:'refundOrder',scope:self,id:row.id,reason:'Customer'},{check:async()=>false})).toMatchObject({ok:false,status:403,error:{code:'effect_authority_denied'}});
  for(const scope of [{...self,subject:'bob'},{...owner,companyId:'company-b'}])
   expect(await a.dispatch({action:'refundOrder',scope,id:row.id,reason:'Customer'},{check:async()=>true})).toMatchObject({ok:false,status:404});
  expect(await store.load(self,row.id)).toMatchObject({state:'credited',refund_reason:null,provider_refund_id:null});
 });
 it.each([
  ['the hold call fails',async():Promise<LedgerReceipt>=>{throw Error('ledger timeout');}],
  ['the hold is not reserved',async(o:StoredOrder,id:string):Promise<LedgerReceipt>=>({operationId:id,companyId:o.company_id,supplyKrw:o.supply_krw,state:'released'})],
  ['the hold is for another amount',async(o:StoredOrder,id:string):Promise<LedgerReceipt>=>({operationId:id,companyId:o.company_id,supplyKrw:o.supply_krw+1000,state:'reserved'})],
 ])('never cancels at the provider when %s',async(name,reserveRefund)=>{
  const key=name.replace(/[^a-z]/g,'-'),row=await created(self,'refund-guard:'+key,1000,connection,ledger,fingerprints);await store.bindPayment(self,row.id,'refund-guard-'+key);await store.transition(row.id,'credited',['created']);
  let provider=0;const {refundPayment}=await import('../src/payments');
  const result=await refundPayment(store,self,await store.load(self,row.id),'Customer',boundaries({gateway:{cancel:async()=>{provider++;throw Error('must not cancel');},lookup:async()=>{provider++;throw Error('must not look up');}},ledger:{reserveRefund}}));
  expect(result).toMatchObject({state:'refund_unknown',refund_reason:'Customer',provider_refund_id:null});expect(provider).toBe(0);
 });
});
