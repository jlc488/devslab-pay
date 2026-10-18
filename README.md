# Pay local implementation

Private Cloudflare Worker payment capability for Admin. `PayService.dispatch(PayCommand)` is the only financial entrypoint. Admin owns authentication, companies, memberships and current integration assignments; it derives `scope` after fresh authorization. Bind only Admin to named entrypoint `PayService`. The default public Worker serves four published policy pages; the named entrypoint HTTP handler returns 404.

No account ID, route, production D1 ID, service binding or secret is configured; the connection master key is a Secrets Store binding the owner adds. The included dummy D1 ID is local only. External financial actions default OFF. This repository does not create credentials or enable Toss/Notify. Live and legacy simulation execution are unavailable.

## Wire contract package

The RPC types, error codes, pricing, formats, checkout callback URLs, import digest and response parsers are published as `@devslab-kr/pay-contract` from `packages/pay-contract` (see its README and CHANGELOG). Pay imports them from that package through the npm workspace, so Pay cannot serve a shape other than the one it publishes; Admin installs a pinned version instead of copying the file. `@devslab-kr/pay-ui` (`packages/pay-ui`) holds the presentational React components (recharge amount, order history, order summary, test wallet) that Admin and Contract assemble; it takes data typed with the contract and never fetches. The Worker stays at the repository root; the root is the npm workspace root. `.npmrc` maps the `@devslab-kr` scope to GitHub Packages, so `npm ci` needs `NODE_AUTH_TOKEN` (`read:packages`) set, e.g. `NODE_AUTH_TOKEN=$(gh auth token) npm ci`.

## Local commands

Node >=24.12.0. `npm ci`, `npm test`, `npm run typecheck`, `npm run build` (Wrangler dry run only), `npm run db:migrate:local`, `npm run dev`, `npm run pack:contract` (checks the package file list without publishing). `typecheck`, `test`, `build` and `dev` build the contract package first. Tests use one Vitest worker, one real local Miniflare D1 schema setup, blocked outbound traffic and isolated test data. The pinned workerd supports compatibility date 2026-10-13; it rejects 2026-10-15, so the config uses the supported date. No shared node_modules junction is used.

## Company payment connections (connection vault)

Each company registers its own Toss **test** account from Admin (회사 › 결제 연결). There is no env-JSON payment registry any more: `PAY_CREDENTIAL_REGISTRY_JSON` is retired and never read.

- RPC (pay-contract 0.3.0): `connectionState`, `connectConnection {merchantId, clientKey, secretKey}`, `revokeConnection {connectionId}`. All need `scope.access: 'company'` (Admin passes it only for the owner); the two writes also need the effect authority, checked before the Toss call and again before storing.
- Verification: formats first (`test_ck_`/`test_sk_` general test keys only, MID `[A-Za-z0-9_-]{2,64}`), then one read-only call to the fixed Toss API, `GET /v1/payments/orders/{random id}` with the secret key. 404 `NOT_FOUND_PAYMENT` means the key is valid (nothing is created); 401 `UNAUTHORIZED_KEY` or 400 `INVALID_API_KEY` is `payment_credentials_invalid`; anything else is 503. A refused key is not stored. Toss has no endpoint that names a key's MID or pairs a client key with a secret key, so those cannot be verified at registration: the MID is enforced on every provider receipt (`mId` must equal it before anything is credited) and the client key only by format.
- Verification has its own switch `PAY_CONNECTION_VERIFICATION_ENABLED` (`"true"` in `wrangler.jsonc`), separate from `PAY_EXTERNAL_ACTIONS_ENABLED`, so registering works while checkout stays off.
- Vault: Secrets Store binding `PAY_CONNECTION_MASTER_KEY` (secret `pay-connection-master-key`, 32 random bytes base64url). A per-connection random data key encrypts `{clientKey, secretKey}` with AES-256-GCM and is wrapped under the master key; both layers use the additional data `pay-connection:v1:<companyId>:<connectionId>:<version>`. Format `m1.<wrapIv>.<wrappedKey>.<iv>.<ciphertext>`. Without a usable master key, registering and every resolution answer 503 and nothing is sent to Toss.
- Versions (migration 0003, `payment_connections`): one `active` row per company (partial unique index); a new connection supersedes it in the same batch; status moves only forward (active → superseded → revoked, or active → revoked); material columns are immutable and rows are never deleted. `payment_connection_audit` is append-only; its evidence is provider, version, MID, client-key hint and fingerprint.
- Exposure: only the MID, the last 4 characters of the client key and a SHA-256 fingerprint (over company, MID and both keys). Keys never appear in a response, log, error or audit row.
- Use: `ConnectionSnapshot.credentialSetId` is the version ID (`pcv_…`) and `providerAccountId` its MID. Readiness and new orders need the active version; an existing order's checkout and confirmation also finish under a superseded one; lookup reconcile, refund and legacy import also run under a revoked one, so money already taken can still be confirmed or returned. Orders keep the version's fingerprint; a mismatch fails closed.

