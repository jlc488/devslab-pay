import type {PayEffectAuthority} from './contracts';
import {PayError} from './domain';
export class EffectAuthorityError extends PayError {}
export async function checkEffectAuthority(authority?:PayEffectAuthority):Promise<void>{
 if(!authority||typeof authority.check!=='function')throw new EffectAuthorityError(503,'effect_authority_required','Current payment authority is unavailable.');
 let allowed:unknown;
 try{allowed=await authority.check();}catch{throw new EffectAuthorityError(503,'effect_authority_unavailable','Current payment authority is unavailable.');}
 if(allowed!==true)throw new EffectAuthorityError(403,'effect_authority_denied','Current payment authority does not permit this action.');
}
export async function withEffectAuthority<T>(authority:PayEffectAuthority|undefined,effect:()=>Promise<T>):Promise<T>{
 await checkEffectAuthority(authority);return effect();
}
