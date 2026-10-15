# Pay local implementation

Private Cloudflare Worker payment capability for Admin. `PayService.dispatch(PayCommand)` is the only financial entrypoint. Admin owns authentication, companies, memberships and current integration assignments; it derives `scope` after fresh authorization. Bind only Admin to named entrypoint `PayService`. The default public Worker serves four published policy pages; the named entrypoint HTTP handler returns 404.

No account ID, route, production D1 ID, service binding or secret is configured. The included dummy D1 ID is local only. External financial actions default OFF. This repository does not create credentials or enable Toss/Notify. Live and legacy simulation execution are unavailable.

## Local commands

Node >=24.12.0. `npm ci`, `npm test`, `npm run typecheck`, `npm run build` (Wrangler dry run only), `npm run db:migrate:local`, `npm run dev`. Tests use one Vitest worker, one real local Miniflare D1 schema setup, blocked outbound traffic and isolated test data. The pinned workerd supports compatibility date 2026-10-13; it rejects 2026-10-15, so the config uses the supported date. No shared node_modules junction is used.

## Server registry contract

`PAY_CREDENTIAL_REGISTRY_JSON` is a JSON object keyed by bounded registered credentialSetId. Exact payment descriptor: `{companyId,provider:'toss',environment:'test',purpose:'payment',providerAccountId,secretBinding,clientKeyBinding}`. Binding names must use `PAY_TOSS_TEST_SECRET_[A-Z0-9_]+` and `PAY_TOSS_TEST_CLIENT_[same suffix]`. Exact ledger descriptor: `{companyId,provider:'notify',environment:'test',purpose:'ledger',workspaceId,secretBinding}`; binding name must use `PAY_NOTIFY_TEST_LEDGER_[A-Z0-9_]+`. Runtime only reads these typed prefixes. No AUTH, OTP, reader binding or arbitrary URL/header is accepted.

Each descriptor binds one explicit company and merchant/workspace. Pay resolves and hashes secret material; Admin receives only private readiness/fingerprint metadata. Preserve every versioned registered reference and its secret binding until historical intents resolve. New connection defaults do not retarget saved orders. Changed material under the same reference fails fingerprint checks. Unknown retired references fail closed. Keys never enter public DTOs or logs. General Toss test keys must have test_sk_/test_ck_ prefixes; live/billing key variants are refused. No credentials are included in this document or config.

## Import and single writer protocol

Source Admin remains authoritative until an explicit per-order transfer. Verify no source invocation is in flight or uncertain. Save a unique generation, exact source snapshot and canonical digest; CAS source admin -> frozen. Import real sandbox messaging_test_payment_orders only. Simulated messaging_payment_orders stay under Admin and cannot become external-provider orders.

Digest is lowercase SHA256 of UTF-8 recursively key-sorted JSON of `{migrationId,generation,order,connection,ledger}`, excluding digest. Preserve every exact original source field and provenance; `order.provenance.quiescentMarker` equals generation. Do not delete source rows. Pay stores the order and staged import atomically. Same exact replay returns its current staged/active/aborted receipt; changed source data or digest conflicts.

After exact staged receipt verification, Admin CASes frozen -> pay for the same generation/digest, then calls activateImport with matching ownership plus `{sourceWriter:'pay',generation,digest}`. Activation is idempotent. Imported financial calls require active status and exact ownership. Lost activation acknowledgements require importStatus or exact activation retry; source stays pay and never falls back to a stale Admin row.

Before activation only: Pay must acknowledge staged -> aborted before Admin unfreezes the matching source generation. Active imports cannot abort. No expiry or blind takeover exists. These RPCs require the trusted Admin-only capability; a browser cannot supply source proof. The source invocation fence and current authorization must be enforced by Admin.

## Recovery and financial invariants

