import {canonicalJson,sha256Hex} from '@devslab-kr/pay-contract';
/**
 * Envelope encryption for company Toss test keys (same scheme as Notify's provider connection vault).
 * A random 32-byte data key encrypts `{clientKey, secretKey}` with AES-256-GCM; the data key is wrapped with
 * AES-256-GCM under the Secrets Store master key. Both layers use the additional data
 * `pay-connection:v1:<companyId>:<connectionId>:<version>`, so a sealed blob opens only for its own row.
 * Format: `m1.<wrapIv>.<wrappedKey>.<iv>.<ciphertext>` (base64url); `m1` names the master-key version.
 * Nothing here logs, and errors never carry key material.
 */
export interface TossCredentials {clientKey:string;secretKey:string}
export interface MasterKey {version:'m1';key:CryptoKey}
/** A Secrets Store binding, or a plain string in local tests. */
export type RuntimeSecret = string|{get():Promise<string>};
const encoder=new TextEncoder();
function toBase64Url(bytes:Uint8Array):string{let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function fromBase64Url(value:string):Uint8Array{
 if(!/^[A-Za-z0-9_-]+$/.test(value))throw new Error('Invalid envelope encoding');
 const binary=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4));
 return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
export function connectionAad(companyId:string,connectionId:string,version:number):string{return `pay-connection:v1:${companyId}:${connectionId}:${version}`;}
/** null when the master key is missing, unreadable or not exactly 32 bytes. Never throws. */
export async function readMasterKey(secret:RuntimeSecret|undefined):Promise<MasterKey|null>{
 try{
  const value=typeof secret==='string'?secret:secret&&typeof secret.get==='function'?await secret.get():null;
  if(typeof value!=='string'||!value.trim())return null;
  const raw=fromBase64Url(value.trim());if(raw.byteLength!==32)return null;
  return {version:'m1',key:await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt'])};
 }catch{return null;}
}
export async function sealCredentials(master:MasterKey,aad:string,credentials:TossCredentials):Promise<string>{
 const additionalData=encoder.encode(aad),dataKeyBytes=crypto.getRandomValues(new Uint8Array(32));
 const dataKey=await crypto.subtle.importKey('raw',dataKeyBytes,'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12)),wrapIv=crypto.getRandomValues(new Uint8Array(12));
 const plaintext=encoder.encode(JSON.stringify({clientKey:credentials.clientKey,secretKey:credentials.secretKey}));
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData},dataKey,plaintext));
 const wrapped=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:wrapIv,additionalData},master.key,dataKeyBytes));
 dataKeyBytes.fill(0);plaintext.fill(0);
 return [master.version,toBase64Url(wrapIv),toBase64Url(wrapped),toBase64Url(iv),toBase64Url(ciphertext)].join('.');
}
/** Throws on any mismatch: format, master-key version, another row's AAD, tampering or another master key. */
export async function unsealCredentials(master:MasterKey,aad:string,sealed:string):Promise<TossCredentials>{
 const segments=sealed.split('.');
 if(segments.length!==5||segments[0]!==master.version)throw new Error('Unsupported sealed credential format');
 const [wrapIv,wrapped,iv,ciphertext]=segments.slice(1).map(fromBase64Url) as [Uint8Array,Uint8Array,Uint8Array,Uint8Array];
 const additionalData=encoder.encode(aad);
 const dataKeyBytes=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:wrapIv,additionalData},master.key,wrapped));
 if(dataKeyBytes.byteLength!==32)throw new Error('Invalid data key');
 const dataKey=await crypto.subtle.importKey('raw',dataKeyBytes,'AES-GCM',false,['decrypt']);dataKeyBytes.fill(0);
 const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData},dataKey,ciphertext);
 const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(plaintext));
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid credential payload');
 const {clientKey,secretKey}=value as Record<string,unknown>;
 if(typeof clientKey!=='string'||typeof secretKey!=='string'||!clientKey||!secretKey)throw new Error('Invalid credential payload');
 return {clientKey,secretKey};
}
/** The only identity of key material Pay exposes: SHA-256 over the company, MID and both keys. */
export function credentialFingerprint(companyId:string,merchantId:string,credentials:TossCredentials):Promise<string>{
 return sha256Hex(canonicalJson({provider:'toss',environment:'test',companyId,merchantId,clientKey:credentials.clientKey,secretKey:credentials.secretKey}));
}
