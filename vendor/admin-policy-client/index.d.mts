import { type PublicPolicyBundle } from './policy-v3.js';
import { type PolicySlugId } from './policy.js';
/** Fixed-origin, read-only transport. The deadline covers headers and the complete streamed body. */
export declare function fetchPublicPolicyBundle(input: {
    serviceId: string;
    slug: PolicySlugId;
    groupId?: string;
    requestedLocale?: string;
    fetcher?: typeof fetch;
}): Promise<PublicPolicyBundle>;
