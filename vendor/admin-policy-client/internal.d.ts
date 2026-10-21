export declare function fail(what: string): never;
export declare function record(value: unknown, what: string): Record<string, unknown>;
export declare function list(value: unknown, max: number, what: string): unknown[];
/** Non-empty string of at most `max` UTF-16 units. */
export declare function text(value: unknown, max: number, what: string): string;
export declare function nullableText(value: unknown, max: number, what: string): string | null;
/** Non-empty, already trimmed, no C0 control characters or DEL. */
export declare function identifier(value: unknown, max: number, what: string): string;
export declare function bool(value: unknown, what: string): boolean;
export declare function count(value: unknown, what: string): number;
export declare function positive(value: unknown, what: string): number;
export declare function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T;
/** Any timestamp `Date.parse` understands, at most 40 characters (rows Admin stored itself). */
export declare function timestamp(value: unknown, what: string): string;
export declare const UTC_TIMESTAMP_PATTERN: RegExp;
/** `Date#toISOString()` output: what Admin writes for timestamps it creates in a response. */
export declare function utcTimestamp(value: unknown, what: string): string;
