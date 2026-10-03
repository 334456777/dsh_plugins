/**
 * dsh-cost-meter — host half.
 *
 * The user-visible surface is a CLIENT UI line (the composer dock cost readout),
 * but its prices are not code: they live in `config/pricing.json`. A browser
 * cannot read files, so this half serves that one file over an HTTP route; the
 * client merges what it receives over its built-in fallback.
 */

/** Plugin identity, mirroring the documented `export const name` shape. */
export declare const name: string;
/** Soft dependency: the HTTP carrier that serves the config route. */
export declare const inject: string[];
/** Absolute pathname the browser asks for; the client resolves it relatively. */
export declare const ROUTE: string;
/** Register the pricing-config route when a web server is available. */
export declare function apply(ctx: unknown): void;
