import type {PolicyEnv} from './policy';
export type PaymentSecretBinding = `PAY_TOSS_TEST_SECRET_${string}`;
export type PaymentClientBinding = `PAY_TOSS_TEST_CLIENT_${string}`;
export type LedgerSecretBinding = `PAY_NOTIFY_TEST_LEDGER_${string}`;
/** Only declared local DB and optional future server bindings. No credentials are configured. */
export interface CredentialEnv {
 PAY_CREDENTIAL_REGISTRY_JSON?:string;
 NOTIFY_LOCAL_SERVICE?:{fetch(request:Request):Promise<Response>};
 [binding:PaymentSecretBinding]:string|undefined;
 [binding:PaymentClientBinding]:string|undefined;
 [binding:LedgerSecretBinding]:string|undefined;
}

export interface Env extends CredentialEnv,PolicyEnv {DB:D1Database;PAY_EXTERNAL_ACTIONS_ENABLED?:string}
