import {describe,it,expect,vi} from 'vitest';
import {publicFetch,validatePolicy} from '../src/policy';
const policy={site:'pay',slug:'terms',revision:1,title:'<script>title</script>',description:'  preserved  ',sections:[{title:'Title',paragraphs:['<img src=x onerror=alert(1)>','Line 1\nLine 2']}],publishedAt:'2026-10-15T00:00:00.000Z',effectiveAt:'2026-10-15'};
const envelope=()=>({schemaVersion:2,requestedLocale:'ko',locale:'ko',fallback:false,settingsRevision:0,defaultLocale:'ko',supportedLocales:['ko','en'],document:structuredClone(policy),translation:{sourceLocale:'ko',sourceRevision:2,currentSourceRevision:2,needsUpdate:false}});
async function serve(value:unknown,path='/terms') {return publicFetch(new Request('https://pay.invalid'+path),{ADMIN_POLICIES:{fetch:async()=>Response.json(value)}});}
describe('public policy exception',()=>{
 it('keeps auth/RPC and every unknown public surface private',async()=>{for(const path of ['/','/rpc','/api/orders','/auth','/terms/'])expect((await publicFetch(new Request('https://pay.invalid'+path),{})).status).toBe(404);});
 it('fails unavailable without legal seed when unconfigured',async()=>{const r=await publicFetch(new Request('https://pay.invalid/terms'),{});expect(r.status).toBe(503);expect(await r.text()).toContain('unavailable');});
 it('fetches only fixed Admin source, sends no credentials and escapes all text',async()=>{let seen:Request|undefined;const env={ADMIN_POLICIES:{fetch:async(input:Request)=>{seen=input;return Response.json(envelope());}}};const r=await publicFetch(new Request('https://pay.invalid/terms?evil=https://evil.invalid',{headers:{cookie:'session=private',authorization:'Bearer private'}}),env);expect(r.status).toBe(200);expect(seen?.url).toBe('https://admin.devslab.kr/api/public/policies/v2/pay/terms');expect(seen?.headers.has('cookie')).toBe(false);expect(seen?.headers.has('authorization')).toBe(false);expect(seen?.redirect).toBe('manual');const html=await r.text();expect(html).toContain('&lt;script&gt;title&lt;/script&gt;');expect(html).toContain('&lt;img');expect(html).toContain('  preserved  ');expect(html).not.toContain('<img');expect(r.headers.get('cache-control')).toBe('no-store');});
 it('rejects redirect, unpublished, wrong schema, invalid dates and UTF8 overflow',async()=>{const cases=[new Response(null,{status:302,headers:{location:'https://evil.invalid'}}),new Response(null,{status:404}),Response.json({...policy,extra:'x'}),Response.json({...policy,effectiveAt:'2026-02-31'}),Response.json({...policy,revision:1.5}),Response.json({...policy,sections:[{title:'x',paragraphs:['가'.repeat(4000),'가'.repeat(4000),'가'.repeat(4000),'가'.repeat(4000),'가'.repeat(4000),'가'.repeat(4000)]}]})];for(const response of cases){const r=await publicFetch(new Request('https://pay.invalid/terms'),{ADMIN_POLICIES:{fetch:async()=>response}});expect(r.status).toBe(503);}});
 it('returns no HEAD body and rejects policy POST',async()=>{const env={ADMIN_POLICIES:{fetch:async()=>Response.json(envelope())}};const r=await publicFetch(new Request('https://pay.invalid/terms',{method:'HEAD'}),env);expect(r.status).toBe(200);expect(await r.text()).toBe('');expect((await publicFetch(new Request('https://pay.invalid/terms',{method:'POST'}),env)).status).toBe(405);});
});

