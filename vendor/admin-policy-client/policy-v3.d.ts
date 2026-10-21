import { type PolicySlugId, type PolicyContent } from './policy.js';
export interface PolicyService {
    id: string;
    groupId: string;
    name: string;
    defaultLocale: string;
    supportedLocales: string[];
    revision: number;
    enabled: boolean;
}
export interface PolicySourceRef {
    documentId: string;
    revision: number;
    locale: string;
    sourceRevision: number;
    currentSourceRevision: number;
    needsUpdate: boolean;
}
export interface PublicPolicyBundle {
    schemaVersion: 3;
    serviceId: string;
    groupId: string;
    slug: PolicySlugId;
    requestedLocale: string;
    locale: string;
    fallback: boolean;
    defaultLocale: string;
    supportedLocales: string[];
    bundle: {
        id: string;
        revision: number;
        publishedAt: string;
    };
    document: PolicyContent;
    sources: {
        common: PolicySourceRef;
        supplement: PolicySourceRef | null;
    };
}
export declare function policyIdentity(value: unknown): string;
export declare function parseBundleContent(value: unknown): PolicyContent;
export declare function parsePublicPolicyBundle(value: unknown, expected: {
    serviceId: string;
    slug: PolicySlugId;
    requestedLocale?: string;
    groupId?: string;
}): PublicPolicyBundle;
