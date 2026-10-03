/**
 * dsh-cost-meter — pricing configuration layer (browser half).
 *
 * NOT loaded at runtime: `lib/client.js` is the shipped browser bundle and
 * carries its own inlined copy of everything below (the client-modules loader
 * materializes one self-contained module per plugin, so a relative `require`
 * would throw). Keep this file as the readable source of that logic and keep
 * the two copies in step.
 *
 * The rate card, the peak-window rule, and the display currency are DATA, not
 * code. They live in the package's own `config/pricing.json`, which the host
 * half of this plugin serves at `CONFIG_ROUTE`; this module fetches it and
 * merges it over the built-in fallback below, so:
 *
 *   - editing `config/pricing.json` changes billing without touching or
 *     rebuilding any code,
 *   - an unreachable or malformed config file never breaks the dock — the
 *     last good (or built-in) snapshot keeps the line correct.
 *
 * Peak/off-peak follows DeepSeek's published rule in Asia/Shanghai time
 * (Beijing, no DST): Monday–Friday 09:00–12:00 and 14:00–18:00 are peak; every
 * other moment — including weekends and Chinese statutory holidays — is
 * off-peak. The multiplier for each band is part of the config, so a future
 * flat or differently-shaped rate card needs no code change either.
 */

/** Where the host half serves `config/pricing.json` (document-relative URL). */
const CONFIG_ROUTE = "dsh-cost-meter/pricing.json";
/** How often the browser re-reads the served config, in ms. */
const CONFIG_REFRESH_MS = 5 * 60 * 1e3;
/** sessionStorage key holding the last successfully loaded config. */
const CONFIG_CACHE_KEY = "dsh-cost-meter.pricing";
/** UTC offset of Asia/Shanghai (no DST). */
const BEIJING_OFFSET_MINUTES = 480;
/** Default CNY→target refresh window when the config does not say otherwise. */
const DEFAULT_FX_REFRESH_MS = 60 * 1e3;

/**
 * Built-in fallback rate card — the official, OFF-PEAK prices in CNY per 1M
 * tokens, mirroring the shipped `config/pricing.json` as of 2026-10-04. It
 * carries only the current models: the retired `deepseek-chat` /
 * `deepseek-reasoner` rows live in the config file alone, so an unreachable
 * config hides them instead of billing an archived price this file cannot
 * document. Source: https://api-docs.deepseek.com/zh-cn/quick_start/pricing
 *
 * It is used only when the served config file is missing, unreadable, or
 * malformed. Keep it in sync with the config file when it changes, so a fresh
 * install still prices correctly before the first successful fetch.
 */
const FALLBACK_PRICING = {
	"deepseek-flash": { cacheHit: 0.02, cacheMiss: 1, output: 4 },
	"deepseek-v4-flash": { cacheHit: 0.02, cacheMiss: 1, output: 4 },
	"deepseek-v4-flash-vision-exp": { cacheHit: 0.02, cacheMiss: 1, output: 4 },
	"deepseek-v4-pro": { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 }
};
/** Fallback model id used before the model directory reports a selection. */
const FALLBACK_DEFAULT_MODEL = "deepseek-flash";
/**
 * Built-in fallback billing rule: the official peak windows in Beijing time and
 * the published 2× peak multiplier. `holidays` stays empty here — the calendar
 * is deployment data, so it belongs to the config file, not to the code.
 */
const FALLBACK_BILLING = {
	offPeakMultiplier: 1,
	peakMultiplier: 2,
	peakZone: "Asia/Shanghai",
	peakWindows: [
		{ days: [1, 2, 3, 4, 5], start: "09:00", end: "12:00" },
		{ days: [1, 2, 3, 4, 5], start: "14:00", end: "18:00" }
	],
	holidays: []
};
/** Built-in display fallback: plain CNY; conversion (live CNY→JPY) is opt-in via `enabled`. */
const FALLBACK_DISPLAY = {
	currency: {
		enabled: false,
		code: "JPY",
		symbol: "円",
		source: "feed",
		fixedRate: 21,
		feed: {
			url: "https://open.er-api.com/v6/latest/CNY",
			ratePath: "rates.JPY",
			refreshMs: DEFAULT_FX_REFRESH_MS
		}
	}
};

