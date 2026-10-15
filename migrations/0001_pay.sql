-- Independent Pay database. Opaque company/user IDs remain Admin-owned.
CREATE TABLE credential_material (
 credential_set_id TEXT PRIMARY KEY,
 company_id TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('payment','ledger')),
 fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64 AND fingerprint NOT GLOB '*[^a-f0-9]*')
);
-- statement
CREATE TRIGGER credential_material_immutable BEFORE UPDATE ON credential_material BEGIN SELECT RAISE(ABORT,'immutable credential reference'); END;
-- statement
CREATE TABLE integration_versions (
 kind TEXT NOT NULL CHECK(kind IN ('payment','ledger')),
 integration_id TEXT NOT NULL,
 revision TEXT NOT NULL,
 company_id TEXT NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 fingerprint TEXT NOT NULL,
 PRIMARY KEY(kind,integration_id,revision)
);
-- statement
CREATE TRIGGER integration_versions_immutable BEFORE UPDATE ON integration_versions BEGIN SELECT RAISE(ABORT,'immutable integration version'); END;
-- statement
CREATE TABLE payment_orders (
 id TEXT PRIMARY KEY,
 company_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 provider_order_id TEXT NOT NULL UNIQUE,
 idempotency_key TEXT NOT NULL,
 environment TEXT NOT NULL DEFAULT 'test' CHECK(environment='test'),
 purpose TEXT NOT NULL DEFAULT 'messaging_recharge' CHECK(purpose='messaging_recharge'),
 provider TEXT NOT NULL DEFAULT 'toss' CHECK(provider='toss'),
 supply_krw INTEGER NOT NULL CHECK(typeof(supply_krw)='integer' AND supply_krw>=1000 AND supply_krw%1000=0),
 vat_krw INTEGER NOT NULL CHECK(typeof(vat_krw)='integer' AND vat_krw=supply_krw/10),
 total_krw INTEGER NOT NULL CHECK(typeof(total_krw)='integer' AND total_krw=supply_krw+vat_krw AND total_krw<=9007199254740991),
 currency TEXT NOT NULL DEFAULT 'KRW' CHECK(currency='KRW'),
 state TEXT NOT NULL DEFAULT 'created' CHECK(state IN ('created','confirming','provider_unknown','credit_pending','credited','refund_pending','refund_unknown','refunded')),
 payment_key TEXT UNIQUE,
 refund_reason TEXT,
 provider_refund_id TEXT,
 connection_json TEXT NOT NULL CHECK(json_valid(connection_json)),
 ledger_json TEXT NOT NULL CHECK(json_valid(ledger_json)),
 provider_fingerprint TEXT NOT NULL CHECK(length(provider_fingerprint)=64 AND provider_fingerprint NOT GLOB '*[^a-f0-9]*'),
 ledger_fingerprint TEXT NOT NULL CHECK(length(ledger_fingerprint)=64 AND ledger_fingerprint NOT GLOB '*[^a-f0-9]*'),
 origin TEXT NOT NULL DEFAULT 'native' CHECK(origin IN ('native','legacy')),
 legacy_mode TEXT CHECK(legacy_mode IS NULL OR legacy_mode='sandbox'),
 provenance_json TEXT CHECK(provenance_json IS NULL OR json_valid(provenance_json)),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(typeof(revision)='integer' AND revision>=1),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(company_id,idempotency_key)
);
-- statement
CREATE INDEX payment_orders_company_history ON payment_orders(company_id,created_at DESC,id DESC);
-- statement
CREATE INDEX payment_orders_self_history ON payment_orders(company_id,user_id,created_at DESC,id DESC);
-- statement
CREATE TRIGGER payment_snapshot_immutable BEFORE UPDATE OF id,company_id,user_id,provider_order_id,idempotency_key,environment,purpose,provider,supply_krw,vat_krw,total_krw,currency,connection_json,ledger_json,provider_fingerprint,ledger_fingerprint,origin,legacy_mode,provenance_json,created_at ON payment_orders BEGIN SELECT RAISE(ABORT,'immutable payment snapshot'); END;
-- statement
CREATE TRIGGER payment_claim_immutable BEFORE UPDATE OF payment_key ON payment_orders WHEN OLD.payment_key IS NOT NULL AND NEW.payment_key IS NOT OLD.payment_key BEGIN SELECT RAISE(ABORT,'immutable payment identity'); END;
-- statement
CREATE TRIGGER payment_refund_reason_immutable BEFORE UPDATE OF refund_reason ON payment_orders WHEN OLD.refund_reason IS NOT NULL AND NEW.refund_reason IS NOT OLD.refund_reason BEGIN SELECT RAISE(ABORT,'immutable refund reason'); END;
-- statement
CREATE TABLE payment_imports (
 order_id TEXT PRIMARY KEY REFERENCES payment_orders(id),
 migration_id TEXT NOT NULL,
 generation TEXT NOT NULL,
 digest TEXT NOT NULL CHECK(length(digest)=64 AND digest NOT GLOB '*[^a-f0-9]*'),
 source_json TEXT NOT NULL CHECK(json_valid(source_json)),
 status TEXT NOT NULL CHECK(status IN ('staged','active','aborted')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(migration_id,order_id)
);
-- statement
CREATE TRIGGER payment_import_snapshot_immutable BEFORE UPDATE OF order_id,migration_id,generation,digest,source_json,created_at ON payment_imports BEGIN SELECT RAISE(ABORT,'immutable import snapshot'); END;
-- statement
CREATE TRIGGER payment_import_terminal BEFORE UPDATE OF status ON payment_imports WHEN OLD.status IN ('active','aborted') AND NEW.status IS NOT OLD.status BEGIN SELECT RAISE(ABORT,'terminal import ownership'); END;
-- statement
CREATE TABLE checkout_nonces (
 state_hash TEXT PRIMARY KEY CHECK(length(state_hash)=64 AND state_hash NOT GLOB '*[^a-f0-9]*'),
 order_id TEXT NOT NULL REFERENCES payment_orders(id),
 company_id TEXT NOT NULL,
 subject TEXT NOT NULL,
 scope_access TEXT NOT NULL CHECK(scope_access IN ('self','company')),
 provider_order_id TEXT NOT NULL,
 total_krw INTEGER NOT NULL,
 return_target TEXT NOT NULL CHECK(return_target IN ('contract','admin')),
 ownership_json TEXT CHECK(ownership_json IS NULL OR json_valid(ownership_json)),
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL,
 consumed_at TEXT,
 result TEXT NOT NULL DEFAULT 'pending' CHECK(result IN ('pending','captured','failed')),
 callback_digest TEXT
);
-- statement
CREATE INDEX checkout_order_history ON checkout_nonces(order_id,created_at DESC);
-- statement
CREATE TRIGGER checkout_snapshot_immutable BEFORE UPDATE OF state_hash,order_id,company_id,subject,scope_access,provider_order_id,total_krw,return_target,ownership_json,expires_at,created_at ON checkout_nonces BEGIN SELECT RAISE(ABORT,'immutable checkout snapshot'); END;
-- statement
CREATE TRIGGER checkout_consumed_immutable BEFORE UPDATE ON checkout_nonces WHEN OLD.result<>'pending' BEGIN SELECT RAISE(ABORT,'consumed checkout'); END;

-- statement
CREATE TABLE checkout_capture_receipts (
 state_hash TEXT PRIMARY KEY REFERENCES checkout_nonces(state_hash),
 callback_digest TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('captured','failed')),
 committed_at TEXT NOT NULL,
 receipt_guard INTEGER NOT NULL CHECK(receipt_guard=1)
);
-- statement
CREATE TRIGGER checkout_receipts_immutable BEFORE UPDATE ON checkout_capture_receipts BEGIN SELECT RAISE(ABORT,'immutable callback receipt'); END;


-- statement
CREATE TRIGGER payment_refund_proof_immutable BEFORE UPDATE OF provider_refund_id ON payment_orders WHEN OLD.provider_refund_id IS NOT NULL AND NEW.provider_refund_id IS NOT OLD.provider_refund_id BEGIN SELECT RAISE(ABORT,'immutable refund proof'); END;
