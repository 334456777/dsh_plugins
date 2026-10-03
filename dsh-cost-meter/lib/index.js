/**
 * dsh-cost-meter — host half.
 *
 * The plugin's user-visible surface is a CLIENT UI line (the composer dock cost
 * readout), but its prices are not code: they live in `config/pricing.json`
 * next to this package. A browser cannot read files, so this host half reads
 * that one file and serves it to the client half at `ROUTE`. The client merges
 * what it receives over its built-in fallback, which means:
 *
 *   - editing `config/pricing.json` re-prices the dock with no code edit and no
 *     rebuild (the file is revalidated on every request by mtime and size),
 *   - a broken JSON file is answered as 500 with the parse error, and the client
 *     keeps its last good or built-in rates instead of showing wrong money,
 *   - a composition without the `webServer` service (the Electron `file://`
 *     shell) simply skips the route; the client falls back to shipped defaults.
 *
 * The plugin is otherwise purely a surface: it declares no model-facing tools,
 * sends no provider request, and contributes nothing to the system prompt.
 */

import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** Plugin identity, mirroring the documented `export const name` shape. */
export const name = "dsh-cost-meter";

/**
 * `webServer` is a soft dependency: it is declared so the browser-facing
 * composition loads this half after the HTTP carrier exists, and the body
 * guards on its absence so a shell without one still loads the plugin.
 */
export const inject = ["webServer"];

/** Absolute pathname the browser asks for; the client resolves it relatively. */
export const ROUTE = "/dsh-cost-meter/pricing.json";

/** Guards a browser fetch of this route to this machine's own origins. */
function isLoopbackOrigin(origin) {
	try {
		const { hostname } = new URL(origin);
		return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
	} catch {
		return false;
	}
}

/** Package root, derived from this module's own URL (never a hardcoded path). */
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
/** The one config file this plugin reads. */
const CONFIG_PATH = fileURLToPath(new URL("../config/pricing.json", import.meta.url));

/** Last parsed config, keyed by the file's identity so edits are still picked up. */
let cache = null;

/**
 * Read the config file, reusing the last parse only while the file's size and
 * mtime are unchanged.
 * @returns the file text, after validating it parses as JSON.
 * @throws when the file is missing or not valid JSON.
 */
async function readConfigText() {
	const info = await stat(CONFIG_PATH);
	const identity = `${info.size}:${info.mtimeMs}`;
	if (cache !== null && cache.identity === identity) return cache.text;
	const text = await readFile(CONFIG_PATH, "utf8");
	// Parse before caching, so a syntax error is reported instead of served.
	JSON.parse(text);
	cache = { identity, text };
	return text;
}

/** Answer one request. The handler owns the whole response lifecycle. */
async function handle(req, res) {
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.statusCode = 405;
		res.setHeader("Allow", "GET, HEAD");
		res.end();
		return;
	}
	// Loopback-only surface: refuse cross-origin readers so no page can probe
	// the plugin's configuration through a browser on this machine.
	const origin = req.headers.origin;
	if (typeof origin === "string" && origin !== "" && !isLoopbackOrigin(origin)) {
		res.statusCode = 403;
		res.setHeader("Content-Type", "text/plain; charset=utf-8");
		res.end("cross-origin read denied\n");
		return;
	}
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	res.setHeader("X-Content-Type-Options", "nosniff");
	try {
		const text = await readConfigText();
		res.statusCode = 200;
		if (req.method === "HEAD") {
			res.setHeader("Content-Length", Buffer.byteLength(text));
			res.end();
			return;
		}
		res.end(text);
	} catch (error) {
		// The client treats this as "keep the rates I already have", and the
		// response body names the exact file so a broken edit is one look away.
		res.statusCode = 500;
		res.end(JSON.stringify({
			error: "dsh-cost-meter: config/pricing.json is missing or is not valid JSON",
			file: "config/pricing.json",
			package: PACKAGE_ROOT,
			detail: error instanceof Error ? error.message : String(error)
		}));
	}
}

/**
 * Host plugin body: serve `config/pricing.json` to the browser when an HTTP
 * carrier exists. Without one the plugin still loads — the client half then
 * uses its built-in fallback rates.
 * @param ctx - the plugin context.
 */
export function apply(ctx) {
	console.log(`[dsh-cost-meter] plugin loaded!`);
	let webServer = null;
	try {
		webServer = ctx.get("webServer");
	} catch {
		webServer = null;
	}
	if (webServer === null || webServer === void 0) {
		console.info("[dsh-cost-meter] no webServer in this composition; the client will use its built-in rates");
		return;
	}
	ctx.effect(() => webServer.register({
		kind: "exact",
		path: ROUTE,
		handler: handle
	}), "cost-meter: pricing config route");
	console.info(`[dsh-cost-meter] serving ${CONFIG_PATH} at ${ROUTE}`);
}
