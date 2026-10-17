import {RECHARGE_MINIMUM_SUPPLY_KRW,RECHARGE_STEP_SUPPLY_KRW,VAT_RATE_PERCENT} from './constants.js';
import {PayContractError} from './errors.js';
export interface RechargeAmounts {supplyKrw:number;vatKrw:number;totalKrw:number;walletCreditKrw:number;currency:'KRW'}
/**
 * The amounts Pay charges for a recharge of `supplyKrw`: at least 1000 and a multiple of 1000,
 * VAT 10% added on top, the wallet credited with the supply only. Throws `invalid_input` exactly
 * when Pay rejects the amount.
 */
export function calculateRecharge(value:unknown):RechargeAmounts{
 if(!Number.isSafeInteger(value)||Number(value)<RECHARGE_MINIMUM_SUPPLY_KRW||Number(value)%RECHARGE_STEP_SUPPLY_KRW!==0)throw invalidAmount();
 const supplyKrw=Number(value),vatKrw=supplyKrw/(100/VAT_RATE_PERCENT),totalKrw=supplyKrw+vatKrw;
 if(!Number.isSafeInteger(vatKrw)||!Number.isSafeInteger(totalKrw))throw invalidAmount();
 return {supplyKrw,vatKrw,totalKrw,walletCreditKrw:supplyKrw,currency:'KRW'};
}
function invalidAmount(){return new PayContractError('invalid_input','The recharge amount is invalid.');}
