import {PayContractError} from './errors.js';

/**
 * Where the buyer lands after the payment window, since 0.2.0. The provider always returns to Pay's fixed
 * callback (`checkoutCallbackUrl`); the final redirect target is chosen only from this registry of known
 * services and their allowed paths. Callers name a `{service, path}` entry, never a URL, and
 * `checkoutReturnUrl` builds the redirect only from these origins and paths (no open redirect).
 */
export const CHECKOUT_RETURN_REGISTRY = Object.freeze({
 contract:Object.freeze({origin:'https://contract.devslab.kr',paths:Object.freeze(['/notify'] as const)}),
 admin:Object.freeze({origin:'https://admin.devslab.kr',paths:Object.freeze(['/payments'] as const)}),
} as const);
export type CheckoutReturnService = keyof typeof CHECKOUT_RETURN_REGISTRY;
export type CheckoutReturnPath<S extends CheckoutReturnService = CheckoutReturnService> = (typeof CHECKOUT_RETURN_REGISTRY)[S]['paths'][number];
/** One registry entry: the service and one of its allowed paths. Exactly these two keys. */
export type CheckoutReturn = {[S in CheckoutReturnService]:{service:S;path:CheckoutReturnPath<S>}}[CheckoutReturnService];
/** The entry a 0.1.0 `returnTarget` stands for when no `returnTo` is given (the redirects Admin used before 0.2.0). */
export const DEFAULT_CHECKOUT_RETURNS = Object.freeze({
 contract:Object.freeze({service:'contract',path:'/notify'} as const),
 admin:Object.freeze({service:'admin',path:'/payments'} as const),
});
const SERVICES = Object.keys(CHECKOUT_RETURN_REGISTRY) as CheckoutReturnService[];
export function isCheckoutReturnService(value:unknown):value is CheckoutReturnService{
 return typeof value==='string'&&(SERVICES as string[]).includes(value);
}
/** True only for an exact registry entry: a plain object with exactly `service` and `path`, the path compared as-is. */
export function isCheckoutReturn(value:unknown):value is CheckoutReturn{
 if(typeof value!=='object'||value===null||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)return false;
 const keys=Object.keys(value);
 if(keys.length!==2||!keys.includes('service')||!keys.includes('path'))return false;
 const {service,path}=value as {service:unknown;path:unknown};
 if(!isCheckoutReturnService(service)||typeof path!=='string')return false;
 return (CHECKOUT_RETURN_REGISTRY[service].paths as readonly string[]).includes(path);
}
/**
 * The return entry of a prepareCheckout command: `returnTo` when given (it must name the same service as
 * `returnTarget`), otherwise the default entry of `returnTarget`. Throws `invalid_input` for anything else.
 */
export function resolveCheckoutReturn(returnTarget:unknown,returnTo?:unknown):CheckoutReturn{
 if(!isCheckoutReturnService(returnTarget))throw invalidReturn();
 if(returnTo===undefined)return {...DEFAULT_CHECKOUT_RETURNS[returnTarget]};
 if(!isCheckoutReturn(returnTo)||returnTo.service!==returnTarget)throw invalidReturn();
 return {service:returnTo.service,path:returnTo.path} as CheckoutReturn;
}
/** Identifiers that may appear in a redirect URL. */
export const CHECKOUT_RETURN_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const CHECKOUT_RETURN_RESULTS = ['captured','failed','unknown'] as const;
export interface CheckoutReturnInput {returnTarget:CheckoutReturnService;returnTo?:CheckoutReturn;companyId:string;id:string;result:typeof CHECKOUT_RETURN_RESULTS[number]}
/**
 * The final redirect URL after a checkout callback: a registry origin and path plus fixed query parameters
 * (`paymentOrder` for Contract; `companyId` and `testOrderId` for Admin; `paymentResult` for both).
 * Never carries the payment key or the checkout state. Throws `invalid_input` for anything outside the registry.
 */
export function checkoutReturnUrl(capture:CheckoutReturnInput):string{
 if(typeof capture!=='object'||capture===null)throw invalidReturn();
 const entry=resolveCheckoutReturn(capture.returnTarget,capture.returnTo);
 if(typeof capture.companyId!=='string'||!CHECKOUT_RETURN_ID_PATTERN.test(capture.companyId)||typeof capture.id!=='string'||!CHECKOUT_RETURN_ID_PATTERN.test(capture.id))throw invalidReturn();
 if(!(CHECKOUT_RETURN_RESULTS as readonly string[]).includes(capture.result))throw invalidReturn();
 const origin=CHECKOUT_RETURN_REGISTRY[entry.service].origin,query=new URLSearchParams();
 if(entry.service==='contract')query.set('paymentOrder',capture.id);
 else{query.set('companyId',capture.companyId);query.set('testOrderId',capture.id);}
 query.set('paymentResult',capture.result);
 const url=new URL(entry.path+'?'+query.toString(),origin);
 // Belt and braces: the built URL must still be exactly the registry origin and path.
 if(url.origin!==origin||url.pathname!==entry.path||url.hash||url.username||url.password)throw invalidReturn();
 return url.href;
}
function invalidReturn(){return new PayContractError('invalid_input','The checkout return target is invalid.');}
