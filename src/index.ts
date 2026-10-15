import {WorkerEntrypoint} from 'cloudflare:workers';
import type {Env} from './env';
import type {PayCommand,PayResponse,PayEffectAuthority} from './contracts';
import {PayApplication} from './service';
import {publicFetch} from './policy';
/** Admin-only named capability. No financial method is exposed by HTTP. */
export class PayService extends WorkerEntrypoint<Env>{
 async dispatch(command:PayCommand,effectAuthority?:PayEffectAuthority):Promise<PayResponse>{return new PayApplication(this.env).dispatch(command,effectAuthority);}
 async fetch():Promise<Response>{return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}});}
}
export default {fetch(request:Request,env:Env):Promise<Response>{return publicFetch(request,env);}} satisfies ExportedHandler<Env>;
