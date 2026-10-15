import type {PublicPolicy} from './contracts';
import {object,exactKeys,invalid,utc} from './domain';
import {boundedJson} from './http';
export interface PolicyEnv {ADMIN_POLICIES?:{fetch(request:Request):Promise<Response>};PAY_POLICIES_ENABLED?:string}
const slugs=['terms','privacy','refund','service'] as const;
function plain(value:unknown,max:number,empty=false):string{if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||/[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw invalid();return value;}
export function validatePolicy(value:unknown,slug:PublicPolicy['slug']):PublicPolicy{
 const v=object(value);exactKeys(v,['site','slug','revision','title','description','sections','publishedAt','effectiveAt']);
 if(v.site!=='pay'||v.slug!==slug||!Number.isSafeInteger(v.revision)||Number(v.revision)<1||!Array.isArray(v.sections)||v.sections.length<1||v.sections.length>64)throw invalid();
 const sections=v.sections.map(value=>{const section=object(value);exactKeys(section,['title','paragraphs']);if(!Array.isArray(section.paragraphs)||section.paragraphs.length<1||section.paragraphs.length>128)throw invalid();return {title:plain(section.title,200),paragraphs:section.paragraphs.map(p=>plain(p,4000))};});
 const effectiveAt=plain(v.effectiveAt,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(effectiveAt)||new Date(effectiveAt+'T00:00:00.000Z').toISOString().slice(0,10)!==effectiveAt)throw invalid();
 return {site:'pay',slug,revision:Number(v.revision),title:plain(v.title,200),description:plain(v.description,1000,true),sections,publishedAt:utc(v.publishedAt),effectiveAt};
}
interface PolicyEnvelope {
 requestedLocale:string;locale:string;fallback:boolean;settingsRevision:number;defaultLocale:string;supportedLocales:string[];document:PublicPolicy;
 translation:{sourceLocale:'ko';sourceRevision:number;currentSourceRevision:number;needsUpdate:boolean};
}
function canonicalLocale(value:unknown):string{
 if(typeof value!=='string'||value.length>35||!/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(value))throw invalid();
 try{const canonical=Intl.getCanonicalLocales(value)[0];if(canonical&&canonical.length<=35)return canonical;}catch{}
 throw invalid();
}
function metadataLocale(value:unknown):string{const canonical=canonicalLocale(value);if(canonical!==value)throw invalid();return canonical;}
function revision(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw invalid();return value;}
function validateEnvelope(value:unknown,slug:PublicPolicy['slug'],requested?:string):PolicyEnvelope{
 const v=object(value);exactKeys(v,['schemaVersion','requestedLocale','locale','fallback','settingsRevision','defaultLocale','supportedLocales','document','translation']);
 if(v.schemaVersion!==2||typeof v.fallback!=='boolean'||!Array.isArray(v.supportedLocales)||v.supportedLocales.length<2||v.supportedLocales.length>64)throw invalid();
 const requestedLocale=metadataLocale(v.requestedLocale),locale=metadataLocale(v.locale),defaultLocale=metadataLocale(v.defaultLocale),supportedLocales=v.supportedLocales.map(metadataLocale);
 if(new Set(supportedLocales).size!==supportedLocales.length||!supportedLocales.includes('ko')||!supportedLocales.includes('en')||!supportedLocales.includes(defaultLocale)||!supportedLocales.includes(locale)||requestedLocale!==(requested??defaultLocale)||v.fallback!==(requestedLocale!==locale))throw invalid();
 const t=object(v.translation);exactKeys(t,['sourceLocale','sourceRevision','currentSourceRevision','needsUpdate']);
 const sourceRevision=revision(t.sourceRevision),currentSourceRevision=revision(t.currentSourceRevision);
 if(t.sourceLocale!=='ko'||typeof t.needsUpdate!=='boolean'||sourceRevision>currentSourceRevision||t.needsUpdate!==(locale!=='ko'&&sourceRevision!==currentSourceRevision)||(locale==='ko'&&sourceRevision!==currentSourceRevision))throw invalid();
 if(new TextEncoder().encode(JSON.stringify(v.document)).byteLength>65536)throw invalid();
 return {requestedLocale,locale,fallback:v.fallback,settingsRevision:revision(v.settingsRevision),defaultLocale,supportedLocales,document:validatePolicy(v.document,slug),translation:{sourceLocale:'ko',sourceRevision,currentSourceRevision,needsUpdate:t.needsUpdate}};
}
function escape(value:string):string{return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));}
function render(envelope:PolicyEnvelope){
 const policy=envelope.document;
 return '<!doctype html><html lang="'+escape(envelope.locale)+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+escape(policy.title)+'</title><main><h1>'+escape(policy.title)+'</h1><nav aria-label="Policy language">'+envelope.supportedLocales.map(locale=>'<a href="/'+policy.slug+'?lang='+encodeURIComponent(locale)+'" lang="'+escape(locale)+'"'+(locale===envelope.locale?' aria-current="page"':'')+'>'+escape(locale)+'</a>').join(' · ')+'</nav><p>Default language: '+escape(envelope.defaultLocale)+' · Requested language: '+escape(envelope.requestedLocale)+' · Showing '+escape(envelope.locale)+(envelope.fallback?' (fallback)':'')+'</p>'+(envelope.translation.needsUpdate?'<p role="status">Translation needs update: reviewed Korean revision '+envelope.translation.sourceRevision+'; current Korean revision '+envelope.translation.currentSourceRevision+'.</p>':'')+'<p style="white-space:pre-wrap">'+escape(policy.description)+'</p>'+policy.sections.map(s=>'<section><h2>'+escape(s.title)+'</h2>'+s.paragraphs.map(p=>'<p style="white-space:pre-wrap">'+escape(p)+'</p>').join('')+'</section>').join('')+'<footer>Published '+escape(policy.publishedAt.slice(0,10))+' · Effective '+escape(policy.effectiveAt)+' · Revision '+policy.revision+'</footer></main></html>';
}
const headers={'cache-control':'no-store','content-type':'text/html; charset=utf-8','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",'referrer-policy':'no-referrer'};
async function fetchEnvelope(env:PolicyEnv,slug:PublicPolicy['slug'],requested?:string):Promise<PolicyEnvelope>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  return await Promise.race([
   (async()=>{
    const upstream=new Request('https://admin.devslab.kr/api/public/policies/v2/pay/'+slug+(requested?'/'+encodeURIComponent(requested):''),{method:'GET',redirect:'manual',signal:controller.signal,headers:{accept:'application/json','cache-control':'no-store'}});
    const response=await (env.ADMIN_POLICIES?env.ADMIN_POLICIES.fetch(upstream):fetch(upstream));
    if(response.status!==200||response.redirected||response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'||!response.body){await response.body?.cancel().catch(()=>{});throw invalid();}
    // Abort covers the body read as well as response headers; the shared reader retains its v1 default.
    const boundedResponse=new Response(response.body.pipeThrough(new TransformStream(),{signal:controller.signal}),{headers:response.headers});
    return validateEnvelope(await boundedJson(boundedResponse,69632),slug,requested);
   })(),
   new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(invalid());},5000);}),
  ]);
 }finally{if(timer!==undefined)clearTimeout(timer);controller.abort();}
}
export async function publicFetch(request:Request,env:PolicyEnv):Promise<Response>{
 const url=new URL(request.url),slug=url.pathname.slice(1) as PublicPolicy['slug'];
 if(!slugs.includes(slug)||url.pathname!=='/'+slug)return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}});
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{...headers,allow:'GET, HEAD'}});
 let body='<!doctype html><html><meta charset="utf-8"><title>Policy unavailable</title><main><h1>Policy unavailable</h1><p>This published policy is currently unavailable.</p></main></html>',status=503;
 try{
  if(!env.ADMIN_POLICIES&&env.PAY_POLICIES_ENABLED!=='true')throw invalid();
  const languages=url.searchParams.getAll('lang');if(languages.length>1)throw invalid();
  const requested=languages.length?canonicalLocale(languages[0]):undefined;
  body=render(await fetchEnvelope(env,slug,requested));status=200;
 }catch{}
 return new Response(request.method==='HEAD'?null:body,{status,headers});
}
