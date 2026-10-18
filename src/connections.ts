import type {PayScope,PayEffectAuthority,PaymentConnectionState,PaymentConnectionView,PaymentConnectionStatus,ConnectionSnapshot} from '@devslab-kr/pay-contract';
import {PAYMENT_CONNECTION_HISTORY_MAX,isPaymentConnectionId,isTossMerchantId,isTossTestClientKey,isTossTestSecretKey} from '@devslab-kr/pay-contract';
import type {Env} from './env';
import {PayError,exactKeys,invalid,unavailable} from './domain';
import {checkEffectAuthority} from './effect-authority';
import {connectionAad,credentialFingerprint,readMasterKey,sealCredentials,unsealCredentials,type TossCredentials} from './vault';

/**
 * Company-registered Toss test accounts. Admin sends the keys once (owner, recent sign-in, effect authority);
 * Pay verifies the secret key with one read-only Toss call, seals both keys and keeps every version.
 * Keys never leave Pay: views carry the MID, the client-key hint and the fingerprint only, and so does the
 * audit evidence. Failures are generic PayErrors without values.
 */
export type TossVerification = 'ok'|'rejected'|'unavailable';
export type TossVerifier = (secretKey:string)=>Promise<TossVerification>;
/**
 * The read-only probe: GET /v1/payments/orders/{random order id} on the fixed Toss API. It creates nothing.
 * Toss answers 404 NOT_FOUND_PAYMENT when the secret key is valid (there is no such order) and 401
 * UNAUTHORIZED_KEY or 400 INVALID_API_KEY when it is not (docs.tosspayments.com/reference/error-codes).
 * Toss has no endpoint that names the MID of a key, so the MID is checked on every receipt instead: Pay
 * credits only when the receipt's mId equals the registered MID (domain.ts parseProviderReceipt).
 */
