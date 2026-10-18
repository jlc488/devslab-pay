import type {ConnectionSnapshot,LedgerSnapshot,PayScope,ConnectionInspection} from '@devslab-kr/pay-contract';
import type {Env,LedgerSecretBinding} from './env';
import {canonical,sha256,object,text,exactKeys,validateConnection,validateSnapshots,unavailable} from './domain';
import {resolveConnection,type ConnectionUse,type ResolvedPayment} from './connections';
export type {ResolvedPayment} from './connections';
/**
 * Payment keys come only from the connection vault (connections.ts): `connection.credentialSetId` is a
 * vault version ID and `providerAccountId` its MID. The retired PAY_CREDENTIAL_REGISTRY_JSON is never read.
 * The Notify test-ledger credential stays a server registry until the ledger moves to token exchange:
 * PAY_LEDGER_REGISTRY_JSON is a JSON object keyed by credentialSetId with exactly
 * `{companyId,provider:'notify',environment:'test',purpose:'ledger',workspaceId,secretBinding}`.
 */
export interface LedgerDescriptor {companyId:string;provider:'notify';environment:'test';purpose:'ledger';workspaceId:string;secretBinding:LedgerSecretBinding}
export interface ResolvedLedger {secret:string;fingerprint:string}
export interface ResolvedSnapshots {connection:ConnectionSnapshot;ledger:LedgerSnapshot;provider:ResolvedPayment;ledgerCredential:ResolvedLedger;fingerprints:{provider:string;ledger:string}}
function ledgerEntry(env:Env,id:string):Record<string,unknown>{
 text(id);const raw=env.PAY_LEDGER_REGISTRY_JSON;
 if(!raw||new TextEncoder().encode(raw).length>65536)throw unavailable();
 let value:unknown;try{value=JSON.parse(raw);}catch{throw unavailable();}
 const registry=object(value);if(!Object.hasOwn(registry,id))throw unavailable();return object(registry[id]);
}
function checkLedgerDescriptor(v:Record<string,unknown>,scope:PayScope,l:LedgerSnapshot):LedgerDescriptor{
 exactKeys(v,['companyId','provider','environment','purpose','workspaceId','secretBinding']);
 if(v.companyId!==scope.companyId||v.provider!=='notify'||v.environment!=='test'||v.purpose!=='ledger'||v.workspaceId!==l.workspaceId||!/^PAY_NOTIFY_TEST_LEDGER_[A-Z0-9_]{1,100}$/.test(String(v.secretBinding)))throw unavailable();
 return {...v,secretBinding:text(v.secretBinding) as LedgerSecretBinding} as LedgerDescriptor;
}
export async function resolvePayment(env:Env,scope:PayScope,value:ConnectionSnapshot,use:ConnectionUse):Promise<ResolvedPayment>{
 return resolveConnection(env,scope,validateConnection(scope,value),use);
}
async function resolveLedger(env:Env,scope:PayScope,ledger:LedgerSnapshot):Promise<ResolvedLedger>{
 const descriptor=checkLedgerDescriptor(ledgerEntry(env,ledger.credentialSetId),scope,ledger),secret=env[descriptor.secretBinding];
 if(typeof secret!=='string'||!secret.trim()||secret.length>4096||/[\r\n]/.test(secret))throw unavailable();
 if(ledger.transport==='notify-service'&&!env.NOTIFY_LOCAL_SERVICE)throw unavailable();
 return {secret,fingerprint:await sha256(canonical({descriptor,secret}))};
}
export async function inspectConnection(env:Env,scope:PayScope,connection:ConnectionSnapshot):Promise<ConnectionInspection>{
 const c=validateConnection(scope,connection);
 try{const result=await resolvePayment(env,scope,c,'new');return {companyId:scope.companyId,connectionId:c.id,revision:c.revision,configured:true,fingerprint:result.fingerprint,reasonCode:null};}
 catch{return {companyId:scope.companyId,connectionId:c.id,revision:c.revision,configured:false,fingerprint:null,reasonCode:'payment_unavailable'};}
}
export async function resolveSnapshots(env:Env,scope:PayScope,connection:ConnectionSnapshot,ledger:LedgerSnapshot,use:ConnectionUse):Promise<ResolvedSnapshots>{
 const snapshots=validateSnapshots(scope,connection,ledger);
 let provider:ResolvedPayment,ledgerCredential:ResolvedLedger;
 try{[provider,ledgerCredential]=await Promise.all([resolvePayment(env,scope,snapshots.connection,use),resolveLedger(env,scope,snapshots.ledger)]);}catch{throw unavailable();}
 return {...snapshots,provider,ledgerCredential,fingerprints:{provider:provider.fingerprint,ledger:ledgerCredential.fingerprint}};
}
