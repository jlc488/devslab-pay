import {describe,it,expect} from 'vitest';
import {withEffectAuthority,checkEffectAuthority} from '../src/effect-authority';
import type {PayEffectAuthority} from '../src/contracts';
describe('effect authority boundary ordering (no network)',()=>{
 it.each(['missing','false','throw','closed'])('denies %s authority before invoking any effect',async kind=>{
  let calls=0;const authority:PayEffectAuthority|undefined=kind==='missing'?undefined:{check:async()=>{if(kind==='throw')throw Error('private auth failure');return false;}};
  await expect(withEffectAuthority(authority,async()=>{calls++;return 'forbidden';})).rejects.toMatchObject({status:expect.any(Number)});
  expect(calls).toBe(0);
 });
 it('accepts exact true only and reevaluates a later revoked decision',async()=>{let allowed=true,calls=0;const authority={check:async()=>allowed};expect(await withEffectAuthority(authority,async()=>++calls)).toBe(1);allowed=false;await expect(withEffectAuthority(authority,async()=>++calls)).rejects.toMatchObject({status:403});expect(calls).toBe(1);await expect(checkEffectAuthority({check:async()=>1 as any})).rejects.toMatchObject({status:403});});
});