Production binding (owner config, not in this repository):

```jsonc
"secrets_store_secrets": [{"binding": "PAY_CONNECTION_MASTER_KEY", "store_id": "<store id>", "secret_name": "pay-connection-master-key"}]
```

## Notify test-ledger registry

The Notify test-wallet credential stays a server registry until the ledger moves to token exchange. `PAY_LEDGER_REGISTRY_JSON` (renamed from `PAY_CREDENTIAL_REGISTRY_JSON`, ledger entries only) is a JSON object keyed by credentialSetId with exactly `{companyId,provider:'notify',environment:'test',purpose:'ledger',workspaceId,secretBinding}`; the binding name must use `PAY_NOTIFY_TEST_LEDGER_[A-Z0-9_]+`. Changed material under the same reference fails fingerprint checks; unknown references fail closed. No credentials are included in this document or config.

## Import and single writer protocol

Source Admin remains authoritative until an explicit per-order transfer. Verify no source invocation is in flight or uncertain. Save a unique generation, exact source snapshot and canonical digest; CAS source admin -> frozen. Import real sandbox messaging_test_payment_orders only. Simulated messaging_payment_orders stay under Admin and cannot become external-provider orders.

Digest is lowercase SHA256 of UTF-8 recursively key-sorted JSON of `{migrationId,generation,order,connection,ledger}`, excluding digest. Preserve every exact original source field and provenance; `order.provenance.quiescentMarker` equals generation. Do not delete source rows. Pay stores the order and staged import atomically. Same exact replay returns its current staged/active/aborted receipt; changed source data or digest conflicts.

After exact staged receipt verification, Admin CASes frozen -> pay for the same generation/digest, then calls activateImport with matching ownership plus `{sourceWriter:'pay',generation,digest}`. Activation is idempotent. Imported financial calls require active status and exact ownership. Lost activation acknowledgements require importStatus or exact activation retry; source stays pay and never falls back to a stale Admin row.

Before activation only: Pay must acknowledge staged -> aborted before Admin unfreezes the matching source generation. Active imports cannot abort. No expiry or blind takeover exists. These RPCs require the trusted Admin-only capability; a browser cannot supply source proof. The source invocation fence and current authorization must be enforced by Admin.

## Recovery and financial invariants

Supply is an integer >=1,000 KRW in steps of1,000; VAT is10%, with safe integer arithmetic. Pay derives VAT and total from its price list; a caller only picks the supply, and a new order's supply is at most `RECHARGE_MAXIMUM_SUPPLY_KRW` (1,000,000). Browser-supplied totals are only compared with the saved order, never used. Only principal credits the test wallet. Provider IDs/amounts/receipt currency and complete cancellation proof must match saved orders. Confirmation identity is confirm:<original id>; ledger credit is payment:<original id>; reservation/cancellation is refund:<original id>. Payment keys stay private.