export const verifyTossSecretKey:TossVerifier = async secretKey=>{
 const probe='pay_verify_'+[...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
 let response:Response;
 try{response=await fetch(new Request('https://api.tosspayments.com/v1/payments/orders/'+probe,{method:'GET',redirect:'manual',headers:{authorization:'Basic '+btoa(secretKey+':'),accept:'application/json'},signal:AbortSignal.timeout(10000)}));}
 catch{return 'unavailable';}
 let code:unknown=null;
 try{
  const length=response.headers.get('content-length');
  if(!length||Number(length)<=65536){const body:unknown=await response.json();code=body&&typeof body==='object'?(body as Record<string,unknown>).code:null;}
 }catch{/* a 401 needs no body */}
 return classifyTossProbe(response.status,code);
};
export function classifyTossProbe(status:number,code:unknown):TossVerification{
 if(status===404&&code==='NOT_FOUND_PAYMENT')return 'ok';
 if(status===200)return 'ok';
 if(status===401||(status===400&&code==='INVALID_API_KEY'))return 'rejected';
 return 'unavailable';
}
interface ConnectionRow {id:string;company_id:string;provider:'toss';environment:'test';version:number;status:PaymentConnectionStatus;merchant_id:string;sealed_credentials:string;client_key_hint:string;fingerprint:string;actor_id:string;created_at:string;updated_at:string;revoked_at:string|null}
const conflict=()=>new PayError(409,'payment_connection_conflict','The payment connection changed concurrently.');
const notFound=()=>new PayError(404,'not_found','The payment connection was not found.');
function view(row:ConnectionRow):PaymentConnectionView{
 return {id:row.id,provider:'toss',environment:'test',version:row.version,status:row.status,merchantId:row.merchant_id,clientKeyHint:row.client_key_hint,fingerprint:row.fingerprint,createdAt:row.created_at,revokedAt:row.revoked_at};
}
/** Connection management belongs to the company's administrators, never to a member acting for themselves. */
function companyScope(scope:PayScope){if(scope.access!=='company')throw new PayError(403,'service_access_required','Company payment access is required.');}
function evidence(row:Pick<ConnectionRow,'version'|'merchant_id'|'client_key_hint'|'fingerprint'>,extra:Record<string,unknown>={}){
 return JSON.stringify({provider:'toss',environment:'test',version:row.version,merchantId:row.merchant_id,clientKeyHint:row.client_key_hint,fingerprint:row.fingerprint,...extra});
}
function uniqueConflict(error:unknown):never{if(error instanceof Error&&/UNIQUE constraint failed|payment connection status/i.test(error.message))throw conflict();throw unavailable();}

export async function connectionState(db:D1Database,scope:PayScope):Promise<PaymentConnectionState>{
 companyScope(scope);
 const rows=(await db.prepare('SELECT * FROM payment_connections WHERE company_id=? ORDER BY version DESC LIMIT ?').bind(scope.companyId,PAYMENT_CONNECTION_HISTORY_MAX).all<ConnectionRow>()).results;
 const history=rows.map(view);
 return {companyId:scope.companyId,active:history.find(item=>item.status==='active')??null,history};
}

export async function connectConnection(env:Env,scope:PayScope,raw:Record<string,unknown>,authority:PayEffectAuthority|undefined,verify:TossVerifier,now:()=>number=Date.now):Promise<PaymentConnectionView>{
 companyScope(scope);exactKeys(raw,['action','scope','merchantId','clientKey','secretKey']);
 // Formats first: live, widget and billing keys never reach Toss or the vault.
 const {merchantId,clientKey,secretKey}=raw;
 if(!isTossMerchantId(merchantId)||!isTossTestClientKey(clientKey)||!isTossTestSecretKey(secretKey))throw invalid();
 // Without a master key nothing could be stored, so the keys are not sent to Toss either.
 const master=await readMasterKey(env.PAY_CONNECTION_MASTER_KEY);if(!master)throw unavailable();
 // Verification has its own switch: registering works while PAY_EXTERNAL_ACTIONS_ENABLED keeps checkout off.
 if(env.PAY_CONNECTION_VERIFICATION_ENABLED!=='true')throw unavailable();
 // The version is fixed before the provider call, so two concurrent connects cannot both commit it.
 const version=((await env.DB.prepare('SELECT MAX(version) AS version FROM payment_connections WHERE company_id=?').bind(scope.companyId).first<number|null>('version'))??0)+1;
 await checkEffectAuthority(authority);
 const verified=await verify(secretKey);
 if(verified==='rejected')throw new PayError(400,'payment_credentials_invalid','The provider rejected these credentials.');
 if(verified!=='ok')throw unavailable();
 await checkEffectAuthority(authority);
 const id='pcv_'+crypto.randomUUID().replace(/-/g,''),timestamp=new Date(now()).toISOString(),credentials:TossCredentials={clientKey,secretKey};
 const row:ConnectionRow={id,company_id:scope.companyId,provider:'toss',environment:'test',version,status:'active',merchant_id:merchantId,
  sealed_credentials:await sealCredentials(master,connectionAad(scope.companyId,id,version),credentials),client_key_hint:clientKey.slice(-4),
  fingerprint:await credentialFingerprint(scope.companyId,merchantId,credentials),actor_id:scope.subject,created_at:timestamp,updated_at:timestamp,revoked_at:null};
 try{
  await env.DB.batch([
   env.DB.prepare("UPDATE payment_connections SET status='superseded',updated_at=? WHERE company_id=? AND status='active'").bind(timestamp,scope.companyId),
   env.DB.prepare("INSERT INTO payment_connections(id,company_id,provider,environment,version,status,merchant_id,sealed_credentials,client_key_hint,fingerprint,actor_id,created_at,updated_at) VALUES(?,?,'toss','test',?,'active',?,?,?,?,?,?,?)")
    .bind(id,scope.companyId,version,merchantId,row.sealed_credentials,row.client_key_hint,row.fingerprint,scope.subject,timestamp,timestamp),
   env.DB.prepare("INSERT INTO payment_connection_audit(id,company_id,connection_id,action,actor_id,evidence_json,created_at) VALUES(?,?,?,'connect',?,?,?)")
    .bind(crypto.randomUUID(),scope.companyId,id,scope.subject,evidence(row),timestamp),
  ]);
 }catch(error){uniqueConflict(error);}
 return view(row);
}

export async function revokeConnection(env:Env,scope:PayScope,raw:Record<string,unknown>,authority:PayEffectAuthority|undefined,now:()=>number=Date.now):Promise<PaymentConnectionView>{
 companyScope(scope);exactKeys(raw,['action','scope','connectionId']);
 if(!isPaymentConnectionId(raw.connectionId))throw invalid();
 const target=await env.DB.prepare('SELECT * FROM payment_connections WHERE company_id=? AND id=?').bind(scope.companyId,raw.connectionId).first<ConnectionRow>();
 if(!target)throw notFound();
 if(target.status==='revoked')throw conflict();
 await checkEffectAuthority(authority);
 const timestamp=new Date(now()).toISOString();
 // The audit row is written only by the statement that actually revoked this row, so a lost race leaves no claim.
 let results:D1Result[]=[];
 try{
  results=await env.DB.batch([
   env.DB.prepare("UPDATE payment_connections SET status='revoked',revoked_at=?,updated_at=? WHERE company_id=? AND id=? AND status=?").bind(timestamp,timestamp,scope.companyId,target.id,target.status),
   env.DB.prepare("INSERT INTO payment_connection_audit(id,company_id,connection_id,action,actor_id,evidence_json,created_at) SELECT ?,?,?,'revoke',?,?,? WHERE changes()=1 AND EXISTS(SELECT 1 FROM payment_connections WHERE id=? AND status='revoked' AND revoked_at=?)")
    .bind(crypto.randomUUID(),scope.companyId,target.id,scope.subject,evidence(target,{previousStatus:target.status}),timestamp,target.id,timestamp),
  ]);
 }catch(error){uniqueConflict(error);}
 if(results[0]?.meta.changes!==1||results[1]?.meta.changes!==1)throw conflict();
 return view({...target,status:'revoked',revoked_at:timestamp,updated_at:timestamp});
}

/**
 * Which versions may serve which work:
 * - new: readiness, new orders and inspection need the active version.
 * - continue: an existing order's checkout and confirmation also finish under a superseded version.
 * - settle: lookup reconcile, refund and legacy import of an existing order also run under a revoked
 *   version, so money already taken can still be confirmed or returned.
 */
export type ConnectionUse = 'new'|'continue'|'settle';
export interface ResolvedPayment {secret:string;clientKey:string;fingerprint:string}
export async function resolveConnection(env:Env,scope:PayScope,connection:ConnectionSnapshot,use:ConnectionUse):Promise<ResolvedPayment>{
 if(!isPaymentConnectionId(connection.credentialSetId))throw unavailable();
 const row=await env.DB.prepare('SELECT * FROM payment_connections WHERE company_id=? AND id=?').bind(scope.companyId,connection.credentialSetId).first<ConnectionRow>();
 if(!row||row.merchant_id!==connection.providerAccountId)throw unavailable();
 if((row.status==='revoked'&&use!=='settle')||(row.status==='superseded'&&use==='new'))throw unavailable();
 const master=await readMasterKey(env.PAY_CONNECTION_MASTER_KEY);if(!master)throw unavailable();
 let credentials:TossCredentials;
 try{credentials=await unsealCredentials(master,connectionAad(row.company_id,row.id,row.version),row.sealed_credentials);}catch{throw unavailable();}
 if(!isTossTestClientKey(credentials.clientKey)||!isTossTestSecretKey(credentials.secretKey)||await credentialFingerprint(row.company_id,row.merchant_id,credentials)!==row.fingerprint)throw unavailable();
 return {secret:credentials.secretKey,clientKey:credentials.clientKey,fingerprint:row.fingerprint};
}
