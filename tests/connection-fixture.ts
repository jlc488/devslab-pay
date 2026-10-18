import type {ConnectionSnapshot,PayScope,PaymentConnectionView} from '@devslab-kr/pay-contract';
import type {TossVerifier} from '../src/connections';
/**
 * Local-only fixtures for the connection vault. The master key is 32 bytes of a fixed test pattern and the
 * Toss keys are obviously fake; none of them is a real credential, and no test calls Toss.
 */
export const TEST_MASTER_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export const OTHER_MASTER_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export const fakeKeys=(suffix:string)=>({clientKey:'test_ck_FAKEclient'+suffix,secretKey:'test_sk_FAKEsecret'+suffix});
export const verifiedOk:TossVerifier=async()=>'ok';
export const vaultEnv=(db:D1Database)=>({DB:db,PAY_CONNECTION_MASTER_KEY:TEST_MASTER_KEY,PAY_CONNECTION_VERIFICATION_ENABLED:'true'});
/** Registers a fake connection through the real RPC and returns the snapshot Admin would send for it. */
export async function registerConnection(db:D1Database,companyId:string,merchantId:string,suffix:string,extra:Record<string,unknown>={}):Promise<{view:PaymentConnectionView;connection:ConnectionSnapshot}>{
 const {PayApplication}=await import('../src/service');
 const app=new PayApplication({...vaultEnv(db),...extra},verifiedOk);
 const scope:PayScope={subject:'fixture-owner',companyId,access:'company'};
 const response=await app.dispatch({action:'connectConnection',scope,merchantId,...fakeKeys(suffix)},{check:async()=>true});
 if(!response.ok)throw Error('fixture connect failed: '+response.error.code);
 const view=response.result as PaymentConnectionView;
 return {view,connection:{id:'integration-'+suffix,companyId,revision:'1',provider:'toss',environment:'test',providerAccountId:merchantId,credentialSetId:view.id}};
}