describe('public policy v2 locales',()=>{
 it('uses the configured central default when lang is omitted',async()=>{
  const value={...envelope(),requestedLocale:'ja',locale:'ja',defaultLocale:'ja',supportedLocales:['ko','en','ja']};
  const r=await serve(value);expect(r.status).toBe(200);const html=await r.text();expect(html).toContain('<html lang="ja">');expect(html).toContain('Default language: ja');expect(html).toContain('href="/terms?lang=ja"');
 });
 it('canonicalizes explicit BCP47 requests and shows the actual fallback language',async()=>{
  let seen:Request|undefined;const value={...envelope(),requestedLocale:'es-MX',fallback:true};
  const r=await publicFetch(new Request('https://pay.invalid/terms?lang=es-mx&secret=x',{headers:{cookie:'private',authorization:'Bearer private','accept-language':'fr','x-private':'private'}}),{ADMIN_POLICIES:{fetch:async(input)=>{seen=input;return Response.json(value);}}});
  expect(r.status).toBe(200);expect(seen?.url).toBe('https://admin.devslab.kr/api/public/policies/v2/pay/terms/es-MX');expect([...seen!.headers.keys()].sort()).toEqual(['accept','cache-control']);expect(seen?.redirect).toBe('manual');expect(seen?.signal).toBeDefined();
  const html=await r.text();expect(html).toContain('<html lang="ko">');expect(html).toContain('Requested language: es-MX');expect(html).toContain('Showing ko');expect(html).toContain('fallback');expect(html).not.toContain('<html lang="es-MX">');expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
 });
 it('shows stale translation metadata and accepts future canonical supported languages',async()=>{
  const value={...envelope(),requestedLocale:'es-MX',locale:'es-MX',defaultLocale:'es-MX',supportedLocales:['ko','en','es-MX','sr-Latn'],translation:{sourceLocale:'ko',sourceRevision:2,currentSourceRevision:3,needsUpdate:true}};
  const r=await serve(value,'/terms?lang=es-MX');expect(r.status).toBe(200);const html=await r.text();expect(html).toContain('<html lang="es-MX">');expect(html).toContain('Translation needs update');expect(html).toContain('href="/terms?lang=sr-Latn"');expect(html).toContain('Default language: es-MX');
 });
 it('leaves fallback resolution to one central request',async()=>{let count=0;const r=await publicFetch(new Request('https://pay.invalid/terms?lang=ar'),{ADMIN_POLICIES:{fetch:async()=>{count++;return new Response(null,{status:404});}}});expect(r.status).toBe(503);expect(count).toBe(1);});
 it('rejects invalid or ambiguous explicit language without fetching',async()=>{for(const query of ['lang=','lang=en_US','lang=../../evil','lang=en&lang=ko','lang='+('a'.repeat(36))]){let count=0;const r=await publicFetch(new Request('https://pay.invalid/terms?'+query),{ADMIN_POLICIES:{fetch:async()=>{count++;return Response.json(envelope());}}});expect(r.status).toBe(503);expect(count).toBe(0);}});
 it('strictly rejects malformed envelopes, metadata contradictions and private fields',async()=>{
  const malformed=[policy,{...envelope(),schemaVersion:1},{...envelope(),requestedLocale:null},{...envelope(),requestedLocale:'en'},{...envelope(),locale:'en'},{...envelope(),fallback:true},{...envelope(),settingsRevision:-1},{...envelope(),settingsRevision:1.5},{...envelope(),defaultLocale:'ja'},{...envelope(),supportedLocales:['ko','en','en']},{...envelope(),supportedLocales:['ko','en','es-mx']},{...envelope(),supportedLocales:['ko','en','en_US']},{...envelope(),draft:'private'},{...envelope(),translation:{...envelope().translation,needsUpdate:true}},{...envelope(),translation:{...envelope().translation,sourceLocale:'en'}},{...envelope(),translation:{...envelope().translation,sourceRevision:-1}},{...envelope(),translation:{...envelope().translation,draft:'private'}},{...envelope(),document:{...policy,site:'admin'}},{...envelope(),document:{...policy,slug:'privacy'}},{...envelope(),document:{...policy,extra:'private'}},{...envelope(),document:{...policy,effectiveAt:'2026-02-31'}},{...envelope(),document:{...policy,revision:1.5}}];
  for(const value of malformed)expect((await serve(value)).status,JSON.stringify(value)).toBe(503);
 });
 it('checks explicit requested locale against the upstream envelope',async()=>{expect((await serve(envelope(),'/terms?lang=en')).status).toBe(503);});
 it('preserves v1 validator shape and rejects raw document UTF8 overflow inside v2',async()=>{expect(validatePolicy(policy,'terms')).toEqual(policy);const value=envelope();value.document.sections=[{title:'x',paragraphs:Array.from({length:6},()=> '가'.repeat(4000))}];expect((await serve(value)).status).toBe(503);});
 it('accepts the full 69632 byte envelope boundary but cancels streamed UTF8 overflow',async()=>{
  const raw=JSON.stringify(envelope()),size=new TextEncoder().encode(raw).byteLength;
  const r=await publicFetch(new Request('https://pay.invalid/terms'),{ADMIN_POLICIES:{fetch:async()=>new Response(raw+' '.repeat(69632-size),{headers:{'content-type':'application/json'}})}});expect(r.status).toBe(200);
  let cancelled=false;const bytes=new TextEncoder().encode(raw+' '.repeat(69632-size)+'가');let sent=0;
  const stream=new ReadableStream<Uint8Array>({pull(controller){if(sent<bytes.length){controller.enqueue(bytes.slice(sent,sent+1024));sent+=1024;}},cancel(){cancelled=true;}});
  const overflow=await publicFetch(new Request('https://pay.invalid/terms'),{ADMIN_POLICIES:{fetch:async()=>new Response(stream,{headers:{'content-type':'application/json'}})}});expect(overflow.status).toBe(503);expect(cancelled).toBe(true);
 });
 it('rejects invalid UTF8 and oversized declared bodies',async()=>{for(const response of [new Response(new Uint8Array([0xff]),{headers:{'content-type':'application/json'}}),new Response(JSON.stringify(envelope()),{headers:{'content-type':'application/json','content-length':'69633'}})])expect((await publicFetch(new Request('https://pay.invalid/terms'),{ADMIN_POLICIES:{fetch:async()=>response}})).status).toBe(503);});
 it('allows only GET and HEAD',async()=>{for(const method of ['POST','PUT','DELETE','OPTIONS']){const r=await publicFetch(new Request('https://pay.invalid/terms',{method}),{});expect(r.status).toBe(405);expect(r.headers.get('allow')).toBe('GET, HEAD');}});
});