/** Read a finite number, falling back when the value is absent or unusable. */
function num(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
/** Read a non-empty string, falling back otherwise. */
function str(value, fallback) {
	return typeof value === "string" && value.trim() !== "" ? value : fallback;
}
/** Read a positive finite number, falling back otherwise. */
function positive(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
/**
 * Accept only a `HH:MM` (or `H:MM`) wall-clock time.
 * @returns the canonical `HH:MM` form, or null when the value is not a time.
 */
function parseClock(value) {
	if (typeof value !== "string") return null;
	const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
	if (match === null) return null;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour > 23 || minute > 59) return null;
	return String(hour).padStart(2, "0") + ":" + match[2];
}
/** Wall-clock minutes since midnight, or null when the value is not a time. */
function clockMinutes(value) {
	const clock = parseClock(value);
	if (clock === null) return null;
	return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
}
/** Normalize one peak window; returns null when it has no usable time range. */
function normalizeWindow(raw) {
	if (raw === null || typeof raw !== "object") return null;
	const start = clockMinutes(raw.start);
	const end = clockMinutes(raw.end);
	if (start === null || end === null || start === end) return null;
	const days = Array.isArray(raw.days) ? raw.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) : [0, 1, 2, 3, 4, 5, 6];
	if (days.length === 0) return null;
	return { days, start, end };
}
/** Normalize a `YYYY-MM-DD` holiday list into a lookup set. */
function normalizeHolidays(list) {
	const set = new Set();
	if (!Array.isArray(list)) return set;
	for (const entry of list) if (typeof entry === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry.trim())) set.add(entry.trim());
	return set;
}
/**
 * Normalize one model's three prices plus its optional per-model peak /
 * off-peak multipliers (a rate card without peak pricing pins both to 1);
 * returns null when any price is unusable.
 */
function normalizeRates(raw) {
	if (raw === null || typeof raw !== "object") return null;
	const cacheHit = num(raw.cacheHit, NaN);
	const cacheMiss = num(raw.cacheMiss, NaN);
	const output = num(raw.output, NaN);
	if (!Number.isFinite(cacheHit) || !Number.isFinite(cacheMiss) || !Number.isFinite(output)) return null;
	const rates = { cacheHit, cacheMiss, output };
	const peak = num(raw.peakMultiplier, NaN);
	const offPeak = num(raw.offPeakMultiplier, NaN);
	// Both or neither: a single override would leave the pair ambiguous.
	if (Number.isFinite(peak) && Number.isFinite(offPeak)) {
		rates.peakMultiplier = peak;
		rates.offPeakMultiplier = offPeak;
	}
	return rates;
}
/** Normalize a whole rate table, dropping entries with an unusable shape. */
function normalizePricingTable(raw) {
	const table = {};
	if (raw === null || typeof raw !== "object") return table;
	for (const [key, value] of Object.entries(raw)) {
		if (typeof key !== "string" || key === "" || key.startsWith("$")) continue;
		const rates = normalizeRates(value);
		if (rates !== null) table[key] = rates;
	}
	return table;
}
/** Normalize the `display.currency` block, keeping the given fallback on junk. */
function normalizeCurrency(raw, fallback) {
	if (raw === null || typeof raw !== "object") return fallback;
	const feed = raw.feed !== null && typeof raw.feed === "object" ? raw.feed : {};
	return {
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
		code: str(raw.code, fallback.code).toUpperCase(),
		symbol: str(raw.symbol, fallback.symbol),
		source: raw.source === "fixed" ? "fixed" : "feed",
		fixedRate: positive(raw.fixedRate, fallback.fixedRate),
		feed: {
			url: str(feed.url, fallback.feed.url),
			ratePath: str(feed.ratePath, fallback.feed.ratePath),
			refreshMs: positive(feed.refreshMs, fallback.feed.refreshMs)
		}
	};
}
/**
 * Merge one raw config object (from the served file, the session cache, or a
 * host-injected global) over the built-in fallbacks. Every field is optional
 * and validated: unknown or malformed input degrades to the fallback for that
 * field alone, never to a broken dock.
 * @param raw - the config object as parsed from JSON.
 * @returns a complete, internally consistent pricing config.
 */
