-- Checkout return registry (pay-contract 0.2.0). The final redirect path chosen at prepareCheckout, from
-- CHECKOUT_RETURN_REGISTRY. NULL = a nonce issued before this migration: the default path of return_target.
-- Pay validates the value against the registry on write and on read; this CHECK only bounds its shape.
ALTER TABLE checkout_nonces ADD COLUMN return_path TEXT CHECK(return_path IS NULL OR (length(return_path) BETWEEN 2 AND 200 AND substr(return_path,1,1)='/' AND substr(return_path,2,1)<>'/' AND return_path NOT GLOB '*[^A-Za-z0-9/_-]*' AND instr(return_path,'..')=0));
-- statement
CREATE TRIGGER checkout_return_path_immutable BEFORE UPDATE OF return_path ON checkout_nonces BEGIN SELECT RAISE(ABORT,'immutable checkout snapshot'); END;