describe('public policy metadata bounds',()=>{
 it('rejects an oversized supported language list',async()=>{expect((await serve({...envelope(),supportedLocales:['ko','en',...Array.from({length:63},(_,i)=>'en-x-'+i)]})).status).toBe(503);});
 it('accepts an original v1 publication exactly 65536 bytes inside the larger envelope',async()=>{
  const value=envelope();value.document.sections=[{title:'x',paragraphs:Array.from({length:16},()=> 'x'.repeat(4000))}];
  const spare=65536-new TextEncoder().encode(JSON.stringify(value.document)).byteLength;value.document.sections[0].paragraphs.push('x'.repeat(spare-3));
  expect(new TextEncoder().encode(JSON.stringify(value.document)).byteLength).toBe(65536);expect((await serve(value)).status).toBe(200);
 });
});

describe('public policy source and deadline checks',()=>{
 it('rejects a translation based on a future source and inconsistent Korean freshness',async()=>{
  for(const translation of [{sourceLocale:'ko',sourceRevision:3,currentSourceRevision:2,needsUpdate:true},{sourceLocale:'ko',sourceRevision:1,currentSourceRevision:2,needsUpdate:false},{sourceLocale:'ko',sourceRevision:Number.MAX_SAFE_INTEGER+1,currentSourceRevision:Number.MAX_SAFE_INTEGER+1,needsUpdate:false}])expect((await serve({...envelope(),translation})).status).toBe(503);
 });
 it('rejects a 65537 byte raw document even while the entire envelope fits',async()=>{
  const value=envelope();value.document.sections=[{title:'x',paragraphs:Array.from({length:16},()=> 'x'.repeat(4000))}];const spare=65537-new TextEncoder().encode(JSON.stringify(value.document)).byteLength;value.document.sections[0].paragraphs.push('x'.repeat(spare-3));
  expect(new TextEncoder().encode(JSON.stringify(value.document)).byteLength).toBe(65537);expect(new TextEncoder().encode(JSON.stringify(value)).byteLength).toBeLessThan(69632);expect((await serve(value)).status).toBe(503);
 });
 it('bounds both slow headers and a stalled response body to five seconds',async()=>{
  vi.useFakeTimers();
  try{
   let signal:AbortSignal|undefined;const slow=publicFetch(new Request('https://pay.invalid/terms'),{ADMIN_POLICIES:{fetch:async(request)=>{signal=request.signal;return new Promise<Response>(()=>{});}}});
   await vi.advanceTimersByTimeAsync(5000);expect((await slow).status).toBe(503);expect(signal?.aborted).toBe(true);
   let cancelled=false;const stalled=publicFetch(new Request('https://pay.invalid/terms'),{ADMIN_POLICIES:{fetch:async()=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}})}});
   await vi.advanceTimersByTimeAsync(5000);expect((await stalled).status).toBe(503);expect(cancelled).toBe(true);
  }finally{vi.useRealTimers();}
 });
});

describe('public policy publication and rejected response checks',()=>{
 it('shows the publication date separately from the effective date',async()=>{
  const value=envelope();value.document.publishedAt='2026-10-14T09:30:00.000Z';value.document.effectiveAt='2026-10-20';
  const r=await serve(value);expect(r.status).toBe(200);const html=await r.text();expect(html).toContain('Published 2026-10-14');expect(html).toContain('Effective 2026-10-20');
 });
 it('rejects an already redirected 200 response',async()=>{
  const response=Response.json(envelope());Object.defineProperties(response,{redirected:{value:true},url:{value:'https://evil.invalid/policy'}});
  const r=await publicFetch(new Request('https://pay.invalid/terms'),{ADMIN_POLICIES:{fetch:async()=>response}});expect(r.status).toBe(503);
 });
 it('cancels bodies rejected for status or malformed content type',async()=>{
  for(const options of [{status:404,headers:{'content-type':'application/json'}},{status:200,headers:{'content-type':'text/html'}}]){
   let cancelled=false;const response=new Response(new ReadableStream<Uint8Array>({cancel(){cancelled=true;}}),options);
   const r=await publicFetch(new Request('https://pay.invalid/terms'),{ADMIN_POLICIES:{fetch:async()=>response}});expect(r.status).toBe(503);expect(cancelled).toBe(true);
  }
 });
});
