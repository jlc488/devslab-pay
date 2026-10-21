// packages/admin-contract/src/errors.ts
var AdminContractError = class extends Error {
  constructor(code, message, reason = null) {
    super(message);
    this.code = code;
    this.name = "AdminContractError";
    this.reason = reason;
  }
  code;
  reason;
};

// packages/admin-contract/src/internal.ts
function fail(what2) {
  throw new AdminContractError("invalid_response", `Admin ${what2} response does not match the contract.`);
}
function record(value, what2) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(what2);
  return value;
}
function list(value, max, what2) {
  if (!Array.isArray(value) || value.length > max) fail(what2);
  return value;
}
function text(value, max, what2) {
  if (typeof value !== "string" || value.length === 0 || value.length > max) fail(what2);
  return value;
}
function bool(value, what2) {
  if (typeof value !== "boolean") fail(what2);
  return value;
}
function count(value, what2) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(what2);
  return value;
}
function positive(value, what2) {
  const v = count(value, what2);
  if (v < 1) fail(what2);
  return v;
}
var UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function utcTimestamp(value, what2) {
  if (typeof value !== "string" || !UTC_TIMESTAMP_PATTERN.test(value)) fail(what2);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) fail(what2);
  return value;
}

// packages/admin-contract/src/policy.ts
var POLICY_SLUG_IDS = ["terms", "privacy", "refund", "service"];
var POLICY_DOCUMENT_MAX_BYTES = 64 * 1024;
var POLICY_ENVELOPE_MAX_BYTES = 68 * 1024;
function canonicalPolicyLocale(value) {
  if (typeof value !== "string" || value.length > 35 || !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(value)) return void 0;
  try {
    const locale2 = Intl.getCanonicalLocales(value)[0];
    return locale2 !== void 0 && locale2.length <= 35 ? locale2 : void 0;
  } catch {
    return void 0;
  }
}

// packages/admin-contract/src/policy-v3.ts
var what = "policy v3";
function keys(v, names) {
  if (Object.keys(v).length !== names.length || names.some((k) => !Object.hasOwn(v, k))) fail(what);
}
function policyIdentity(value) {
  const v = text(value, 64, what);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)) fail(what);
  return v;
}
function locale(value) {
  if (typeof value !== "string" || canonicalPolicyLocale(value) !== value) fail(what);
  return value;
}
function policyText(value, max) {
  const v = text(value, max, what);
  if (!v.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) fail(what);
  return v;
}
function parseBundleContent(value) {
  const v = record(value, what);
  keys(v, ["title", "description", "sections", "effectiveAt"]);
  const date = text(v.effectiveAt, 10, what);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + "T00:00:00Z")) || (/* @__PURE__ */ new Date(date + "T00:00:00Z")).toISOString().slice(0, 10) !== date) fail(what);
  const sections = list(v.sections, 64, what).map((item) => {
    const s = record(item, what);
    keys(s, ["title", "paragraphs"]);
    const paragraphs = list(s.paragraphs, 128, what).map((p) => policyText(p, 4e3));
    if (!paragraphs.length) fail(what);
    return { title: policyText(s.title, 200), paragraphs };
  });
  if (!sections.length) fail(what);
  const document = { title: policyText(v.title, 200), description: policyText(v.description, 1e3), effectiveAt: date, sections };
  if (new TextEncoder().encode(JSON.stringify(document)).byteLength > POLICY_DOCUMENT_MAX_BYTES) fail(what);
  return document;
}
function source(value, servedLocale) {
  const v = record(value, what);
  keys(v, ["documentId", "revision", "locale", "sourceRevision", "currentSourceRevision", "needsUpdate"]);
  const s = { documentId: policyIdentity(v.documentId), revision: positive(v.revision, what), locale: locale(v.locale), sourceRevision: count(v.sourceRevision, what), currentSourceRevision: count(v.currentSourceRevision, what), needsUpdate: bool(v.needsUpdate, what) };
  if (s.locale !== servedLocale || s.sourceRevision > s.currentSourceRevision || s.locale === "ko" && (s.sourceRevision !== s.revision || s.currentSourceRevision !== s.revision) || s.needsUpdate !== (s.locale !== "ko" && s.sourceRevision < s.currentSourceRevision)) fail(what);
  return s;
}
function parsePublicPolicyBundle(value, expected) {
  const v = record(value, what);
  keys(v, ["schemaVersion", "serviceId", "groupId", "slug", "requestedLocale", "locale", "fallback", "defaultLocale", "supportedLocales", "bundle", "document", "sources"]);
  const b = record(v.bundle, what), refs = record(v.sources, what);
  keys(b, ["id", "revision", "publishedAt"]);
  keys(refs, ["common", "supplement"]);
  const serviceId = policyIdentity(v.serviceId), groupId = policyIdentity(v.groupId), servedLocale = locale(v.locale), requestedLocale = locale(v.requestedLocale), defaultLocale = locale(v.defaultLocale);
  const supportedLocales = list(v.supportedLocales, 64, what).map(locale);
  if (v.schemaVersion !== 3 || serviceId !== expected.serviceId || expected.groupId && groupId !== expected.groupId || v.slug !== expected.slug || !POLICY_SLUG_IDS.includes(v.slug) || new Set(supportedLocales).size !== supportedLocales.length || !supportedLocales.includes(defaultLocale) || !supportedLocales.includes(servedLocale) || !supportedLocales.includes("ko") || requestedLocale !== (expected.requestedLocale ?? defaultLocale)) fail(what);
  const fallback = bool(v.fallback, what);
  if (fallback !== (requestedLocale !== servedLocale)) fail(what);
  const result = { schemaVersion: 3, serviceId, groupId, slug: expected.slug, requestedLocale, locale: servedLocale, fallback, defaultLocale, supportedLocales, bundle: { id: policyIdentity(b.id), revision: positive(b.revision, what), publishedAt: utcTimestamp(b.publishedAt, what) }, document: parseBundleContent(v.document), sources: { common: source(refs.common, servedLocale), supplement: refs.supplement === null ? null : source(refs.supplement, servedLocale) } };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > POLICY_ENVELOPE_MAX_BYTES) fail(what);
  return result;
}