States: created, confirming, provider_unknown, credit_pending, credited, refund_pending, refund_unknown, refunded. Browser callback parameters never prove provider approval. The wallet is credited only after Pay fetched the provider payment itself (confirm or lookup, server to server) and matched payment key, order id, merchant (`mId` equals the saved connection's `providerAccountId`, so register the Toss MID there), amount, currency, test mode, status and full balance; the observed approval is then stored as credit_pending and the credit uses the idempotency key payment:<order id>. Pay has no webhook endpoint; if one is added it may only trigger such a lookup, never a state change. Reconcile reuses the stored claim and snapshots; missing claim conflicts. Refund persists immutable reason and reserves principal before provider cancellation. Unknown cancellation or settlement retains the hold and refund_unknown. There is no automatic release on ambiguous errors; no release path is enabled here. Reconciliation uses the same operations and receipts.

## Public policies

GET/HEAD /terms, /privacy, /refund, /service fetch only fixed `https://admin.devslab.kr/api/public/policies/pay/:slug`, through optional ADMIN_POLICIES service binding or explicitly enabled PAY_POLICIES_ENABLED fixed-origin transport. No source is configured by default. Requests forward no cookies/authorization, follow no redirects, and have bounded time/body sizes. DTO schema is exact; UTC dates, positive revision, UTF8 64KiB, section/paragraph bounds are validated. Text is escaped with whitespace preserved. Missing/unpublished/unconfigured policy returns503 with no legal seed. All other public paths404; policy mutations405.

## Verification limits

Pure receipt/registry/policy tests and real local D1 tests are local evidence. Scripted failing provider/ledger boundaries test durable uncertainty and hold behavior only; they are not service integration or real financial settlement proof. External Toss approval/refund, Notify settlement/wallet operations, credential calls and SMS/push were NOT run. Activation/deployment and actual single-writer cutover require separately coordinated operational verification.

## Checkout return journal

prepareCheckout requires the active owned test order to remain created with no private payment claim, configured saved references, the external gate and fresh effect authority. It returns only the exact fixed Admin callback URLs and the general test preparation DTO. Nonce issuance has no provider or ledger effect. The random256bit state exists only in those URLs; D1 retains its SHA256 hash, bound actor/company/order/amount/target/generation and10minute unused deadline.

Only private captureCheckoutCallback and hash-only checkoutCaptureStatus bypass the financial gate. Capture derives stored scope from the nonce and checks active imported ownership. Its transactional D1 batch binds the first payment key, consumes the nonce and inserts an immutable receipt. A final SQL CHECK forces any zero-row prerequisite miss to roll back the entire batch. Distinct-key nonces and success/failure races cannot overwrite a claim/outcome. Exact committed replays remain recoverable after the unused-nonce deadline. A failure consumes only its nonce. No callback changes financial state, proves payment, authorizes a session or performs a provider/ledger call.

The final redirect target is chosen at prepareCheckout from the `CHECKOUT_RETURN_REGISTRY` of `@devslab-kr/pay-contract` (a `{service, path}` entry, never a URL; `returnTarget` alone means that service's default entry), saved immutably with the nonce (`return_path`, migration 0002) and returned as `returnTo` in the capture result; a saved path the registry no longer lists fails closed. Admin owns public callback parsing and the 303 redirect, built with the contract's `checkoutReturnUrl`, without payment key/state in the Location. It must reject duplicate required query fields and must not log callback URLs, raw queries, keys, state or provider errors. Actual logging collectors need review before checkout activation.

## Fresh authority for every effect

dispatch(command,effectAuthority?) accepts a separate ephemeral RPC capability with only check():Promise<boolean>. It is never a JSON command field, token, role, database row or reusable session. Admin binds an actual RpcTarget with private request/authority fields, rechecks current policy on every check, and closes it in finally. Pay holds it only in the awaited dispatch lifetime and performs no background financial work.

Each provider/ledger call rechecks the current external gate and awaits exact true from that capability. Missing, throwing, false or closed capabilities deny before the effect. An observed approval is durably credit_pending before a later ledger authorization check. A strictly verified cancellation transaction is stored privately with an immutable-first-proof trigger before a later finalize check. Revocation keeps those facts and the principal hold; it never fabricates ledger settlement or starts a new operation.

The built local smoke is npm run test:worker after npm run build; it uses an actual named PayService binding and actual RpcTarget with real local D1 and outbound blocked. Scripted provider responses in unit tests prove ordering and retained local facts only, not external approval or settlement.

Failure callbacks accept an optional bounded orderId and reject a mismatch before any journal write. Buyer cancellation may omit it. The immutable failure digest retains optional orderId/code presence and value without exposing provider errors. Expired unused state hashes produce a generic error; committed receipts still replay after expiry. Explicit reconcile resumes refund_pending/refund_unknown with the original saved reason, refund operation and known proof, under fresh authority and the external gate.

Legacy import may carry the exact verified provider_refund_id from the source private cancellation journal. Pay accepts a bounded proof only with its refund state, original reason and private payment identity, saves it privately and immutably, and includes its presence/value in the frozen digest. Older saved payloads without the optional field retain their exact source JSON/digest; no proof is inferred.