Supply is an integer >=1,000 KRW in steps of1,000; VAT is10%, with safe integer arithmetic. Only principal credits the test wallet. Provider IDs/amounts/receipt currency and complete cancellation proof must match saved orders. Confirmation identity is confirm:<original id>; ledger credit is payment:<original id>; reservation/cancellation is refund:<original id>. Payment keys stay private.

States: created, confirming, provider_unknown, credit_pending, credited, refund_pending, refund_unknown, refunded. Browser callback parameters never prove provider approval. Reconcile reuses the stored claim and snapshots; missing claim conflicts. Refund persists immutable reason and reserves principal before provider cancellation. Unknown cancellation or settlement retains the hold and refund_unknown. There is no automatic release on ambiguous errors; no release path is enabled here. Reconciliation uses the same operations and receipts.

## Public policies

GET/HEAD /terms, /privacy, /refund, /service fetch only fixed `https://admin.devslab.kr/api/public/policies/pay/:slug`, through optional ADMIN_POLICIES service binding or explicitly enabled PAY_POLICIES_ENABLED fixed-origin transport. No source is configured by default. Requests forward no cookies/authorization, follow no redirects, and have bounded time/body sizes. DTO schema is exact; UTC dates, positive revision, UTF8 64KiB, section/paragraph bounds are validated. Text is escaped with whitespace preserved. Missing/unpublished/unconfigured policy returns503 with no legal seed. All other public paths404; policy mutations405.

## Verification limits

Pure receipt/registry/policy tests and real local D1 tests are local evidence. Scripted failing provider/ledger boundaries test durable uncertainty and hold behavior only; they are not service integration or real financial settlement proof. External Toss approval/refund, Notify settlement/wallet operations, credential calls and SMS/push were NOT run. Activation/deployment and actual single-writer cutover require separately coordinated operational verification.

## Checkout return journal

prepareCheckout requires the active owned test order to remain created with no private payment claim, configured saved references, the external gate and fresh effect authority. It returns only the exact fixed Admin callback URLs and the general test preparation DTO. Nonce issuance has no provider or ledger effect. The random256bit state exists only in those URLs; D1 retains its SHA256 hash, bound actor/company/order/amount/target/generation and10minute unused deadline.

Only private captureCheckoutCallback and hash-only checkoutCaptureStatus bypass the financial gate. Capture derives stored scope from the nonce and checks active imported ownership. Its transactional D1 batch binds the first payment key, consumes the nonce and inserts an immutable receipt. A final SQL CHECK forces any zero-row prerequisite miss to roll back the entire batch. Distinct-key nonces and success/failure races cannot overwrite a claim/outcome. Exact committed replays remain recoverable after the unused-nonce deadline. A failure consumes only its nonce. No callback changes financial state, proves payment, authorizes a session or performs a provider/ledger call.

Admin owns public callback parsing and fixed303 redirects back to Contract/Admin, without payment key/state in the Location. It must reject duplicate required query fields and must not log callback URLs, raw queries, keys, state or provider errors. Actual logging collectors need review before checkout activation.

## Fresh authority for every effect

dispatch(command,effectAuthority?) accepts a separate ephemeral RPC capability with only check():Promise<boolean>. It is never a JSON command field, token, role, database row or reusable session. Admin binds an actual RpcTarget with private request/authority fields, rechecks current policy on every check, and closes it in finally. Pay holds it only in the awaited dispatch lifetime and performs no background financial work.

Each provider/ledger call rechecks the current external gate and awaits exact true from that capability. Missing, throwing, false or closed capabilities deny before the effect. An observed approval is durably credit_pending before a later ledger authorization check. A strictly verified cancellation transaction is stored privately with an immutable-first-proof trigger before a later finalize check. Revocation keeps those facts and the principal hold; it never fabricates ledger settlement or starts a new operation.

The built local smoke is npm run test:worker after npm run build; it uses an actual named PayService binding and actual RpcTarget with real local D1 and outbound blocked. Scripted provider responses in unit tests prove ordering and retained local facts only, not external approval or settlement.