function normalizeConfig(raw) {
	const source = raw !== null && typeof raw === "object" ? raw : {};
	const billing = source.billing !== null && typeof source.billing === "object" ? source.billing : {};
	const display = source.display !== null && typeof source.display === "object" ? source.display : {};
	const windows = Array.isArray(billing.peakWindows) ? billing.peakWindows.map(normalizeWindow).filter((window) => window !== null) : FALLBACK_BILLING.peakWindows.slice();
	const table = normalizePricingTable(source.pricing);
	return {
		version: num(source.version, 1),
		updatedAt: str(source.updatedAt, ""),
		source: str(source.source, ""),
		billing: {
			offPeakMultiplier: num(billing.offPeakMultiplier, FALLBACK_BILLING.offPeakMultiplier),
			peakMultiplier: num(billing.peakMultiplier, FALLBACK_BILLING.peakMultiplier),
			peakZone: str(billing.peakZone, FALLBACK_BILLING.peakZone),
			peakWindows: windows.length > 0 ? windows : FALLBACK_BILLING.peakWindows.slice(),
			holidays: normalizeHolidays(billing.holidays)
		},
		defaultModel: str(source.defaultModel, FALLBACK_DEFAULT_MODEL),
		pricing: Object.keys(table).length > 0 ? table : FALLBACK_PRICING,
		display: { currency: normalizeCurrency(display.currency, FALLBACK_DISPLAY.currency) }
	};
}
/** The config that is currently in force (built-in fallback until a fetch lands). */
let active = normalizeConfig(null);
/** Read the config currently in force. */
function activeConfig() {
	return active;
}
/**
 * Replace the config in force. The only mutation point, so every reader sees
 * one consistently normalized object.
 * @param raw - a config object from any source.
 * @returns the normalized config that was installed.
 */
function setActiveConfig(raw) {
	active = normalizeConfig(raw);
	return active;
}
/**
 * Resolve the rate card for a model id: exact key first, then the longest
 * matching prefix (so `deepseek-flash-2026` follows `deepseek-flash`).
 * Models absent from the table resolve to `known: false` — the dock then hides
 * its cost line rather than guessing a price for an unknown model.
 * @param modelId - the selected model id, or an empty value before it reports.
 * @param config - the config to resolve against; defaults to the active one.
 */
function resolvePricing(modelId, config) {
	const current = config ?? active;
	const table = current.pricing;
	const target = typeof modelId === "string" && modelId !== "" ? modelId : current.defaultModel;
	const exact = table[target];
	if (exact !== void 0) return { pricing: exact, known: true };
	const match = Object.keys(table).filter((key) => target.startsWith(key)).sort((a, b) => b.length - a.length)[0];
	if (match === void 0) return { pricing: table[current.defaultModel] ?? { cacheHit: 0, cacheMiss: 0, output: 0 }, known: false };
	return { pricing: table[match], known: true };
}
/** Local civil date/time of one instant in Asia/Shanghai, using plain UTC math. */
function beijingParts(date) {
	const shifted = new Date(date.getTime() + BEIJING_OFFSET_MINUTES * 6e4);
	return {
		day: shifted.getUTCDay(),
		minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
		date: shifted.toISOString().slice(0, 10)
	};
}
/**
 * The billing multiplier for one instant, for one rate-card entry.
 * A model may pin its own peak/off-peak multipliers (legacy cards have no peak
 * pricing at all); otherwise the global `billing` rule applies.
 * @param date - the instant to price at.
 * @param config - the config to read windows and multipliers from.
 * @param pricing - the resolved rate card entry, or undefined.
 * @returns the multiplier in force at that instant for that model.
 */
function multiplierAt(date, config, pricing) {
	const current = config ?? active;
	const billing = current.billing;
	const peak = pricing?.peakMultiplier ?? billing.peakMultiplier;
	const offPeak = pricing?.offPeakMultiplier ?? billing.offPeakMultiplier;
	if (peak === offPeak) return peak;
	const { day, minutes, date: today } = beijingParts(date);
	if (billing.holidays.has(today)) return offPeak;
	for (const window of billing.peakWindows) {
		// A night-shift window (Friday 23:00 → Saturday 01:00) covers the next
		// civil day; a window listed for several days covers exactly those days.
		const startDay = window.days[0];
		const endDay = window.days[window.days.length - 1];
		const offset = (day - startDay + 7) % 7;
		const weekday = window.days.length > 1 ? offset <= (endDay - startDay + 7) % 7 : offset === 0 || offset === 1 && window.end <= window.start;
		if (!weekday) continue;
		const overnight = window.end <= window.start;
		const inside = overnight ? minutes >= window.start || minutes < window.end : minutes >= window.start && minutes < window.end;
		if (inside) return peak;
	}
	return offPeak;
}
/** Read a dotted path (`rates.JPY`) out of a parsed response body. */
function readByPath(object, path) {
	let cursor = object;
	for (const segment of String(path).split(".")) {
		if (cursor === null || typeof cursor !== "object") return void 0;
		cursor = cursor[segment];
	}
	return cursor;
}
/**
 * Fetch the config the host serves and install it. Failures are silent by
 * design: the previous (or built-in) config stays in force, so a host route
 * that is absent — Electron's `file://` shell, for example — only means the
 * plugin keeps using its shipped defaults.
 * @returns the config in force after the attempt, or null when it could not be read.
 */
