-- Company-registered Toss test accounts (pay-contract 0.3.0). Replaces the env-JSON payment registry.
-- New tables only: no existing table is rebuilt and no foreign key reaches an existing table.
-- sealed_credentials is an envelope (src/vault.ts) bound to company, connection and version; the keys are
-- never stored in clear. Only the client-key hint (last 4 characters) and the fingerprint are readable.
CREATE TABLE payment_connections (
 id TEXT PRIMARY KEY CHECK(length(id)=36 AND substr(id,1,4)='pcv_' AND substr(id,5) NOT GLOB '*[^a-f0-9]*'),
 company_id TEXT NOT NULL CHECK(length(company_id) BETWEEN 1 AND 200),
 provider TEXT NOT NULL CHECK(provider='toss'),
 environment TEXT NOT NULL CHECK(environment='test'),
 version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version>=1),
 status TEXT NOT NULL CHECK(status IN ('active','superseded','revoked')),
 merchant_id TEXT NOT NULL CHECK(length(merchant_id) BETWEEN 2 AND 64 AND merchant_id NOT GLOB '*[^A-Za-z0-9_-]*'),
 sealed_credentials TEXT NOT NULL CHECK(substr(sealed_credentials,1,3)='m1.'),
 client_key_hint TEXT NOT NULL CHECK(length(client_key_hint)=4),
 fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64 AND fingerprint NOT GLOB '*[^a-f0-9]*'),
 actor_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 revoked_at TEXT,
 CHECK((status='revoked')=(revoked_at IS NOT NULL)),
 UNIQUE(company_id,version)
);
-- statement
CREATE UNIQUE INDEX payment_connections_one_active ON payment_connections(company_id) WHERE status='active';
-- statement
CREATE TRIGGER payment_connection_material_immutable BEFORE UPDATE OF id,company_id,provider,environment,version,merchant_id,sealed_credentials,client_key_hint,fingerprint,actor_id,created_at ON payment_connections BEGIN SELECT RAISE(ABORT,'immutable payment connection'); END;
-- statement
CREATE TRIGGER payment_connection_status_forward BEFORE UPDATE OF status ON payment_connections WHEN NOT ((OLD.status='active' AND NEW.status IN ('superseded','revoked')) OR (OLD.status='superseded' AND NEW.status='revoked')) BEGIN SELECT RAISE(ABORT,'payment connection status only moves forward'); END;
-- statement
CREATE TRIGGER payment_connection_no_delete BEFORE DELETE ON payment_connections BEGIN SELECT RAISE(ABORT,'payment connection versions are kept'); END;
-- statement
CREATE TABLE payment_connection_audit (
 id TEXT PRIMARY KEY,
 company_id TEXT NOT NULL,
 connection_id TEXT NOT NULL REFERENCES payment_connections(id),
 action TEXT NOT NULL CHECK(action IN ('connect','revoke')),
 actor_id TEXT NOT NULL,
 evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
 created_at TEXT NOT NULL
);
-- statement
CREATE INDEX payment_connection_audit_company ON payment_connection_audit(company_id,created_at DESC);
-- statement
CREATE TRIGGER payment_connection_audit_no_update BEFORE UPDATE ON payment_connection_audit BEGIN SELECT RAISE(ABORT,'immutable payment connection audit'); END;
-- statement
CREATE TRIGGER payment_connection_audit_no_delete BEFORE DELETE ON payment_connection_audit BEGIN SELECT RAISE(ABORT,'immutable payment connection audit'); END;
