/**
 * dsh-cost-meter — browser half.
 *
 * Registers a `conversation.composer.dock` entry (the ambient readout band
 * under the composer, where the shipped stats line lives) that prices the live
 * `tokenUsage` session projection against the DeepSeek rate card.
 *
 * The rate card itself is NOT in this file: prices, peak windows, and the
 * display currency all come from the package's `config/pricing.json`, served by
 * the host half and merged over the built-in fallback in `./pricing.js`.
 * Editing that one JSON file changes billing with no code edit and no rebuild.
 * Billing follows DeepSeek's published model — cache-hit input, cache-miss
 * input (uncached plus cache-write), and output tokens, at the off-peak rate
 * multiplied by the peak multiplier inside the configured peak windows
 * (Beijing time: Monday–Friday 09:00–12:00 and 14:00–18:00, minus the
 * configured statutory holidays).
 *
 * The whole durable log is priced at the CURRENT peak/off-peak rate — a
 * deliberate approximation: the tokenUsage projection is an aggregate, so
 * per-request timestamps are not available client-side. For a live session
 * the bulk of tokens belongs to the running turn, so the current-rate figure
 * tracks reality closely.
 */
window.__ModuleLoader__.load({
	id: "dsh-cost-meter",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#endregion
		//#region lib/types/client/CostDock.css
		const css = "[data-slot=\"conversation.composer.dock\"]{display:flex!important;flex-direction:row;justify-content:center;align-items:center;flex-wrap:wrap;gap:0 10px;box-sizing:border-box;max-width:100%;padding:0}[data-slot=\"conversation.composer.dock\"]>*{width:auto!important;max-width:none!important;margin:0!important;padding:0!important;flex:0 1 auto!important;min-width:0!important}.dcm_root{color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-size:12px;line-height:20px;text-align:left;padding:0;flex:none!important}";
		const tagId = "dsh-cost-meter/CostDock.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-cost-meter";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var CostDock_css_default = {
			"root": "dcm_root"
		};
		//#endregion
		//#region lib/types/client/pricing.js
		/**
		 * dsh-cost-meter — pricing configuration layer (browser half).
		 *
		 * The rate card, the peak-window rule, and the display currency are DATA,
		 * not code. They live in the package's own `config/pricing.json`, served by
		 * the host half at `CONFIG_ROUTE`; this module fetches it and merges it over
		 * the built-in fallback below, so editing the JSON changes billing with no
		 * code edit and an unreachable config only falls back to the shipped rates.
		 */
		const CONFIG_ROUTE = "dsh-cost-meter/pricing.json";
		const CONFIG_REFRESH_MS = 5 * 60 * 1e3;
		const CONFIG_CACHE_KEY = "dsh-cost-meter.pricing";
		const BEIJING_OFFSET_MINUTES = 480;
		const DEFAULT_FX_REFRESH_MS = 60 * 1e3;
		/**
		 * Built-in fallback rate card — OFF-PEAK CNY prices per 1M tokens, mirroring
		 * the shipped `config/pricing.json`. Used only when the served config file
		 * is missing or malformed.
		 * Source: https://api-docs.deepseek.com/zh-cn/quick_start/pricing (2026-10)
		 */
		const FALLBACK_PRICING = {
			"deepseek-flash": { cacheHit: 0.02, cacheMiss: 1, output: 4 },
			"deepseek-v4-flash": { cacheHit: 0.02, cacheMiss: 1, output: 4 },
			"deepseek-v4-flash-vision-exp": { cacheHit: 0.02, cacheMiss: 1, output: 4 },
			"deepseek-v4-pro": { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 }
		};
		/** Fallback model id used before the model directory reports a selection. */
		const FALLBACK_DEFAULT_MODEL = "deepseek-flash";
		/** Built-in fallback billing rule: the official Beijing-time peak windows. */
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
		/** Accept only a `H:MM` / `HH:MM` wall-clock time; canonicalize to `HH:MM`. */
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
			// Sort so a night-shift window lists its days in civil order.
			return {
				days: days.slice().sort((a, b) => a - b),
				start,
				end
			};
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
			const rates = {
				cacheHit,
				cacheMiss,
				output
			};
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
		/** Normalize the `display.currency` block, keeping the fallback on junk. */
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
		 * Merge one raw config object over the built-in fallbacks. Every field is
		 * optional and validated: malformed input degrades that field alone.
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
		/** The config currently in force (built-in fallback until a fetch lands). */
		let active = normalizeConfig(null);
		/** Read the config currently in force. */
		function activeConfig() {
			return active;
		}
		/**
		 * Replace the config in force — the only mutation point, so every reader
		 * sees one consistently normalized object.
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
		 * Models absent from the table resolve to `known: false` — the dock then
		 * hides its cost line rather than guessing a price for an unknown model.
		 * @param modelId - the selected model id, or an empty value before it reports.
		 * @param config - the config to resolve against; defaults to the active one.
		 */
		function resolvePricing(modelId, config) {
			const current = config ?? active;
			const table = current.pricing;
			const target = typeof modelId === "string" && modelId !== "" ? modelId : current.defaultModel;
			const exact = table[target];
			if (exact !== void 0) return {
				pricing: exact,
				known: true
			};
			const match = Object.keys(table).filter((key) => target.startsWith(key)).sort((a, b) => b.length - a.length)[0];
			if (match === void 0) return {
				pricing: table[current.defaultModel] ?? {
					cacheHit: 0,
					cacheMiss: 0,
					output: 0
				},
				known: false
			};
			return {
				pricing: table[match],
				known: true
			};
		}
		/** Local civil date/time of one instant in Asia/Shanghai, via UTC math. */
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
		 * A model may pin its own peak/off-peak multipliers (legacy cards have no
		 * peak pricing at all); otherwise the global `billing` rule applies.
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
				// A night-shift window (Friday 23:00 → Saturday 01:00) covers the
				// next civil day; a window listed for several days covers exactly
				// those days.
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
		 * @returns the config in force after the attempt, or null when unreadable.
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
		 * Hydrate from the last config this browser successfully loaded, so a
		 * reload keeps user-edited prices even before the fetch resolves.
		 * @returns the hydrated config, or null when the cache is empty.
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
		let fx = {
			rate: null,
			at: 0
		};
		/** The last fetched CNY→target rate, or null while none is known. */
		function activeFxRate() {
			return fx.rate;
		}
		/**
		 * Treat a fetched rate as usable only when it is a positive, sane
		 * multiplier of one CNY, so a switched or broken feed cannot silently
		 * rescale every price.
		 * @param value - the parsed rate.
		 * @returns the rate when usable, otherwise null.
		 */
		function acceptFxRate(value) {
			if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
			return value > 1e-6 && value < 1e6 ? value : null;
		}
		/**
		 * Refresh the CNY→display-currency rate from the configured feed. Failures
		 * are silent; the caller then renders plain CNY instead.
		 * @param url - the rate feed URL.
		 * @param ratePath - dotted path to the numeric rate inside the body.
		 * @returns the accepted rate, or null when this attempt produced none.
		 */
		async function fetchFxRate(url, ratePath) {
			try {
				const response = await fetch(url, { cache: "no-store" });
				if (!response.ok) return null;
				const value = acceptFxRate(readByPath(await response.json(), ratePath));
				if (value === null) return null;
				fx = {
					rate: value,
					at: Date.now()
				};
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
		 * Render one price in the configured display currency, falling back to CNY
		 * whenever the conversion rate has not loaded.
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
		//#endregion
		//#region lib/types/client/index.js
		/** Locale namespace for the dock line and its tooltip. */
		const NS = "cost-meter";
		/** Chinese copy. */
		const zh = {
			"cost.label": "本次费用",
			"cost.rate.peak": "（高峰费率×{mult}）",
			"cost.rate.offpeak": "非高峰费率",
			"cost.title": "{symbol}计价 · 输入 {input} · 缓存命中 {hit} · 输出 {output} · 费用构成: 未命中输入 {miss} · 命中输入 {hitPrice} · 输出 {out} · {rate}",
			"cost.title.cny": "人民币计价 · 输入 {input} · 缓存命中 {hit} · 输出 {output} · 费用构成: 未命中输入 {miss} · 命中输入 {hitPrice} · 输出 {out} · {rate}",
		};
		/** English copy. */
		const en = {
			"cost.label": "Session cost",
			"cost.rate.peak": " (peak rate ×{mult})",
			"cost.rate.offpeak": "off-peak rate",
			"cost.title": "in {symbol} · input {input} · cache hit {hit} · output {output} · breakdown: uncached input {miss} · cached input {hitPrice} · output {out} · {rate}",
			"cost.title.cny": "in CNY · input {input} · cache hit {hit} · output {output} · breakdown: uncached input {miss} · cached input {hitPrice} · output {out} · {rate}",
		};
		/** What the config bootstrap is doing, so the dock never blocks on it. */
		let configState = "idle";
		/**
		 * Read the served config once per page, re-reading it periodically so a
		 * price edit lands without a code change or a page reload.
		 * @param onLoaded - called once the first successful read lands.
		 */
		function ensurePricingConfig(onLoaded) {
			if (configState !== "idle") return;
			configState = "loading";
			if (hydratePricingConfig() !== null) onLoaded();
			loadPricingConfig().then((config) => {
				configState = "ready";
				if (config !== null) onLoaded();
			});
			setInterval(() => {
				loadPricingConfig();
			}, CONFIG_REFRESH_MS);
		}
		/**
		 * The dock line: live cost of the open conversation.
		 * Uses only the standard seat props (`useProjection`, `t`). The model
		 * directory store arrives as a plain prop (never a custom hook) and is
		 * read through React's own useSyncExternalStore, so it re-prices the
		 * moment the user switches models without depending on the slot
		 * framework's hook-binding path.
		 */
		const CostDock = react.memo(function CostDock({ useProjection, modelStore, t }) {
			let usage;
			try {
				usage = typeof useProjection === "function" ? useProjection("tokenUsage") : void 0;
			} catch {
				usage = void 0;
			}
			const subscribe = react.useCallback((listener) => {
				try {
					return modelStore === null || modelStore === void 0 ? () => {} : modelStore.subscribe(listener);
				} catch {
					return () => {};
				}
			}, [modelStore]);
			const getSnapshot = react.useCallback(() => {
				try {
					return modelStore === null || modelStore === void 0 ? null : modelStore.getSnapshot()?.current ?? null;
				} catch {
					return null;
				}
			}, [modelStore]);
			const model = react.useSyncExternalStore(subscribe, getSnapshot, () => null);
			const [, tick] = react.useReducer((count) => count + 1, 0);
			react.useEffect(() => {
				const id = setInterval(tick, 30 * 1e3);
				return () => clearInterval(id);
			}, []);
			react.useEffect(() => {
				ensurePricingConfig(tick);
			}, []);
			const display = activeConfig().display;
			const currency = display.currency;
			// Re-established only when the configured currency or feed actually
			// changes, so a config reload that keeps them does not restart polling.
			const currencyKey = [
				currency.enabled,
				currency.code,
				currency.symbol,
				currency.source,
				currency.fixedRate,
				currency.feed.url,
				currency.feed.ratePath,
				currency.feed.refreshMs
			].join("|");
			const [rate, setRate] = react.useState(() => !currency.enabled ? null : currency.source === "fixed" ? currency.fixedRate : activeFxRate());
			react.useEffect(() => {
				if (!currency.enabled) {
					setRate(null);
					return;
				}
				if (currency.source === "fixed") {
					setRate(currency.fixedRate);
					return;
				}
				let alive = true;
				const load = () => {
					fetchFxRate(currency.feed.url, currency.feed.ratePath).then((value) => {
						if (alive && value !== null) setRate(value);
					});
				};
				const id = setInterval(load, currency.feed.refreshMs);
				load();
				return () => {
					alive = false;
					clearInterval(id);
				};
			}, [currencyKey]);
			try {
				const config = activeConfig();
				const modelId = model === null || model === void 0 ? config.defaultModel : model.model;
				const { pricing, known } = resolvePricing(modelId, config);
				// No rate-card entry for the selected model: hide the cost line
				// entirely instead of guessing a price for an unknown model.
				if (!known) return null;
				const multiplier = multiplierAt(new Date(), config, pricing);
				const symbol = config.display.currency.symbol;
				const inputTokens = billedInputTokens(usage);
				const outputTokens = usage === void 0 ? 0 : usage.outputTokens ?? 0;
				const hitTokens = usage === void 0 ? 0 : usage.cacheReadTokens ?? 0;
				const uncachedTokens = usage === void 0 ? 0 : (usage.uncachedInputTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
				const costCny = computeCostCny(usage, pricing, multiplier);
				const missCny = uncachedTokens * pricing.cacheMiss * multiplier / 1e6;
				const hitCny = hitTokens * pricing.cacheHit * multiplier / 1e6;
				const outCny = outputTokens * pricing.output * multiplier / 1e6;
				const hasUsage = inputTokens + outputTokens > 0;
				// The peak marker compares against THIS model's off-peak multiplier,
				// so a model with a flat rate never claims "peak rate ×2".
				const peak = multiplier > (pricing.offPeakMultiplier ?? config.billing.offPeakMultiplier);
				// Live feed rate when available, otherwise the configured fixedRate.
				const fxRate = !currency.enabled ? null : Number.isFinite(rate) && rate > 0 ? rate : currency.fixedRate;
				const parts = [t("cost.label"), formatDisplay(costCny, fxRate, symbol)];
				if (hasUsage && peak) parts.push(t("cost.rate.peak", { mult: String(multiplier) }));
				const titleKey = currency.enabled ? "cost.title" : "cost.title.cny";
				const title = t(titleKey, {
					symbol,
					input: formatTokens(inputTokens),
					hit: formatTokens(hitTokens),
					output: formatTokens(outputTokens),
					miss: formatDisplay(missCny, fxRate, symbol),
					hitPrice: formatDisplay(hitCny, fxRate, symbol),
					out: formatDisplay(outCny, fxRate, symbol),
					rate: peak ? t("cost.rate.peak", { mult: String(multiplier) }) : t("cost.rate.offpeak")
				});
				return react_jsx_runtime.jsx("div", {
					className: CostDock_css_default.root,
					title,
					children: parts.join("")
				});
			} catch (error) {
				console.error("[dsh-cost-meter] CostDock render failed:", error);
				return react_jsx_runtime.jsx("div", {
					className: CostDock_css_default.root,
					children: (typeof t === "function" ? t("cost.label") : "Session cost") + " $--"
				});
			}
		});
		/** Required client services: the slot system and the locale seat.
		 * The model directory is optional and sampled at inject time, so a
		 * missing ui-model-selection degrades to default pricing instead of
		 * blocking activation. */
		const inject = ["slots", "locale"];
		/** Mount the cost dock entry beside the shipped stats line. */
		function apply(ctx) {
			try {
				if (typeof document !== "undefined" && document.documentElement !== void 0) document.documentElement.dataset.dshCostMeter = "applied";
			} catch {}
			console.info("[dsh-cost-meter] apply: registering composer.dock entry");
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "cost-meter: dictionaries");
			ctx.slots.inject("conversation.composer.dock", () => {
				try {
					if (typeof document !== "undefined" && document.documentElement !== void 0) document.documentElement.dataset.dshCostMeter = "registered";
				} catch {}
				console.info("[dsh-cost-meter] composer.dock slot declared; registering entry id=cost");
				ctx.slots.register({
					name: "conversation.composer.dock",
					id: "cost",
					order: 1,
					locale: NS,
					inject: (sessionId) => {
						let store = null;
						try {
							const directories = ctx.get("modelDirectories");
							store = directories === void 0 || directories === null ? null : directories.directoryFor(sessionId)?.store ?? null;
						} catch {
							store = null;
						}
						return { modelStore: store };
					}
				}, CostDock);
			});
		}
		//#endregion
		exports.CostDock = CostDock;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