async function loadPricingConfig() {
	try {
		const response = await fetch(CONFIG_ROUTE, { cache: "no-store" });
		if (!response.ok) return null;
		const raw = await response.json();
		if (raw === null || typeof raw !== "object") return null;
		const config = setActiveConfig(raw);
		try {
			sessionStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(raw));
		} catch {}
		return config;
	} catch {
		return null;
	}
}
/**
 * Hydrate from the last config this browser successfully loaded, so a reload
 * keeps user-edited prices even before the fetch resolves.
 * @returns the hydrated config, or null when the cache is empty or unreadable.
 */
function hydratePricingConfig() {
	try {
		const text = sessionStorage.getItem(CONFIG_CACHE_KEY);
		if (text === null || text === "") return null;
		return setActiveConfig(JSON.parse(text));
	} catch {
		return null;
	}
}
/** Live CNY→display-currency conversion state. */
let fx = { rate: null, at: 0 };
/** The last fetched CNY→target rate, or null while no usable rate is known. */
function activeFxRate() {
	return fx.rate;
}
/**
 * Treat a fetched rate as usable only when it is a positive, sane multiplier of
 * one CNY. A switched or broken feed must not silently rescale every price.
 * @param value - the parsed rate.
 * @returns the rate when usable, otherwise null.
 */
function acceptFxRate(value) {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
	return value > 1e-6 && value < 1e6 ? value : null;
}
/**
 * Refresh the CNY→display-currency rate from the configured feed. Failures are
 * silent; the caller falls back to the config's `fallbackCurrency` rendering.
 * @param url - the rate feed URL.
 * @param ratePath - dotted path to the numeric rate inside the response body.
 * @returns the accepted rate, or null when this attempt produced none.
 */
async function fetchFxRate(url, ratePath) {
	try {
		const response = await fetch(url, { cache: "no-store" });
		if (!response.ok) return null;
		const value = acceptFxRate(readByPath(await response.json(), ratePath));
		if (value === null) return null;
		fx = { rate: value, at: Date.now() };
		return value;
	} catch {
		return null;
	}
}
/** Sum the three disjoint prompt-side billing buckets. */
function billedInputTokens(usage) {
	if (usage === void 0) return 0;
	return (usage.uncachedInputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}
/**
 * Price one aggregate usage sample in CNY.
 * @param usage - the session's token-usage projection value.
 * @param pricing - the rate card entry to apply.
 * @param multiplier - the peak/off-peak multiplier in force.
 */
function computeCostCny(usage, pricing, multiplier) {
	if (usage === void 0) return 0;
	const hit = (usage.cacheReadTokens ?? 0) * pricing.cacheHit;
	const miss = ((usage.uncachedInputTokens ?? 0) + (usage.cacheWriteTokens ?? 0)) * pricing.cacheMiss;
	const out = (usage.outputTokens ?? 0) * pricing.output;
	return (hit + miss + out) * multiplier / 1e6;
}
/** Adaptive CNY formatting (used when no conversion rate is available). */
function formatCny(value) {
	if (!Number.isFinite(value) || value <= 0) return "0元";
	if (value < 0.01) return value.toFixed(4) + "元";
	if (value < 1) return value.toFixed(3) + "元";
	return value.toFixed(2) + "元";
}
/**
 * Render one price in the configured display currency; a missing or invalid
 * rate renders plain CNY (the caller passes null when conversion is disabled,
 * and substitutes `fixedRate` when the live feed has not loaded).
 * @param cny - the amount in CNY.
 * @param rate - target-currency units per CNY.
 * @param symbol - the target currency symbol (JPY renders `円`).
 */
function formatDisplay(cny, rate, symbol) {
	if (!Number.isFinite(rate) || rate <= 0) return formatCny(cny);
	if (!Number.isFinite(cny) || cny <= 0) return "0" + symbol;
	const value = cny * rate;
	if (value >= 1) return Math.round(value) + symbol;
	return value.toFixed(2) + symbol;
}
/** Compact token count: 517 / 12.2K / 1.2M (mirrors the stats line). */
function formatTokens(n) {
	const scaled = (v) => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
	if (n < 1e3) return String(n);
	if (n < 1e6) return scaled(n / 1e3) + "K";
	return scaled(n / 1e6) + "M";
}
