import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const artifact=fileURLToPath(new URL('../dist/index.js',import.meta.url));
let outbound=0;
const runtime=new Miniflare({...convertV4MiniflareOptions({cf:false,workers:[{
 name:'pay-built',modules:true,scriptPath:artifact,compatibilityDate:'2026-10-13',
 d1Databases:{DB:'pay-built-local-only'},bindings:{PAY_EXTERNAL_ACTIONS_ENABLED:'false'},
 outboundService:()=>{outbound++;return new Response('Outbound blocked',{status:503});}
},{
 name:'pay-probe',modules:true,compatibilityDate:'2026-10-13',
 serviceBindings:{PAY:{name:'pay-built',entrypoint:'PayService'}},
 script:`import {RpcTarget} from 'cloudflare:workers';
 class Authority extends RpcTarget {
  #state;constructor(state){super();this.#state=state;}
  async check(){this.#state.checks++;return this.#state.open===true;}
 }
 export default {async fetch(request,env){
  if(new URL(request.url).pathname==='/http')return env.PAY.fetch(request);
  const state={open:true,checks:0},authority=new Authority(state);let result;
  try{result=await env.PAY.dispatch(await request.json(),authority);}finally{state.open=false;}
  return Response.json({result,checks:state.checks,closedDenied:!(await authority.check())});
 }};`
}]}),telemetry:{enabled:false}});
try{
 const db=await runtime.getD1Database('DB','pay-built');
 for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){
  const sql=await readFile(new URL('../migrations/'+file,import.meta.url),'utf8');
  await db.batch(sql.split('-- statement').filter(s=>s.trim()).map(s=>db.prepare(s)));
 }
 const probe=await runtime.getWorker('pay-probe'),publicWorker=await runtime.getWorker('pay-built');
 const dispatch=async command=>(await probe.fetch('http://local-probe/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(command)})).json();
 const scope={subject:'local-actor',companyId:'local-company',access:'self'};
 const capabilities=await dispatch({action:'capabilities',scope});
 assert.equal(capabilities.result.ok,true);assert.equal(capabilities.result.result.mode,'unavailable');assert.equal(capabilities.closedDenied,true);
 assert.equal((await probe.fetch('http://local-probe/http')).status,404);
 assert.equal((await publicWorker.fetch('http://localhost/rpc')).status,404);
 assert.equal((await publicWorker.fetch('http://localhost/terms')).status,503);
 const malformed=await dispatch({action:'getOrder',scope:{...scope,access:'owner'},id:'missing'});
 assert.equal(malformed.result.status,400);
 const financial=await dispatch({action:'createOrder',scope,operationId:'built-local-create',supplyKrw:1000,connection:{id:'p',companyId:scope.companyId,revision:'1',provider:'toss',environment:'test',providerAccountId:'merchant',credentialSetId:'unconfigured'},ledger:{provider:'notify',companyId:scope.companyId,workspaceId:'workspace',integrationId:'n',revision:'1',credentialSetId:'unconfigured-ledger',environment:'test',kind:'notify-test-wallet',transport:'https-fixed-notify'}});
 assert.equal(financial.result.status,503);assert.ok(financial.checks>=1);assert.equal(financial.closedDenied,true);
 assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM payment_orders').first('n'),0);
 assert.equal(outbound,0);

 const now=new Date().toISOString(),state=Buffer.alloc(32,7).toString('base64url'),stateHash=createHash('sha256').update(state).digest('hex');
 const connection={id:'fixture-pay',companyId:scope.companyId,revision:'1',provider:'toss',environment:'test',providerAccountId:'fixture-merchant',credentialSetId:'fixture-ref'};
 const ledger={provider:'notify',companyId:scope.companyId,workspaceId:'fixture-workspace',integrationId:'fixture-ledger',revision:'1',credentialSetId:'fixture-ledger-ref',environment:'test',kind:'notify-test-wallet',transport:'https-fixed-notify'};
 await db.prepare('INSERT INTO payment_orders(id,company_id,user_id,provider_order_id,idempotency_key,supply_krw,vat_krw,total_krw,connection_json,ledger_json,provider_fingerprint,ledger_fingerprint,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind('built-callback-order',scope.companyId,scope.subject,'test_built-callback-order','built-callback',1000,100,1100,JSON.stringify(connection),JSON.stringify(ledger),'a'.repeat(64),'b'.repeat(64),now,now).run();
 await db.prepare('INSERT INTO checkout_nonces(state_hash,order_id,company_id,subject,scope_access,provider_order_id,total_krw,return_target,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(stateHash,'built-callback-order',scope.companyId,scope.subject,'self','test_built-callback-order',1100,'contract',new Date(Date.now()+600000).toISOString(),now).run();
 const captured=await dispatch({action:'captureCheckoutCallback',outcome:'success',state,paymentKey:'built-private-fixture',orderId:'test_built-callback-order',amount:1100});
 // A nonce saved before migration 0002 (no return_path) replays with the default registry entry of its target.
 assert.deepEqual(captured.result,{ok:true,result:{returnTarget:'contract',returnTo:{service:'contract',path:'/notify'},companyId:scope.companyId,id:'built-callback-order',result:'captured'}});
 assert.equal(captured.checks,0);assert.ok(!JSON.stringify(captured).includes('built-private-fixture'));
 const saved=await db.prepare('SELECT state,revision,payment_key FROM payment_orders WHERE id=?').bind('built-callback-order').first();
 assert.deepEqual(saved,{state:'created',revision:1,payment_key:'built-private-fixture'});
 const status=await dispatch({action:'checkoutCaptureStatus',stateHash});assert.equal(status.result.result.result,'captured');
 const publicOrder=await dispatch({action:'getOrder',scope,id:'built-callback-order'});assert.ok(!JSON.stringify(publicOrder).includes('built-private-fixture'));
 assert.equal(outbound,0);

 console.log('Built Pay RPC PASS: actual named WorkerEntrypoint, ephemeral RpcTarget serialization/closing, real local D1, HTTP404/policy503, unavailable financial gate, zero outbound.');
}finally{await runtime.dispose();}
