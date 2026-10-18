import {afterAll,beforeAll,describe,it,expect,vi} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import {URL as NodeURL} from 'node:url';
import {parsePaymentConnectionState,parsePaymentConnectionView,type PayCommand,type PayScope,type PaymentConnectionState,type PaymentConnectionView} from '@devslab-kr/pay-contract';
import {PayApplication} from '../src/service';
import {classifyTossProbe,resolveConnection,type TossVerifier} from '../src/connections';
import {inspectConnection,resolveSnapshots} from '../src/registry';
import {connectionAad,readMasterKey,sealCredentials,unsealCredentials} from '../src/vault';
import {OTHER_MASTER_KEY,TEST_MASTER_KEY,fakeKeys,registerConnection,vaultEnv,verifiedOk} from './connection-fixture';

let mf:Miniflare,db:D1Database;
beforeAll(async()=>{mf=new Miniflare({...convertV4MiniflareOptions({cf:false,workers:[{name:'pay-vault-tests',modules:true,script:"export default {fetch(){return new Response('not found',{status:404})}}",compatibilityDate:'2026-10-13',d1Databases:{DB:'pay-vault-db'},outboundService:async()=>new Response('blocked',{status:503})}]}),telemetry:{enabled:false}});db=await mf.getD1Database('DB','pay-vault-tests');for(const file of (await readdir(new NodeURL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){const sql=await readFile(new NodeURL('../migrations/'+file,import.meta.url),'utf8');await db.batch(sql.split('-- statement').filter(s=>s.trim()).map(s=>db.prepare(s)));}});
afterAll(async()=>{await mf?.dispose();});

const owner=(companyId:string):PayScope=>({subject:'owner-'+companyId,companyId,access:'company'});
const allow={check:async()=>true};
const count=async(companyId:string)=>db.prepare('SELECT COUNT(*) AS n FROM payment_connections WHERE company_id=?').bind(companyId).first<number>('n');
const audits=async(companyId:string)=>(await db.prepare('SELECT action,actor_id,evidence_json FROM payment_connection_audit WHERE company_id=? ORDER BY created_at,action').bind(companyId).all<{action:string;actor_id:string;evidence_json:string}>()).results;
function app(verify:TossVerifier=verifiedOk,extra:Record<string,unknown>={}){return new PayApplication({...vaultEnv(db),...extra},verify);}
const connect=(companyId:string,suffix:string,merchantId='tvivarepublica')=>({action:'connectConnection',scope:owner(companyId),merchantId,...fakeKeys(suffix)}) as PayCommand;
async function ok<T>(response:Promise<Awaited<ReturnType<PayApplication['dispatch']>>>):Promise<T>{const r=await response;if(!r.ok)throw Error('Pay rejected: '+r.error.code);return r.result as T;}

describe('connection vault: register a company Toss test account (real local D1, no Toss call)',()=>{
 it('verifies once, stores sealed keys and returns only the MID, the client-key hint and a fingerprint',async()=>{
  const verify=vi.fn<TossVerifier>(async()=>'ok'),keys=fakeKeys('A0001');
  const view=await ok<PaymentConnectionView>(app(verify).dispatch(connect('vault-a','A0001'),allow));
  expect(verify).toHaveBeenCalledTimes(1);expect(verify).toHaveBeenCalledWith(keys.secretKey);
  expect(parsePaymentConnectionView(view)).toEqual(view);
  expect(view).toMatchObject({provider:'toss',environment:'test',version:1,status:'active',merchantId:'tvivarepublica',clientKeyHint:'0001',revokedAt:null});
  const state=await ok<PaymentConnectionState>(app().dispatch({action:'connectionState',scope:owner('vault-a')}));
  expect(parsePaymentConnectionState(state)).toEqual(state);expect(state.active?.id).toBe(view.id);
  // Neither key appears in any response, stored row or audit row.
  const stored=JSON.stringify(await db.prepare('SELECT * FROM payment_connections WHERE company_id=?').bind('vault-a').all())+JSON.stringify(await audits('vault-a'));
  for(const text of [JSON.stringify(view),JSON.stringify(state),stored]){expect(text).not.toContain(keys.secretKey);expect(text).not.toContain(keys.clientKey);expect(text).not.toContain('FAKEsecret');}
  expect((await audits('vault-a')).map(a=>a.action)).toEqual(['connect']);
  expect(JSON.parse((await audits('vault-a'))[0]!.evidence_json)).toEqual({provider:'toss',environment:'test',version:1,merchantId:'tvivarepublica',clientKeyHint:'0001',fingerprint:view.fingerprint});
 });
 it('is for company administrators with current effect authority only, checked before Toss sees the keys',async()=>{
  const verify=vi.fn<TossVerifier>(async()=>'ok'),a=app(verify);
  expect(await a.dispatch({...connect('vault-guard','G0001'),scope:{subject:'member',companyId:'vault-guard',access:'self'}} as PayCommand,allow)).toMatchObject({ok:false,status:403,error:{code:'service_access_required'}});
  expect(await a.dispatch(connect('vault-guard','G0001'))).toMatchObject({ok:false,status:503,error:{code:'effect_authority_required'}});
  expect(await a.dispatch(connect('vault-guard','G0001'),{check:async()=>false})).toMatchObject({ok:false,status:403,error:{code:'effect_authority_denied'}});
  expect(await a.dispatch({action:'connectionState',scope:{subject:'member',companyId:'vault-guard',access:'self'}})).toMatchObject({ok:false,status:403});
  expect(verify).not.toHaveBeenCalled();expect(await count('vault-guard')).toBe(0);
  // Authority revoked during the Toss call: nothing is stored.
  let checks=0;expect(await a.dispatch(connect('vault-guard','G0001'),{check:async()=>++checks===1})).toMatchObject({ok:false,status:403});
  expect(verify).toHaveBeenCalledTimes(1);expect(await count('vault-guard')).toBe(0);
 });
 it('stores nothing when Toss rejects the key or cannot answer, and never sends live, widget or malformed keys',async()=>{
  const rejected=vi.fn<TossVerifier>(async()=>'rejected'),down=vi.fn<TossVerifier>(async()=>'unavailable');
  expect(await app(rejected).dispatch(connect('vault-reject','R0001'),allow)).toMatchObject({ok:false,status:400,error:{code:'payment_credentials_invalid'}});
  expect(await app(down).dispatch(connect('vault-reject','R0001'),allow)).toMatchObject({ok:false,status:503,error:{code:'payment_unavailable'}});
  const formats=vi.fn<TossVerifier>(async()=>'ok');
  for(const patch of [{secretKey:'live_sk_FAKEsecret0001'},{secretKey:'test_gsk_FAKEsecret0001'},{clientKey:'live_ck_FAKEclient0001'},{clientKey:'test_gck_FAKEclient0001'},{secretKey:'test_sk_'},{merchantId:'mid with space'},{merchantId:'x'},{url:'https://evil.invalid'}])
   expect(await app(formats).dispatch({...connect('vault-reject','R0001'),...patch} as PayCommand,allow)).toMatchObject({ok:false,status:400,error:{code:'invalid_input'}});
  expect(formats).not.toHaveBeenCalled();expect(await count('vault-reject')).toBe(0);expect(await audits('vault-reject')).toEqual([]);
 });
 it('needs the master key and its own verification switch, but not the checkout switch',async()=>{
  const verify=vi.fn<TossVerifier>(async()=>'ok');
  for(const extra of [{PAY_CONNECTION_MASTER_KEY:undefined},{PAY_CONNECTION_MASTER_KEY:'too-short'},{PAY_CONNECTION_VERIFICATION_ENABLED:'false'},{PAY_CONNECTION_VERIFICATION_ENABLED:undefined}])
   expect(await app(verify,extra).dispatch(connect('vault-switch','S0001'),allow)).toMatchObject({ok:false,status:503});
  expect(verify).not.toHaveBeenCalled();
  // A Secrets Store binding works the same as a string; checkout stays OFF.
  const view=await ok<PaymentConnectionView>(app(verify,{PAY_EXTERNAL_ACTIONS_ENABLED:'false',PAY_CONNECTION_MASTER_KEY:{get:async()=>TEST_MASTER_KEY}}).dispatch(connect('vault-switch','S0001'),allow));
  expect(view.status).toBe('active');
 });
 it('classifies the read-only Toss probe answers documented for valid and invalid keys',()=>{
  expect(classifyTossProbe(404,'NOT_FOUND_PAYMENT')).toBe('ok');
  expect(classifyTossProbe(401,'UNAUTHORIZED_KEY')).toBe('rejected');
  expect(classifyTossProbe(400,'INVALID_API_KEY')).toBe('rejected');
  for(const [status,code] of [[404,'NOT_FOUND'],[403,'FORBIDDEN_REQUEST'],[429,null],[500,'FAILED_INTERNAL_SYSTEM_PROCESSING'],[302,null]] as const)expect(classifyTossProbe(status,code)).toBe('unavailable');
 });
});

describe('connection versions: supersede, revoke, isolation and resolution by use',()=>{
 it('supersedes on reconnect, revokes any live version once and keeps every version immutable',async()=>{
  const first=await registerConnection(db,'vault-v','mid-v','V0001'),second=await registerConnection(db,'vault-v','mid-v','V0002');
  const state=await ok<PaymentConnectionState>(app().dispatch({action:'connectionState',scope:owner('vault-v')}));
  expect(state.history.map(v=>[v.version,v.status])).toEqual([[2,'active'],[1,'superseded']]);expect(state.active?.id).toBe(second.view.id);
  const revoked=await ok<PaymentConnectionView>(app().dispatch({action:'revokeConnection',scope:owner('vault-v'),connectionId:first.view.id},allow));
  expect(revoked).toMatchObject({status:'revoked',revokedAt:expect.any(String)});
  expect(await app().dispatch({action:'revokeConnection',scope:owner('vault-v'),connectionId:first.view.id},allow)).toMatchObject({ok:false,status:409,error:{code:'payment_connection_conflict'}});
  expect(await app().dispatch({action:'revokeConnection',scope:owner('vault-v'),connectionId:'pcv_'+'0'.repeat(32)},allow)).toMatchObject({ok:false,status:404});
  expect(await app().dispatch({action:'revokeConnection',scope:owner('vault-v'),connectionId:second.view.id})).toMatchObject({ok:false,status:503,error:{code:'effect_authority_required'}});
  expect((await audits('vault-v')).map(a=>a.action).sort()).toEqual(['connect','connect','revoke']);
  for(const sql of ["UPDATE payment_connections SET sealed_credentials='m1.x.x.x.x' WHERE id=?","UPDATE payment_connections SET merchant_id='other' WHERE id=?","UPDATE payment_connections SET status='active',revoked_at=NULL WHERE id=?","DELETE FROM payment_connections WHERE id=?"])
   await expect(db.prepare(sql).bind(first.view.id).run()).rejects.toThrow();
  await expect(db.prepare("UPDATE payment_connection_audit SET actor_id='x' WHERE connection_id=?").bind(first.view.id).run()).rejects.toThrow();
  await expect(db.prepare("DELETE FROM payment_connection_audit WHERE connection_id=?").bind(first.view.id).run()).rejects.toThrow();
  await expect(db.prepare("INSERT INTO payment_connections(id,company_id,provider,environment,version,status,merchant_id,sealed_credentials,client_key_hint,fingerprint,actor_id,created_at,updated_at) VALUES(?,?,'toss','test',9,'active','mid-v','m1.a.b.c.d','abcd',?,?,'t','t')").bind('pcv_'+'1'.repeat(32),'vault-v','f'.repeat(64),'x').run()).rejects.toThrow();
 });
 it('keeps one company out of another company\'s connections',async()=>{
  const a=await registerConnection(db,'vault-iso-a','mid-a','I0001');
  expect(await ok<PaymentConnectionState>(app().dispatch({action:'connectionState',scope:owner('vault-iso-b')}))).toEqual({companyId:'vault-iso-b',active:null,history:[]});
  expect(await app().dispatch({action:'revokeConnection',scope:owner('vault-iso-b'),connectionId:a.view.id},allow)).toMatchObject({ok:false,status:404});
  await expect(resolveConnection(vaultEnv(db) as never,owner('vault-iso-b'),{...a.connection,companyId:'vault-iso-b'},'settle')).rejects.toMatchObject({status:503});
  expect((await inspectConnection(vaultEnv(db) as never,owner('vault-iso-b'),{...a.connection,companyId:'vault-iso-b'})).configured).toBe(false);
  expect((await inspectConnection(vaultEnv(db) as never,owner('vault-iso-a'),a.connection))).toMatchObject({configured:true,fingerprint:a.view.fingerprint});
 });
 it('serves new work only from the active version, finishes checkout under a superseded one and settles under a revoked one',async()=>{
  const env=vaultEnv(db) as never,scope=owner('vault-use');
  const v1=await registerConnection(db,'vault-use','mid-u','U0001');
  expect((await resolveConnection(env,scope,v1.connection,'new')).clientKey).toBe(fakeKeys('U0001').clientKey);
  await registerConnection(db,'vault-use','mid-u','U0002');
  await expect(resolveConnection(env,scope,v1.connection,'new')).rejects.toMatchObject({status:503});
  expect((await resolveConnection(env,scope,v1.connection,'continue')).fingerprint).toBe(v1.view.fingerprint);
  await ok(app().dispatch({action:'revokeConnection',scope,connectionId:v1.view.id},allow));
  await expect(resolveConnection(env,scope,v1.connection,'continue')).rejects.toMatchObject({status:503});
  expect((await resolveConnection(env,scope,v1.connection,'settle')).secret).toBe(fakeKeys('U0001').secretKey);
  // The MID in the snapshot must be the registered one, and only the right master key opens the envelope.
  await expect(resolveConnection(env,scope,{...v1.connection,providerAccountId:'other-mid'},'settle')).rejects.toMatchObject({status:503});
  await expect(resolveConnection({...vaultEnv(db),PAY_CONNECTION_MASTER_KEY:OTHER_MASTER_KEY} as never,scope,v1.connection,'settle')).rejects.toMatchObject({status:503});
 });
 it('binds each sealed blob to its company, connection and version',async()=>{
  const master=(await readMasterKey(TEST_MASTER_KEY))!,keys=fakeKeys('B0001');
  const sealed=await sealCredentials(master,connectionAad('company-a','pcv_a',1),keys);
  expect(sealed).not.toContain('FAKE');expect(await unsealCredentials(master,connectionAad('company-a','pcv_a',1),sealed)).toEqual(keys);
  for(const aad of [connectionAad('company-b','pcv_a',1),connectionAad('company-a','pcv_b',1),connectionAad('company-a','pcv_a',2)])await expect(unsealCredentials(master,aad,sealed)).rejects.toThrow();
  await expect(unsealCredentials((await readMasterKey(OTHER_MASTER_KEY))!,connectionAad('company-a','pcv_a',1),sealed)).rejects.toThrow();
 });
});

describe('Notify test-ledger registry (unchanged descriptor, new variable name)',()=>{
 const ledger={environment:'test',kind:'notify-test-wallet',transport:'https-fixed-notify',provider:'notify',companyId:'vault-ledger',workspaceId:'workspace-a',integrationId:'n-a',revision:'1',credentialSetId:'ledger-2026'} as const;
 const descriptor={companyId:'vault-ledger',provider:'notify',environment:'test',purpose:'ledger',workspaceId:'workspace-a',secretBinding:'PAY_NOTIFY_TEST_LEDGER_A'};
 it('requires an exact ledger registration beside a vault connection and ignores the retired payment registry',async()=>{
  const {connection}=await registerConnection(db,'vault-ledger','mid-l','L0001'),scope=owner('vault-ledger');
  const env={...vaultEnv(db),PAY_LEDGER_REGISTRY_JSON:JSON.stringify({[ledger.credentialSetId]:descriptor}),PAY_NOTIFY_TEST_LEDGER_A:'local-ledger-fixture'};
  expect(await resolveSnapshots(env,scope,connection,ledger,'new')).toMatchObject({fingerprints:{provider:expect.stringMatching(/^[a-f0-9]{64}$/),ledger:expect.stringMatching(/^[a-f0-9]{64}$/)}});
  for(const patch of [{workspaceId:'other'},{purpose:'payment'},{secretBinding:'AUTH_SECRET'}])await expect(resolveSnapshots({...env,PAY_LEDGER_REGISTRY_JSON:JSON.stringify({[ledger.credentialSetId]:{...descriptor,...patch}})},scope,connection,ledger,'new')).rejects.toMatchObject({status:503});
  // A payment descriptor in the old variable resolves nothing: payment keys come only from the vault.
  const legacy={...vaultEnv(db),PAY_CREDENTIAL_REGISTRY_JSON:JSON.stringify({old:{companyId:'vault-ledger',provider:'toss',environment:'test',purpose:'payment',providerAccountId:'mid-l',secretBinding:'PAY_TOSS_TEST_SECRET_OLD',clientKeyBinding:'PAY_TOSS_TEST_CLIENT_OLD'}}),PAY_TOSS_TEST_SECRET_OLD:'test_sk_FAKEold0001',PAY_TOSS_TEST_CLIENT_OLD:'test_ck_FAKEold0001'};
  expect((await inspectConnection(legacy as never,scope,{...connection,credentialSetId:'old'})).configured).toBe(false);
 });
 it('a registered connection does not open checkout while PAY_EXTERNAL_ACTIONS_ENABLED is off',async()=>{
  const {connection}=await registerConnection(db,'vault-ledger','mid-l','L0002'),scope=owner('vault-ledger');
  const ready={...vaultEnv(db),PAY_LEDGER_REGISTRY_JSON:JSON.stringify({[ledger.credentialSetId]:descriptor}),PAY_NOTIFY_TEST_LEDGER_A:'local-ledger-fixture'};
  const off=new PayApplication({...ready,PAY_EXTERNAL_ACTIONS_ENABLED:'false'},verifiedOk),on=new PayApplication({...ready,PAY_EXTERNAL_ACTIONS_ENABLED:'true'},verifiedOk);
  expect(await off.dispatch({action:'capabilities',scope,connection,ledger})).toMatchObject({ok:true,result:{mode:'unavailable',capabilities:{checkout:false,refund:false}}});
  expect(await off.dispatch({action:'createOrder',scope,operationId:'vault:gate-off',supplyKrw:1000,connection,ledger},allow)).toMatchObject({ok:false,status:503});
  expect(await db.prepare("SELECT COUNT(*) AS n FROM payment_orders WHERE idempotency_key='vault:gate-off'").first('n')).toBe(0);
  expect(await on.dispatch({action:'capabilities',scope,connection,ledger})).toMatchObject({ok:true,result:{mode:'test',capabilities:{checkout:true}}});
 });
});
