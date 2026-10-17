import type {ImportDigestInput} from '../src/index.js';
/** A frozen legacy snapshot exactly as Admin sends it in importLegacy (provider_refund_id omitted, not undefined). */
export const importFixture:ImportDigestInput = {
 migrationId:'legacy-payments-2026-10',generation:'5f0c2b4e-1d7a-4c39-9a51-2c8e7d1f0a63',
 order:{
  id:'0b6f1e2a-7c4d-4e8b-a1f2-93d5c6b7e8f0',company_id:'company-a',user_id:'user-김',provider_order_id:'test_0b6f1e2a-7c4d-4e8b-a1f2-93d5c6b7e8f0',
  idempotency_key:'recharge:2026-09-01',supply_krw:10000,vat_krw:1000,total_krw:11000,currency:'KRW',mode:'sandbox',state:'credited',
  payment_key:'tviva20260901',refund_reason:null,notify_workspace_id:'workspace-a',revision:3,created_at:'2026-09-01T01:02:03.000Z',updated_at:'2026-09-01T01:05:00.000Z',
  provenance:{source:'admin',table:'messaging_test_payment_orders',quiescentMarker:'5f0c2b4e-1d7a-4c39-9a51-2c8e7d1f0a63'},
 },
 connection:{id:'p-a',companyId:'company-a',revision:'1',provider:'toss',environment:'test',providerAccountId:'merchant-a',credentialSetId:'toss-general-test-v1'},
 ledger:{environment:'test',kind:'notify-test-wallet',transport:'https-fixed-notify',provider:'notify',companyId:'company-a',workspaceId:'workspace-a',integrationId:'n-a',revision:'1',credentialSetId:'notify-test-ledger-v1'},
};
