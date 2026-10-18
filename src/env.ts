import type {PolicyEnv} from './policy';
import type {RuntimeSecret} from './vault';
export type LedgerSecretBinding = `PAY_NOTIFY_TEST_LEDGER_${string}`;
/** Only declared local DB and optional future server bindings. No credentials are configured in this repository. */
export interface CredentialEnv {
 /** Secrets Store `pay-connection-master-key`: 32 random bytes, base64url. Wraps every connection's data key. */
 PAY_CONNECTION_MASTER_KEY?:RuntimeSecret;
 /** 'true' allows the one read-only Toss call that verifies a new connection's secret key. Separate from checkout. */
 PAY_CONNECTION_VERIFICATION_ENABLED?:string;
 PAY_LEDGER_REGISTRY_JSON?:string;
 NOTIFY_LOCAL_SERVICE?:{fetch(request:Request):Promise<Response>};
 [binding:LedgerSecretBinding]:string|undefined;
}

export interface Env extends CredentialEnv,PolicyEnv {DB:D1Database;PAY_EXTERNAL_ACTIONS_ENABLED?:string}
