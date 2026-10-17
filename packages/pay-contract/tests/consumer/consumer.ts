// Compiles as a consuming service would (see tsconfig.json beside this file): against the built dist
// through the package name, without exactOptionalPropertyTypes/noUncheckedIndexedAccess.
import {
 CHECKOUT_CALLBACK_PATHS,PAYMENT_PRICING,PAYMENT_STATES,PAY_ERROR_CODES,PayContractError,calculateRecharge,checkoutCallbackUrl,checkoutStateHash,
 importDigest,isPayErrorCode,parseCapabilities,parseCheckoutCaptureResult,parseCheckoutPreparation,parseOrderPage,parsePublicOrder,
 type CheckoutPreparation,type ImportDigestInput,type OrderPage,type PayBinding,type PayCommand,type PayErrorCode,type PayResponse,
 type PaymentCapabilities,type PaymentState,type PublicOrder,type ScopedPayCommand,
} from '@devslab-kr/pay-contract';

declare const binding:PayBinding;
declare const body:unknown;
declare const snapshot:ImportDigestInput;
const scope = {subject:'user',companyId:'company',access:'self'} as const;
// Optional fields may be passed as undefined when exactOptionalPropertyTypes is off.
const list:ScopedPayCommand = {action:'listOrders',scope,cursor:undefined};
const prepare:PayCommand = {action:'prepareCheckout',scope,id:'order',returnTarget:'admin',ownership:undefined};
async function run():Promise<void>{
 const response:PayResponse = await binding.dispatch(list);
 if(!response.ok){const code:string=response.error.code;const known:boolean=isPayErrorCode(code);void known;}
 const digest:string = await importDigest(snapshot);
 const hash:string = await checkoutStateHash('state');
 void [prepare,digest,hash];
}
const order:PublicOrder = parsePublicOrder(body);
const state:PaymentState = PAYMENT_STATES[0];
const page:OrderPage = parseOrderPage(body);
const first:PublicOrder = page.items[0];
const caps:PaymentCapabilities = parseCapabilities(body);
const pricing:PaymentCapabilities['pricing'] = PAYMENT_PRICING;
const checkout:CheckoutPreparation = parseCheckoutPreparation(body);
const capture:'captured'|'failed'|'unknown' = parseCheckoutCaptureResult(body).result;
const total:number = calculateRecharge(1000).totalKrw;
const url:string = checkoutCallbackUrl('fail','x');
const path:'/api/payments/callback/success' = CHECKOUT_CALLBACK_PATHS.success;
const code:PayErrorCode = PAY_ERROR_CODES[0];
try{calculateRecharge(body);}catch(error){if(error instanceof PayContractError){const c:'invalid_input'|'invalid_response'=error.code;void c;}}
void [run,order,state,first,caps,pricing,checkout,capture,total,url,path,code];
