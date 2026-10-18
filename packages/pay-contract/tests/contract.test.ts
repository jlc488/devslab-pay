import {describe,expect,it} from 'vitest';
import {
 PayContractError,canonicalJson,importDigest,parseCapabilities,parseCheckoutCaptureResult,parseCheckoutPreparation,parseOrderPage,parsePublicOrder,
 CHECKOUT_RETURN_REGISTRY,DEFAULT_CHECKOUT_RETURNS,RECHARGE_MAXIMUM_SUPPLY_KRW,calculateOrderRecharge,calculateRecharge,checkoutReturnUrl,isCheckoutReturn,resolveCheckoutReturn,
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
  expect(parseCheckoutCaptureResult({returnTarget:'admin',companyId:'company-a',id:'order-1',result:'unknown'})).toEqual({returnTarget:'admin',returnTo:{service:'admin',path:'/payments'},companyId:'company-a',id:'order-1',result:'unknown'});
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

describe('checkout return registry (0.2.0): the redirect comes only from known services and paths',()=>{
 const invalidInput={name:'PayContractError',code:'invalid_input'};
 const capture={returnTarget:'contract',companyId:'company-a',id:'order-1',result:'captured'} as const;
 it('builds exactly the redirects Admin used before 0.2.0, for an explicit entry and for a bare returnTarget',()=>{
  expect(checkoutReturnUrl({...capture,returnTo:{service:'contract',path:'/notify'}})).toBe('https://contract.devslab.kr/notify?paymentOrder=order-1&paymentResult=captured');
  expect(checkoutReturnUrl(capture)).toBe('https://contract.devslab.kr/notify?paymentOrder=order-1&paymentResult=captured');
  expect(checkoutReturnUrl({returnTarget:'admin',companyId:'company-a',id:'order-1',result:'failed'})).toBe('https://admin.devslab.kr/payments?companyId=company-a&testOrderId=order-1&paymentResult=failed');
  expect(resolveCheckoutReturn('admin')).toEqual({service:'admin',path:'/payments'});
 });
 const attempts:[string,unknown][]=[
  ['an absolute URL',{service:'contract',path:'https://evil.example/notify'}],
  ['a protocol-relative URL',{service:'contract',path:'//evil.example/notify'}],
  ['a backslash host',{service:'contract',path:'/\\evil.example'}],
  ['an encoded slash',{service:'contract',path:'%2Fnotify'}],
  ['an encoded traversal',{service:'contract',path:'/notify%2F..%2Fadmin'}],
  ['a path traversal',{service:'contract',path:'/notify/../payments'}],
  ['a case variant',{service:'contract',path:'/Notify'}],
  ['a query suffix',{service:'contract',path:'/notify?next=//evil.example'}],
  ['a fragment suffix',{service:'contract',path:'/notify#@evil.example'}],
  ['another service path',{service:'contract',path:'/payments'}],
  ['an unknown service',{service:'evil.example',path:'/notify'}],
  ['an inherited service name',{service:'constructor',path:'/notify'}],
  ['an extra origin field',{service:'contract',path:'/notify',origin:'https://evil.example'}],
  ['a raw URL string','https://contract.devslab.kr/notify'],
  ['a prototype-less object',Object.assign(Object.create(null),{service:'contract',path:'/notify'})],
 ];
 it.each(attempts)('rejects %s as a return entry',(_,returnTo)=>{
  expect(isCheckoutReturn(returnTo)).toBe(false);
  expect(()=>resolveCheckoutReturn('contract',returnTo)).toThrow(expect.objectContaining(invalidInput));
  expect(()=>checkoutReturnUrl({...capture,returnTo} as never)).toThrow(expect.objectContaining(invalidInput));
 });
 it('rejects a returnTo of another service than returnTarget and an unknown returnTarget',()=>{
  expect(()=>resolveCheckoutReturn('contract',{service:'admin',path:'/payments'})).toThrow(expect.objectContaining(invalidInput));
  for(const target of ['https://evil.example','//evil.example','__proto__','toString'])expect(()=>resolveCheckoutReturn(target)).toThrow(expect.objectContaining(invalidInput));
 });
 it.each([
  ['a company id with a host',{companyId:'evil.example'}],
  ['an order id with a slash',{id:'../admin'}],
  ['an order id with a query',{id:'order?next=//evil.example'}],
  ['an encoded order id',{id:'order%2F1'}],
  ['an unknown result',{result:'paid'}],
 ])('refuses to build a redirect with %s',(_,patch)=>expect(()=>checkoutReturnUrl({...capture,...patch} as never)).toThrow(expect.objectContaining(invalidInput)));
 it('cannot be retargeted at runtime',()=>{
  expect(()=>{(CHECKOUT_RETURN_REGISTRY.contract as {origin:string}).origin='https://evil.example';}).toThrow(TypeError);
  expect(()=>{(CHECKOUT_RETURN_REGISTRY.contract.paths as unknown as string[]).push('//evil.example');}).toThrow(TypeError);
  expect(()=>{(DEFAULT_CHECKOUT_RETURNS.admin as {path:string}).path='//evil.example';}).toThrow(TypeError);
  expect(checkoutReturnUrl(capture)).toBe('https://contract.devslab.kr/notify?paymentOrder=order-1&paymentResult=captured');
 });
 it('parses a capture result with or without returnTo and rejects an entry outside the registry',()=>{
  expect(parseCheckoutCaptureResult({...capture,returnTo:{service:'contract',path:'/notify'}})).toEqual({...capture,returnTo:{service:'contract',path:'/notify'}});
  expect(parseCheckoutCaptureResult({returnTarget:'admin',companyId:'company-a',id:'order-1',result:'unknown'})).toEqual({returnTarget:'admin',returnTo:{service:'admin',path:'/payments'},companyId:'company-a',id:'order-1',result:'unknown'});
  for(const returnTo of [{service:'contract',path:'//evil.example'},{service:'admin',path:'/payments'},'https://contract.devslab.kr/notify'])
   expect(()=>parseCheckoutCaptureResult({...capture,returnTo})).toThrow(expect.objectContaining(invalidResponse));
 });
});

describe('order amounts (0.2.0)',()=>{
 it('caps one new order at RECHARGE_MAXIMUM_SUPPLY_KRW while calculateRecharge keeps its 0.1.0 range',()=>{
  expect(calculateOrderRecharge(RECHARGE_MAXIMUM_SUPPLY_KRW)).toEqual({supplyKrw:1000000,vatKrw:100000,totalKrw:1100000,walletCreditKrw:1000000,currency:'KRW'});
  for(const value of [RECHARGE_MAXIMUM_SUPPLY_KRW+1000,1500,999,'1000'])expect(()=>calculateOrderRecharge(value)).toThrow(expect.objectContaining({code:'invalid_input'}));
  expect(calculateRecharge(RECHARGE_MAXIMUM_SUPPLY_KRW+1000).supplyKrw).toBe(1001000);
 });
});

describe('payment connections (0.3.0): only the MID, a 4-character hint and a fingerprint cross the wire',()=>{
 const view={id:'pcv_'+'a'.repeat(32),provider:'toss',environment:'test',version:2,status:'active',merchantId:'tvivarepublica',clientKeyHint:'0001',fingerprint:'b'.repeat(64),createdAt:'2026-10-18T00:00:00.000Z',revokedAt:null};
 const old={...view,id:'pcv_'+'c'.repeat(32),version:1,status:'revoked',revokedAt:'2026-10-18T01:00:00.000Z'};
 it('accepts test keys only and refuses live, widget and billing variants',async()=>{
  const {isTossTestClientKey,isTossTestSecretKey,isTossMerchantId}=await import('../src/index.js');
  expect(isTossTestClientKey('test_ck_FAKEclient0001')).toBe(true);expect(isTossTestSecretKey('test_sk_FAKEsecret0001')).toBe(true);
  for(const key of ['live_ck_FAKEclient0001','test_gck_FAKEclient0001','test_ck_','test_ck_ FAKE0001'])expect(isTossTestClientKey(key)).toBe(false);
  for(const key of ['live_sk_FAKEsecret0001','test_gsk_FAKEsecret0001','test_sk_','test_ck_FAKEclient0001'])expect(isTossTestSecretKey(key)).toBe(false);
  for(const mid of ['tvivarepublica','mid_01-a'])expect(isTossMerchantId(mid)).toBe(true);
  for(const mid of ['x','mid with space','m'.repeat(65),'https://x'])expect(isTossMerchantId(mid)).toBe(false);
 });
 it('parses views and state, drops unknown fields and rejects any key-shaped extra or inconsistent state',async()=>{
  const {parsePaymentConnectionView,parsePaymentConnectionState}=await import('../src/index.js');
  expect(parsePaymentConnectionView({...view,secretKey:'test_sk_FAKEsecret0001'})).toEqual(view);
  expect(parsePaymentConnectionState({companyId:'company-a',active:view,history:[view,old]})).toEqual({companyId:'company-a',active:view,history:[view,old]});
  for(const bad of [{...view,clientKeyHint:'test_ck_FAKEclient0001'},{...view,status:'revoked'},{...old,revokedAt:null},{...view,id:'toss-registry-id'},{...view,environment:'live'}])
   expect(()=>parsePaymentConnectionView(bad)).toThrow(expect.objectContaining(invalidResponse));
  for(const bad of [{companyId:'company-a',active:null,history:[view]},{companyId:'company-a',active:view,history:[old,view]},{companyId:'company-a',active:view,history:[view,{...old,status:'active',revokedAt:null}]}])
   expect(()=>parsePaymentConnectionState(bad)).toThrow(expect.objectContaining(invalidResponse));
 });
});
