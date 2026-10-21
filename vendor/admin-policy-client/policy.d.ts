/** Sites whose public policies Admin publishes. */
export declare const POLICY_SITE_IDS: readonly ['contract', 'notify', 'pay', 'admin', 'devslab'];
export type PolicySiteId = typeof POLICY_SITE_IDS[number];
export declare const POLICY_SLUG_IDS: readonly ['terms', 'privacy', 'refund', 'service'];
export type PolicySlugId = typeof POLICY_SLUG_IDS[number];
/**
 * Languages Admin can publish a policy in today; every site supports at least `ko` and `en`. Envelopes
 * carry locales as canonical BCP 47 tags, so a language Admin adds later still parses.
 */
export declare const POLICY_LOCALE_IDS: readonly ['ko', 'en', 'ja', 'zh-HK', 'zh-TW', 'hi', 'vi', 'id', 'th', 'pt-BR', 'fr', 'de', 'es', 'ar'];
export type PolicyLocaleId = typeof POLICY_LOCALE_IDS[number];
/** Serialized size limits: one document's JSON, and the whole public v2 envelope. */
export declare const POLICY_DOCUMENT_MAX_BYTES: number;
export declare const POLICY_ENVELOPE_MAX_BYTES: number;
export interface PolicySection {
    title: string;
    paragraphs: string[];
}
/** The editable content of one policy revision. `effectiveAt` is a calendar date (YYYY-MM-DD). */
export interface PolicyContent {
    title: string;
    description: string;
    sections: PolicySection[];
    effectiveAt: string;
}
/** A published revision as Admin serves it (v1 body, and `document` of the v2 envelope). */
export interface PublishedPolicy extends PolicyContent {
    site: string;
    slug: string;
    revision: number;
    publishedAt: string;
}
/** GET /api/public/policies/v2/{site}/{slug}[/{locale}]: the published document in the best language. */
export interface PublicPolicyEnvelope {
    schemaVersion: 2;
    /** Canonical form of the requested locale (or the site default when none was requested). */
    requestedLocale: string;
    /** The served locale; one of POLICY_LOCALE_IDS today, any canonical tag tomorrow. */
    locale: string;
    fallback: boolean;
    settingsRevision: number;
    defaultLocale: string;
    supportedLocales: string[];
    document: PublishedPolicy;
    translation: {
        sourceLocale: 'ko';
        sourceRevision: number;
        currentSourceRevision: number;
        needsUpdate: boolean;
    };
}
/** The canonical BCP 47 form Admin uses for a requested locale, or undefined when Admin answers 400. */
export declare function canonicalPolicyLocale(value: unknown): string | undefined;
export declare const POLICY_SUPPORTED_LOCALES_MAX = 64;
/** A published document (Admin's content rules, plus a registered site and slug). Extra fields are rejected. */
export declare function parsePublishedPolicy(value: unknown): PublishedPolicy;
/**
 * The v2 envelope with Admin's invariants: unique supported locales including ko, en, the default and the
 * served locale; `fallback` exactly when the served locale differs from the requested one; Korean is the
 * source, so it never needs an update and a translation needs one exactly when its source revision is behind.
 */
export declare function parsePublicPolicyEnvelope(value: unknown): PublicPolicyEnvelope;
