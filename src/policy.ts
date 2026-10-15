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
function escape(value:string):string{return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));}
function render(policy:PublicPolicy){return '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+escape(policy.title)+'</title><main><h1>'+escape(policy.title)+'</h1><p style="white-space:pre-wrap">'+escape(policy.description)+'</p>'+policy.sections.map(s=>'<section><h2>'+escape(s.title)+'</h2>'+s.paragraphs.map(p=>'<p style="white-space:pre-wrap">'+escape(p)+'</p>').join('')+'</section>').join('')+'<footer>Effective '+escape(policy.effectiveAt)+' · Revision '+policy.revision+'</footer></main></html>';}
const headers={'cache-control':'no-store','content-type':'text/html; charset=utf-8','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",'referrer-policy':'no-referrer'};
export async function publicFetch(request:Request,env:PolicyEnv):Promise<Response>{
 const url=new URL(request.url),slug=url.pathname.slice(1) as PublicPolicy['slug'];
 if(!slugs.includes(slug)||url.pathname!=='/'+slug)return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}});
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{...headers,allow:'GET, HEAD'}});
 let body='<!doctype html><html><meta charset="utf-8"><title>Policy unavailable</title><main><h1>Policy unavailable</h1><p>This published policy is currently unavailable.</p></main></html>',status=503;
 try{
  if(!env.ADMIN_POLICIES&&env.PAY_POLICIES_ENABLED!=='true')throw invalid();
  const upstream=new Request('https://admin.devslab.kr/api/public/policies/pay/'+slug,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(8000),headers:{accept:'application/json','cache-control':'no-store'}});
  const response=await (env.ADMIN_POLICIES?env.ADMIN_POLICIES.fetch(upstream):fetch(upstream));
  if(response.status!==200||!response.headers.get('content-type')?.includes('application/json'))throw invalid();
  body=render(validatePolicy(await boundedJson(response),slug));status=200;
 }catch{}
 return new Response(request.method==='HEAD'?null:body,{status,headers});
}
