import {PayContractError} from './errors.js';
import {isUtcTimestamp} from './constants.js';

/**
 * A company's own Toss test account, registered from Admin since 0.3.0. Pay keeps the keys in its
 * connection vault (envelope encryption) and never returns them: a connection is only visible as the
 * MID, the last 4 characters of the client key and a fingerprint. Each change is a new version; the
 * newest usable one is `active`, a replaced one `superseded`, a stopped one `revoked`.
 */
export const PAYMENT_CONNECTION_STATUSES = ['active','superseded','revoked'] as const;
export type PaymentConnectionStatus = typeof PAYMENT_CONNECTION_STATUSES[number];
/** Toss general test keys only. Live keys (`live_*`) and widget/billing keys (`test_gck_`, `test_gsk_`) are refused. */
export const TOSS_TEST_CLIENT_KEY_PATTERN = /^test_ck_[A-Za-z0-9_-]{8,192}$/;
export const TOSS_TEST_SECRET_KEY_PATTERN = /^test_sk_[A-Za-z0-9_-]{8,192}$/;
/** The Toss 상점 ID (MID) the keys belong to; every provider receipt's `mId` must equal it. */
export const TOSS_MERCHANT_ID_PATTERN = /^[A-Za-z0-9_-]{2,64}$/;
/** Connection version IDs Pay issues (`pcv_` + 32 lowercase hex). They are the snapshot's `credentialSetId`. */
export const PAYMENT_CONNECTION_ID_PATTERN = /^pcv_[a-f0-9]{32}$/;
export const PAYMENT_CONNECTION_HINT_LENGTH = 4;
export const PAYMENT_CONNECTION_HISTORY_MAX = 50;
export function isTossTestClientKey(value:unknown):value is string{return typeof value==='string'&&TOSS_TEST_CLIENT_KEY_PATTERN.test(value);}
export function isTossTestSecretKey(value:unknown):value is string{return typeof value==='string'&&TOSS_TEST_SECRET_KEY_PATTERN.test(value);}
export function isTossMerchantId(value:unknown):value is string{return typeof value==='string'&&TOSS_MERCHANT_ID_PATTERN.test(value);}
export function isPaymentConnectionId(value:unknown):value is string{return typeof value==='string'&&PAYMENT_CONNECTION_ID_PATTERN.test(value);}

/** What anyone outside Pay sees of one connection version. Never contains a key. */
export interface PaymentConnectionView {
 id:string;provider:'toss';environment:'test';version:number;status:PaymentConnectionStatus;
 merchantId:string;clientKeyHint:string;fingerprint:string;createdAt:string;revokedAt:string|null;
}
/** connectionState: the active version (if any) and every version, newest first. */
export interface PaymentConnectionState {companyId:string;active:PaymentConnectionView|null;history:PaymentConnectionView[]}

function fail(what:string):never{throw new PayContractError('invalid_response',`Pay ${what} response does not match the contract.`);}
function record(value:unknown,what:string):Record<string,unknown>{
 if(typeof value!=='object'||value===null||Array.isArray(value))fail(what);
 return value as Record<string,unknown>;
}
/** connectConnection, revokeConnection, and each history row. Returns only contract fields. */
export function parsePaymentConnectionView(value:unknown):PaymentConnectionView{
 const what='payment connection',v=record(value,what);
 if(!isPaymentConnectionId(v.id)||v.provider!=='toss'||v.environment!=='test'||typeof v.version!=='number'||!Number.isSafeInteger(v.version)||v.version<1)fail(what);
 if(typeof v.status!=='string'||!(PAYMENT_CONNECTION_STATUSES as readonly string[]).includes(v.status)||!isTossMerchantId(v.merchantId))fail(what);
 if(typeof v.clientKeyHint!=='string'||!/^[A-Za-z0-9_-]{4}$/.test(v.clientKeyHint)||typeof v.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(v.fingerprint))fail(what);
 if(!isUtcTimestamp(v.createdAt))fail(what);
 const status=v.status as PaymentConnectionStatus,revokedAt=v.revokedAt;
 if(status==='revoked'?!isUtcTimestamp(revokedAt):revokedAt!==null)fail(what);
 return {id:v.id,provider:'toss',environment:'test',version:v.version,status,merchantId:v.merchantId,clientKeyHint:v.clientKeyHint,fingerprint:v.fingerprint,createdAt:v.createdAt,revokedAt:revokedAt as string|null};
}
/** connectionState. At most one active version, which must also be the newest history row with that status. */
export function parsePaymentConnectionState(value:unknown):PaymentConnectionState{
 const what='payment connection state',v=record(value,what);
 if(typeof v.companyId!=='string'||!v.companyId||!Array.isArray(v.history)||v.history.length>PAYMENT_CONNECTION_HISTORY_MAX)fail(what);
 const history=v.history.map(parsePaymentConnectionView);
 const versions=history.map(item=>item.version);
 if(versions.some((version,index)=>index>0&&version>=versions[index-1]!))fail(what);
 const actives=history.filter(item=>item.status==='active');
 if(actives.length>1)fail(what);
 const active=v.active===null?null:parsePaymentConnectionView(v.active);
 if((active===null)!==(actives.length===0)||(active&&active.id!==actives[0]!.id))fail(what);
 return {companyId:v.companyId,active:active?actives[0]!:null,history};
}