// packages/admin-contract/src/policy-client.ts
async function fetchPublicPolicyBundle(input) {
  const serviceId = policyIdentity(input.serviceId);
  if (!POLICY_SLUG_IDS.includes(input.slug)) throw new Error("Invalid policy slug");
  const locale2 = input.requestedLocale === void 0 ? void 0 : canonicalPolicyLocale(input.requestedLocale);
  if (input.requestedLocale !== void 0 && !locale2) throw new Error("Invalid policy locale");
  const controller = new AbortController();
  let timer, reader;
  try {
    return await Promise.race([
      (async () => {
        const response = await (input.fetcher ?? fetch)("https://admin.devslab.kr/api/public/policies/v3/services/" + serviceId + "/" + input.slug + (locale2 ? "/" + encodeURIComponent(locale2) : ""), { method: "GET", credentials: "omit", redirect: "manual", cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal });
        if (response.status !== 200 || response.redirected || !response.body || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
          await response.body?.cancel().catch(() => {
          });
          throw new Error("Policy publication unavailable");
        }
        const bodyReader = response.body.getReader();
        reader = bodyReader;
        const chunks = [];
        let length = 0;
        for (; ; ) {
          const next = await bodyReader.read();
          if (next.done) break;
          length += next.value.length;
          if (length > POLICY_ENVELOPE_MAX_BYTES) {
            await bodyReader.cancel();
            throw new Error("Policy publication too large");
          }
          chunks.push(next.value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        return parsePublicPolicyBundle(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), { serviceId, slug: input.slug, ...input.groupId ? { groupId: input.groupId } : {}, ...locale2 ? { requestedLocale: locale2 } : {} });
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          void reader?.cancel().catch(() => {
          });
          reject(new Error("Policy publication deadline exceeded"));
        }, 5e3);
      })
    ]);
  } finally {
    if (timer !== void 0) clearTimeout(timer);
    controller.abort();
    reader?.releaseLock();
  }
}
export {
  fetchPublicPolicyBundle
};
