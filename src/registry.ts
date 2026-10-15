import type {ConnectionSnapshot,LedgerSnapshot,PayScope,ConnectionInspection} from './contracts';
import type {CredentialEnv as Env,PaymentSecretBinding,PaymentClientBinding,LedgerSecretBinding} from './env';
import {canonical,sha256,object,text,exactKeys,validateConnection,validateSnapshots,unavailable} from './domain';
export interface PaymentDescriptor {companyId:string;provider:'toss';environment:'test';purpose:'payment';providerAccountId:string;secretBinding:PaymentSecretBinding;clientKeyBinding:PaymentClientBinding}
export interface LedgerDescriptor {companyId:string;provider:'notify';environment:'test';purpose:'ledger';workspaceId:string;secretBinding:LedgerSecretBinding}
export interface ResolvedPayment {secret:string;clientKey:string;fingerprint:string}
export interface ResolvedLedger {secret:string;fingerprint:string}
export interface ResolvedSnapshots {connection:ConnectionSnapshot;ledger:LedgerSnapshot;provider:ResolvedPayment;ledgerCredential:ResolvedLedger;fingerprints:{provider:string;ledger:string}}
function entry(env:Env,id:string):Record<string,unknown>{
 text(id);const raw=env.PAY_CREDENTIAL_REGISTRY_JSON;
 if(!raw||new TextEncoder().encode(raw).length>65536)throw unavailable();
 let value:unknown;try{value=JSON.parse(raw);}catch{throw unavailable();}
 const registry=object(value);if(!Object.hasOwn(registry,id))throw unavailable();return object(registry[id]);
}
export function registeredReferences(env:Env,scope:PayScope,connection:ConnectionSnapshot,ledger:LedgerSnapshot){
 const snapshots=validateSnapshots(scope,connection,ledger);
 const p=entry(env,connection.credentialSetId),l=entry(env,ledger.credentialSetId);
 checkPaymentDescriptor(p,scope,connection);checkLedgerDescriptor(l,scope,ledger);
 return snapshots;
}
function checkPaymentDescriptor(v:Record<string,unknown>,scope:PayScope,c:ConnectionSnapshot):PaymentDescriptor{
 exactKeys(v,['companyId','provider','environment','purpose','providerAccountId','secretBinding','clientKeyBinding']);
 if(v.companyId!==scope.companyId||v.provider!=='toss'||v.environment!=='test'||v.purpose!=='payment'||v.providerAccountId!==c.providerAccountId)throw unavailable();
 const secretBinding=text(v.secretBinding),clientKeyBinding=text(v.clientKeyBinding),match=/^PAY_TOSS_TEST_SECRET_([A-Z0-9_]{1,100})$/.exec(secretBinding);
 if(!match||clientKeyBinding!=='PAY_TOSS_TEST_CLIENT_'+match[1])throw unavailable();
 return {...v,secretBinding:secretBinding as PaymentSecretBinding,clientKeyBinding:clientKeyBinding as PaymentClientBinding} as PaymentDescriptor;
}
function checkLedgerDescriptor(v:Record<string,unknown>,scope:PayScope,l:LedgerSnapshot):LedgerDescriptor{
 exactKeys(v,['companyId','provider','environment','purpose','workspaceId','secretBinding']);
 if(v.companyId!==scope.companyId||v.provider!=='notify'||v.environment!=='test'||v.purpose!=='ledger'||v.workspaceId!==l.workspaceId||!/^PAY_NOTIFY_TEST_LEDGER_[A-Z0-9_]{1,100}$/.test(String(v.secretBinding)))throw unavailable();
 return {...v,secretBinding:text(v.secretBinding) as LedgerSecretBinding} as LedgerDescriptor;
}
export async function resolvePayment(env:Env,scope:PayScope,value:ConnectionSnapshot):Promise<ResolvedPayment>{
 const connection=validateConnection(scope,value),descriptor=checkPaymentDescriptor(entry(env,connection.credentialSetId),scope,connection);
 const secret=env[descriptor.secretBinding],clientKey=env[descriptor.clientKeyBinding];
 if(typeof secret!=='string'||!/^test_sk_[A-Za-z0-9_-]+$/.test(secret)||typeof clientKey!=='string'||!/^test_ck_[A-Za-z0-9_-]+$/.test(clientKey))throw unavailable();
 return {secret,clientKey,fingerprint:await sha256(canonical({descriptor,secret,clientKey}))};
}
async function resolveLedger(env:Env,scope:PayScope,ledger:LedgerSnapshot):Promise<ResolvedLedger>{
 const descriptor=checkLedgerDescriptor(entry(env,ledger.credentialSetId),scope,ledger),secret=env[descriptor.secretBinding];
 if(typeof secret!=='string'||!secret.trim()||secret.length>4096||/[\r\n]/.test(secret))throw unavailable();
 if(ledger.transport==='notify-service'&&!env.NOTIFY_LOCAL_SERVICE)throw unavailable();
 return {secret,fingerprint:await sha256(canonical({descriptor,secret}))};
}
export async function inspectConnection(env:Env,scope:PayScope,connection:ConnectionSnapshot):Promise<ConnectionInspection>{
 const c=validateConnection(scope,connection);
 try{const result=await resolvePayment(env,scope,c);return {companyId:scope.companyId,connectionId:c.id,revision:c.revision,configured:true,fingerprint:result.fingerprint,reasonCode:null};}
 catch{return {companyId:scope.companyId,connectionId:c.id,revision:c.revision,configured:false,fingerprint:null,reasonCode:'payment_unavailable'};}
}
export async function resolveSnapshots(env:Env,scope:PayScope,connection:ConnectionSnapshot,ledger:LedgerSnapshot):Promise<ResolvedSnapshots>{
 const snapshots=validateSnapshots(scope,connection,ledger);
 let provider:ResolvedPayment,ledgerCredential:ResolvedLedger;
 try{[provider,ledgerCredential]=await Promise.all([resolvePayment(env,scope,snapshots.connection),resolveLedger(env,scope,snapshots.ledger)]);}catch{throw unavailable();}
 return {...snapshots,provider,ledgerCredential,fingerprints:{provider:provider.fingerprint,ledger:ledgerCredential.fingerprint}};
}
