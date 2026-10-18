// Compiles as a consuming service would (see tsconfig.json beside this file): against the built dist
// through the package name, without exactOptionalPropertyTypes/noUncheckedIndexedAccess.
import {
 CHECKOUT_CALLBACK_PATHS,PAYMENT_PRICING,PAYMENT_STATES,PAY_ERROR_CODES,PayContractError,calculateRecharge,checkoutCallbackUrl,checkoutStateHash,
 importDigest,isPayErrorCode,parseCapabilities,parseCheckoutCaptureResult,parseCheckoutPreparation,parseOrderPage,parsePublicOrder,
 type CheckoutPreparation,type ImportDigestInput,type OrderPage,type PayBinding,type PayCommand,type PayErrorCode,type PayResponse,
 type PaymentCapabilities,type PaymentState,type PublicOrder,type ScopedPayCommand,
 CHECKOUT_RETURN_REGISTRY,RECHARGE_MAXIMUM_SUPPLY_KRW,calculateOrderRecharge,checkoutReturnUrl,isCheckoutReturn,resolveCheckoutReturn,
 type CheckoutReturn,type CheckoutCaptureResult,
 parsePaymentConnectionState,parsePaymentConnectionView,isTossTestClientKey,isTossTestSecretKey,isTossMerchantId,
 type PaymentConnectionState,type PaymentConnectionView,
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
// 0.2.0 additions: a 0.1.0-shaped command and capture still compile; returnTo is optional on both.
const back:CheckoutReturn = resolveCheckoutReturn('contract');
const prepareTo:PayCommand = {action:'prepareCheckout',scope,id:'order',returnTarget:'contract',returnTo:{service:'contract',path:'/notify'}};
const legacyCapture:CheckoutCaptureResult = {returnTarget:'admin',companyId:'company',id:'order',result:'unknown'};
const redirect:string = checkoutReturnUrl(parseCheckoutCaptureResult(body));
const legacyRedirect:string = checkoutReturnUrl(legacyCapture);
const contractOrigin:string = CHECKOUT_RETURN_REGISTRY.contract.origin;
const isEntry:boolean = isCheckoutReturn(body);
const max:number = calculateOrderRecharge(RECHARGE_MAXIMUM_SUPPLY_KRW).supplyKrw;
// 0.3.0 additions: connection commands and views.
const connectCommand:PayCommand = {action:'connectConnection',scope:{...scope,access:'company'},merchantId:'mid',clientKey:'test_ck_x',secretKey:'test_sk_x'};
const revokeCommand:PayCommand = {action:'revokeConnection',scope:{...scope,access:'company'},connectionId:'pcv_x'};
const connections:PaymentConnectionState = parsePaymentConnectionState(body);
const hint:string|undefined = connections.active?.clientKeyHint;
const connectionView:PaymentConnectionView = parsePaymentConnectionView(body);
const validKeys:boolean = isTossTestClientKey(body)&&isTossTestSecretKey(body)&&isTossMerchantId(body);
void [run,order,state,first,caps,pricing,checkout,capture,total,url,path,code,back,prepareTo,redirect,legacyRedirect,contractOrigin,isEntry,max,connectCommand,revokeCommand,hint,connectionView,validKeys];
