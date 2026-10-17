import {describe,expect,it} from 'vitest';
import {
 PayContractError,canonicalJson,importDigest,parseCapabilities,parseCheckoutCaptureResult,parseCheckoutPreparation,parseOrderPage,parsePublicOrder,
} from '../src/index.js';
import {importFixture} from './fixture.js';

const invalidResponse={name:'PayContractError',code:'invalid_response'};
const order={mode:'test',purpose:'messaging_recharge',id:'order-1',companyId:'company-a',orderId:'test_order-1',operationId:'recharge:1',supplyKrw:1000,vatKrw:100,totalKrw:1100,currency:'KRW',state:'created',createdAt:'2026-10-15T00:00:00.000Z',updatedAt:'2026-10-15T00:00:00.000Z'};
const state='A'.repeat(42)+'_';
const preparation={companyId:'company-a',id:'order-1',mode:'test',provider:'toss',kind:'general-test',clientKey:'test_ck_fixture',customerKey:'pay_'+'0'.repeat(32),orderId:'test_order-1',amount:{currency:'KRW',value:1100},orderName:'DevsLab 문자 충전 테스트',successUrl:'https://admin.devslab.kr/api/payments/callback/success?state='+state,failUrl:'https://admin.devslab.kr/api/payments/callback/fail?state='+state,expiresAt:'2026-10-15T00:10:00.000Z'};
const capabilities={companyId:'company-a',mode:'test',provider:'toss',capabilities:{read:true,checkout:true,refund:true},pricing:{minimumSupplyKrw:1000,stepSupplyKrw:1000,vatRatePercent:10,vatIncluded:false,unitPriceKrw:100},reasonCode:null};
const pinned='8a55ffde631a64385e90707a70cea8125568c5582deef5c766affd42e3cb5454';

describe('import digest (cross-service: Admin computes it, Pay recomputes and compares)',()=>{
 it('is pinned for a frozen legacy snapshot regardless of key insertion order',async()=>{
  expect(await importDigest(importFixture)).toBe(pinned);
  const reordered=Object.fromEntries(Object.entries(importFixture).reverse()) as typeof importFixture;
  expect(await importDigest(reordered)).toBe(pinned);
 });
 it('rejects values without a canonical form instead of omitting them (an undefined property is not an absent key)',async()=>{
  for(const order of [{...importFixture.order,provider_refund_id:undefined},{...importFixture.order,revision:Number.NaN}])
   await expect(importDigest({...importFixture,order} as unknown as typeof importFixture)).rejects.toMatchObject({name:'PayContractError',code:'invalid_input'});
  expect(()=>canonicalJson({a:Infinity})).toThrow(PayContractError);
 });
});

describe('response parsers',()=>{
 it('return only contract fields from valid responses',()=>{
  expect(parsePublicOrder({...order,payment_key:'private'})).toEqual(order);
  expect(parseOrderPage({items:[order],nextCursor:'eyJpZCI6IngifQ'})).toEqual({items:[order],nextCursor:'eyJpZCI6IngifQ'});
  expect(parseCapabilities({...capabilities,secret:'x'})).toEqual(capabilities);
  expect(parseCapabilities({...capabilities,mode:'unavailable',provider:null,capabilities:{read:true,checkout:false,refund:false},reasonCode:'payment_unavailable'})).toMatchObject({mode:'unavailable',provider:null});
  expect(parseCheckoutPreparation(preparation)).toEqual(preparation);
  expect(parseCheckoutCaptureResult({returnTarget:'admin',companyId:'company-a',id:'order-1',result:'unknown'})).toEqual({returnTarget:'admin',companyId:'company-a',id:'order-1',result:'unknown'});
 });
 it.each([
  ['order amounts that Pay never charges',{...order,supplyKrw:1500,vatKrw:150,totalKrw:1650}],
  ['an order total that is not supply plus VAT',{...order,totalKrw:1000}],
  ['an unknown order state',{...order,state:'paid'}],
  ['a live order',{...order,mode:'live'}],
  ['a timestamp without milliseconds',{...order,createdAt:'2026-10-15T00:00:00Z'}],
  ['control characters in an identifier',{...order,id:'order\n1'}],
 ])('reject %s',(_,value)=>expect(()=>parsePublicOrder(value)).toThrow(expect.objectContaining(invalidResponse)));
 it('reject oversized pages and malformed cursors',()=>{
  expect(()=>parseOrderPage({items:Array(51).fill(order),nextCursor:null})).toThrow(expect.objectContaining(invalidResponse));
  expect(()=>parseOrderPage({items:[],nextCursor:'not a cursor'})).toThrow(expect.objectContaining(invalidResponse));
 });
 it.each([
  ['changed pricing',{...capabilities,pricing:{...capabilities.pricing,unitPriceKrw:90}}],
  ['test mode without the provider',{...capabilities,provider:null}],
  ['unavailable mode with a provider',{...capabilities,mode:'unavailable'}],
  ['a reason code outside the code alphabet',{...capabilities,reasonCode:'Payment unavailable'}],
 ])('reject capabilities with %s',(_,value)=>expect(()=>parseCapabilities(value)).toThrow(expect.objectContaining(invalidResponse)));
 it.each([
  ['a foreign callback origin',{...preparation,successUrl:'https://evil.example/api/payments/callback/success?state='+state}],
  ['an extra callback parameter',{...preparation,failUrl:preparation.failUrl+'&next=/'}],
  ['different success and fail states',{...preparation,failUrl:'https://admin.devslab.kr/api/payments/callback/fail?state='+'B'.repeat(43)}],
  ['a 42-character state',{...preparation,successUrl:preparation.successUrl.slice(0,-1),failUrl:preparation.failUrl.slice(0,-1)}],
  ['a live client key',{...preparation,clientKey:'live_ck_fixture'}],
  ['an amount Pay never charges',{...preparation,amount:{currency:'KRW',value:1000}}],
  ['another order name',{...preparation,orderName:'Other'}],
 ])('reject checkout preparation with %s',(_,value)=>expect(()=>parseCheckoutPreparation(value)).toThrow(expect.objectContaining(invalidResponse)));
 it('never echo response values in the error',()=>{
  expect(()=>parsePublicOrder({...order,id:'secret-value\u0000'})).toThrow(expect.objectContaining({message:expect.not.stringContaining('secret-value')}));
 });
});
