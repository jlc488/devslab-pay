import {CHECKOUT_STATE_PATTERN} from './constants.js';
import {PayContractError} from './errors.js';
import type {ConnectionSnapshot,LedgerSnapshot,LegacyPaymentOrder} from './types.js';
/**
 * Pay's canonical JSON: object keys sorted by UTF-16 code units, no whitespace, arrays in order.
 * Only null, strings, booleans, finite numbers, arrays and plain objects are representable; anything
 * else (undefined, NaN, Infinity, bigint, functions, symbols), at any depth, throws `invalid_input`.
 * A property whose value is `undefined` is therefore an error, not an omitted key: omit the key.
 */
export function canonicalJson(value:unknown):string{
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJson((value as Record<string,unknown>)[k])).join(',')+'}';
 throw new PayContractError('invalid_input','The value has no canonical JSON form.');
}
/** Lowercase hex SHA-256 of the UTF-8 encoding of `value`. */
export async function sha256Hex(value:string):Promise<string>{
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('');
}
/** The frozen legacy snapshot an importLegacy command carries, without its digest. */
export interface ImportDigestInput {migrationId:string;generation:string;order:LegacyPaymentOrder;connection:ConnectionSnapshot;ledger:LedgerSnapshot}
/**
 * `digest` of importLegacy (and of the OwnershipFence that follows it): sha256Hex(canonicalJson(input)).
 * Pay recomputes it from the received command and rejects a mismatch with `immutable_conflict`.
 */
export async function importDigest(input:ImportDigestInput):Promise<string>{return sha256Hex(canonicalJson(input));}
/** `stateHash` of checkoutCaptureStatus for a checkout state; throws `invalid_input` for a malformed state. */
export async function checkoutStateHash(state:string):Promise<string>{
 if(typeof state!=='string'||!CHECKOUT_STATE_PATTERN.test(state))throw new PayContractError('invalid_input','The checkout state is invalid.');
 return sha256Hex(state);
}
