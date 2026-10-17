/**
 * Frozen private RPC v1 of DevsLab Pay. Pay compiles against these types; Admin (and Contract through
 * Admin) call Pay with them. No browser may choose scope or snapshots.
 */
import type {PAYMENT_STATES} from './constants.js';
import type {CheckoutReturn} from './returns.js';
export type PaymentState = typeof PAYMENT_STATES[number];
export interface PayScope {subject:string;companyId:string;access:'self'|'company'}
export interface ConnectionSnapshot {id:string;companyId:string;revision:string;provider:'toss';environment:'test';providerAccountId:string;credentialSetId:string}
export interface LedgerSnapshot {environment:'test';kind:'notify-test-wallet';transport:'notify-service'|'https-fixed-notify';provider:'notify';companyId:string;workspaceId:string;integrationId:string;revision:string;credentialSetId:string}
export interface PublicOrder {mode:'test';purpose:'messaging_recharge';id:string;companyId:string;orderId:string;operationId:string;supplyKrw:number;vatKrw:number;totalKrw:number;currency:'KRW';state:PaymentState;createdAt:string;updatedAt:string}
export interface PaymentCapabilities {companyId:string;mode:'test'|'unavailable';provider:'toss'|null;capabilities:{read:boolean;checkout:boolean;refund:boolean};pricing:{minimumSupplyKrw:1000;stepSupplyKrw:1000;vatRatePercent:10;vatIncluded:false;unitPriceKrw:100};reasonCode:string|null}
export interface TestWallet {mode:'test';availableKrw:number;reservedKrw:number;refundedKrw:number}
export interface PaymentConfig {mode:'test';provider:'toss';clientKey:string;lastOrder?:PublicOrder;wallet:TestWallet|null}
export interface OrderPage {items:PublicOrder[];nextCursor:string|null}
/** Exact source values are preserved, including legacy simulation/sandbox distinction. */
export interface LegacyPaymentOrder {
 id:string;company_id:string;user_id:string;provider_order_id:string;idempotency_key:string;
 supply_krw:number;vat_krw:number;total_krw:number;currency:'KRW';mode:'sandbox'|'simulation';state:PaymentState;
 payment_key:string|null;refund_reason:string|null;provider_refund_id?:string|null;notify_workspace_id?:string;revision:number;created_at:string;updated_at:string;
 provenance:{source:'admin';table:'messaging_test_payment_orders'|'messaging_payment_orders';quiescentMarker:string};
}
export interface OwnershipFence {migrationId:string;generation:string;digest:string}
export interface ImportReceipt extends OwnershipFence {orderId:string;state:'staged'|'active'|'aborted'}
export interface SourceCommittedProof {sourceWriter:'pay';generation:string;digest:string}
type Scoped = {scope:PayScope};
type CurrentSnapshots = {connection?:ConnectionSnapshot;ledger?:LedgerSnapshot};
export type ScopedPayCommand = Scoped & (
 | ({action:'capabilities'} & CurrentSnapshots)
 | ({action:'config'} & CurrentSnapshots)
 | {action:'inspectConnection';connection:ConnectionSnapshot}
 | {action:'getOrderByOperation';operationId:string;supplyKrw:number}
 | {action:'listOrders';cursor?:string}
 | {action:'createOrder';operationId:string;supplyKrw:number;connection:ConnectionSnapshot;ledger:LedgerSnapshot}
 | {action:'getOrder';id:string}
 /** `returnTo` (since 0.2.0) picks the final redirect from CHECKOUT_RETURN_REGISTRY; it must name the same service as `returnTarget`. */
 | {action:'prepareCheckout';id:string;returnTarget:'contract'|'admin';returnTo?:CheckoutReturn;ownership?:OwnershipFence}
 | {action:'confirmOrder';id:string;paymentKey:string;orderId:string;amount:number;ownership?:OwnershipFence}
 | {action:'reconcileOrder';id:string;ownership?:OwnershipFence}
 | {action:'refundOrder';id:string;reason:string;ownership?:OwnershipFence}
 | {action:'importLegacy';migrationId:string;generation:string;digest:string;order:LegacyPaymentOrder;connection:ConnectionSnapshot;ledger:LedgerSnapshot}
 | {action:'importStatus';id:string;ownership:OwnershipFence}
 | {action:'activateImport';id:string;ownership:OwnershipFence;sourceCommitted:SourceCommittedProof}
 | {action:'abortImport';id:string;ownership:OwnershipFence}
);
export interface CheckoutPreparation {companyId:string;id:string;mode:'test';provider:'toss';kind:'general-test';clientKey:string;customerKey:string;orderId:string;amount:{currency:'KRW';value:number};orderName:'DevsLab 문자 충전 테스트';successUrl:string;failUrl:string;expiresAt:string}
/** `returnTo` (since 0.2.0): the registry entry saved at prepareCheckout. Pay always sends it; build the redirect with `checkoutReturnUrl`. */
export interface CheckoutCaptureResult {returnTarget:'contract'|'admin';returnTo?:CheckoutReturn;companyId:string;id:string;result:'captured'|'failed'|'unknown'}
export type CheckoutCallback = {outcome:'success';state:string;paymentKey:string;orderId:string;amount:number}|{outcome:'fail';state:string;code?:string;orderId?:string};

export type PayCommand = ScopedPayCommand|({action:'captureCheckoutCallback'} & CheckoutCallback)|{action:'checkoutCaptureStatus';stateHash:string};
export interface ConnectionInspection {companyId:string;connectionId:string;revision:string;configured:boolean;fingerprint:string|null;reasonCode:string|null}
export type PayResult = CheckoutPreparation|CheckoutCaptureResult|ConnectionInspection|PaymentCapabilities|PaymentConfig|OrderPage|PublicOrder|ImportReceipt;
export type PayResponse = {ok:true;result:PayResult}|{ok:false;status:400|401|403|404|405|409|503;error:{code:string;message:string}};
export interface PayEffectAuthority {check():Promise<boolean>}
export interface PayBinding {dispatch(command:PayCommand,effectAuthority?:PayEffectAuthority):Promise<PayResponse>}
export interface PublicPolicy {site:'pay';slug:'terms'|'privacy'|'refund'|'service';revision:number;title:string;description:string;sections:{title:string;paragraphs:string[]}[];publishedAt:string;effectiveAt:string}
