//#region lib/types/client/index.js
/**
 * dsh-notifier — browser half.
 *
 * The same bundle doubles as the notification Service Worker: when the script
 * evaluates inside a ServiceWorkerGlobalScope it only installs the
 * `notificationclick` bridge (Chrome/Edge action buttons post their decision
 * back to the page, which owns the pending-approval carriers and the wire
 * encoding); in a page it registers the tool-row toggle and drives the
 * notifications from the live ConversationSnapshot.
 *
 * Safari does not support notification actions at all, so on Safari every
 * notification is a plain page notification whose click focuses the DSH tab
 * (the approval dialog is already on screen). Chrome/Edge get real
 * 允许/拒绝 buttons through the Service Worker.
 */
if (typeof window === "undefined" && typeof self !== "undefined" && typeof ServiceWorkerGlobalScope !== "undefined" && self instanceof ServiceWorkerGlobalScope) {
	//#region service worker bridge
	self.addEventListener("notificationclick", (event) => {
		const data = event.notification?.data ?? {};
		event.notification?.close();
		const outcome = event.action === "allow" ? "allowed-once" : event.action === "deny" ? "rejected" : null;
		event.waitUntil((async () => {
			const windows = await self.clients.matchAll({
				type: "window",
				includeUncontrolled: true
			});
			const target = windows.find((candidate) => !String(candidate.url).includes("/plugins/")) ?? windows[0];
			if (target === void 0) return;
			if (outcome !== null && data.key !== void 0) {
				target.postMessage({
					source: "dsh-notifier",
					action: "approval-answer",
					key: data.key,
					outcome
				});
			} else {
				target.focus();
			}
		})());
	});
	//#endregion
} else {
	window.__ModuleLoader__.load({
		id: "dsh-notifier",
		factory: (require) => {
			var module = { exports: {} };
			var exports = module.exports;
			Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
			let react = require("react");
			let react_jsx_runtime = require("react/jsx-runtime");
			//#endregion
			//#region lib/types/client/NotifierControl.css
			const css = ".dnt_root{min-width:0;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:24px;outline:none;align-items:center;gap:5px;padding:0 10px 0 8px;font-size:13px;font-weight:500;line-height:20px;display:flex}.dnt_root:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.dnt_root:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}.dnt_off{opacity:.62}.dnt_dot{background:var(--dsw-alias-state-business-primary);border-radius:50%;width:7px;height:7px;flex:none}.dnt_off .dnt_dot{background:var(--dsw-alias-label-caption)}";
			const tagId = "dsh-notifier/NotifierControl.css";
			if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-notifier";
				tag.dataset.pluginCss = tagId;
				tag.textContent = css;
				document.head.appendChild(tag);
			}
			var NotifierControl_css_default = {
				"root": "dnt_root",
				"off": "dnt_off",
				"dot": "dnt_dot"
			};
			//#endregion
			//#region lib/types/client/index.js
			/** Locale namespace for the toggle and notification copy. */
			const NS = "notifier";
			/** Chinese copy. */
			const zh = {
				"notify.on": "通知 · 开",
				"notify.off": "通知 · 关",
				"notify.hint": "点击开启/关闭浏览器通知",
				"notify.deniedHint": "通知权限被拒绝：请在 Safari 的网站设置中允许 127.0.0.1 的通知",
				"notify.allow": "允许",
				"notify.deny": "拒绝",
				"notify.approvalTitle": "需要确认命令",
				"notify.doneTitle": "对话完成",
				"notify.doneFallback": "会话已完成",
				"notify.testTitle": "通知已开启",
				"notify.testBody": "对话完成与待确认命令将在这里提醒你"
			};
			/** English copy. */
			const en = {
				"notify.on": "Notify · on",
				"notify.off": "Notify · off",
				"notify.hint": "Click to enable/disable browser notifications",
				"notify.deniedHint": "Notifications are blocked: allow notifications for 127.0.0.1 in the browser site settings",
				"notify.allow": "Allow",
				"notify.deny": "Deny",
				"notify.approvalTitle": "Command needs approval",
				"notify.doneTitle": "Conversation finished",
				"notify.doneFallback": "The session finished",
				"notify.testTitle": "Notifications enabled",
				"notify.testBody": "Conversation completion and pending commands will be reported here"
			};
			/** Live pending-approval carriers, keyed by wait key (module state survives slot unmount). */
			const activeApprovals = /* @__PURE__ */ new Map();
			/** Last known running bit per session (module state survives session switches). */
			const runningRefs = /* @__PURE__ */ new Map();
			/** Mirror of the toggle state for effects. */
			let enabledRef = false;
			/** Safari: no SW notifications, no actions — plain page notification. */
			function isSafari() {
				if (typeof navigator === "undefined") return false;
				const ua = navigator.userAgent ?? "";
				return /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|FxiOS/.test(ua);
			}
			/** The registration promise shared by every notification. */
			let registrationPromise = null;
			/** Best-effort Service Worker registration for action buttons (Chrome/Edge). */
			function ensureServiceWorker() {
				if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return Promise.resolve(null);
				if (registrationPromise === null) registrationPromise = navigator.serviceWorker.register("/plugins/dsh-notifier/client.js").then((registration) => registration).catch(() => null);
				return registrationPromise;
			}
			/** True when the DSH tab is the focused, visible window — the user is looking at it. */
			function isFocused() {
				if (typeof document === "undefined") return false;
				return document.visibilityState === "visible" && document.hasFocus();
			}
			/** Dispatch one notification: SW route on Chromium, page route on Safari or failure. */
			function fireNotification(title, options) {
				if (typeof window === "undefined" || !("Notification" in window) || window.Notification.permission !== "granted") return Promise.resolve();
				if (options.ignoreFocus !== true && isFocused()) return Promise.resolve();
				const page = () => {
					const notification = new window.Notification(title, {
						body: options.body,
						tag: options.tag,
						requireInteraction: options.requireInteraction ?? false
					});
					notification.onclick = () => {
						window.focus();
						notification.close();
					};
				};
				if (isSafari()) {
					page();
					return Promise.resolve();
				}
				return ensureServiceWorker().then((registration) => {
					if (registration === null) {
						page();
						return;
					}
					registration.showNotification(title, {
						body: options.body,
						tag: options.tag,
						requireInteraction: options.requireInteraction ?? false,
						actions: options.actions ?? [],
						data: options.data ?? {}
					}).catch(() => {
						page();
					});
				});
			}
			/** First line of a reason string, for the notification body. */
			function firstLine(text) {
				const newline = text.indexOf("\n");
				return newline === -1 ? text : text.slice(0, newline);
			}
			/** Clip long bodies. */
			function truncate(text, limit) {
				return text.length <= limit ? text : `${text.slice(0, limit)}…`;
			}
			/** Active reminder timers, keyed by notification tag (same tag → one entry). */
			const reminders = /* @__PURE__ */ new Map();
			/** Stop the reminder loop for one notification tag. */
			function stopReminder(tag) {
				const entry = reminders.get(tag);
				if (entry === void 0) return;
				clearTimeout(entry.timer);
				reminders.delete(tag);
			}
			/** Stop every active reminder loop. */
			function stopAllReminders() {
				for (const tag of Array.from(reminders.keys())) stopReminder(tag);
			}
			/**
			 * After a notification fires, re-alert until the user focuses the window:
			 * first repeat after 60s, each repeat 5s sooner, floored at 5s. Re-firing
			 * with the same tag replaces the entry in the OS notification center, so
			 * the user sees one entry that keeps re-bannering and re-sounding — the
			 * same effect as clicking the toggle's test notification repeatedly.
			 */
			function scheduleReminder(title, options) {
				const tag = options.tag;
				if (typeof tag !== "string" || tag === "") return;
				stopReminder(tag);
				let delay = 60000;
				const step = () => {
					reminders.delete(tag);
					if (!enabledRef) return;
					if (isFocused()) return;
					if (typeof window === "undefined" || !("Notification" in window) || window.Notification.permission !== "granted") return;
					fireNotification(title, { ...options, ignoreFocus: true }).catch(() => {});
					delay = Math.max(5000, delay - 5000);
					const timer = setTimeout(step, delay);
					reminders.set(tag, { timer });
				};
				const timer = setTimeout(step, delay);
				reminders.set(tag, { timer });
			}
			/** Fire once, then keep re-alerting until the window is focused. */
			function fireAndRemind(title, options) {
				const promise = fireNotification(title, options);
				if (!isFocused()) scheduleReminder(title, options);
				return promise;
			}
			/** Cancel every reminder the moment the window regains focus. */
			let reminderFocusArmed = false;
			function armReminderFocusCancel() {
				if (reminderFocusArmed || typeof window === "undefined") return;
				reminderFocusArmed = true;
				const cancelAll = () => {
					if (!isFocused()) return;
					stopAllReminders();
				};
				window.addEventListener("focus", cancelAll);
				window.addEventListener("visibilitychange", cancelAll);
			}
			/** Restore the persisted toggle state (granted permission required). */
			function readEnabled() {
				if (typeof window === "undefined" || !("Notification" in window) || window.Notification.permission !== "granted") return false;
				try {
					return window.localStorage.getItem("dsh-notifier.enabled") === "1";
				} catch {
					return false;
				}
			}
			/**
			 * Tool-row toggle plus the notification engine. Rides the standard
			 * ConversationSnapshot seats: `pending` carries the approval carriers
			 * (with their respond verb) and `running` flips false when the
			 * conversation completes.
			 */
			const NotifierControl = react.memo(function NotifierControl({ useSession, useSessions, sessionId, t }) {
				const supported = typeof window !== "undefined" && "Notification" in window;
				const [enabled, setEnabled] = react.useState(() => readEnabled());
				const [permission, setPermission] = react.useState(() => supported ? window.Notification.permission : "denied");
				react.useEffect(() => {
					enabledRef = enabled;
				}, [enabled]);
				const pending = useSession((snapshot) => snapshot.pending) ?? [];
				const running = useSession((snapshot) => snapshot.running) ?? false;
				const displayTitle = useSessions((list) => list.byId[sessionId]?.displayTitle);
				const seen = react.useRef(new Set());
				react.useEffect(() => {
					if (!enabledRef) {
						seen.current.clear();
						return;
					}
					for (const wait of pending) {
						if (wait.kind !== "approval") continue;
						activeApprovals.set(wait.key, wait);
						if (seen.current.has(wait.key)) continue;
						seen.current.add(wait.key);
						const toolName = typeof wait.payload?.toolName === "string" ? wait.payload.toolName : "";
						const reason = typeof wait.payload?.reason === "string" ? firstLine(wait.payload.reason) : "";
						const body = `${toolName}${reason === "" ? "" : ` · ${reason}`}`;
						fireAndRemind(t("notify.approvalTitle"), {
							body: truncate(body, 180),
							tag: `dsh-approval-${wait.key}`,
							requireInteraction: true,
							actions: [{
								action: "allow",
								title: t("notify.allow")
							}, {
								action: "deny",
								title: t("notify.deny")
							}],
							data: {
								key: wait.key
							}
						}).catch(() => {});
					}
					for (const key of seen.current) if (!pending.some((wait) => wait.key === key)) seen.current.delete(key);
				}, [pending]);
				react.useEffect(() => {
					const previous = runningRefs.get(sessionId);
					if (previous === true && running === false && enabledRef && pending.length === 0) {
						fireAndRemind(t("notify.doneTitle"), {
							body: typeof displayTitle === "string" && displayTitle !== "" ? displayTitle : t("notify.doneFallback"),
							tag: `dsh-done-${sessionId}`,
							actions: [],
							data: {}
						}).catch(() => {});
					}
					runningRefs.set(sessionId, running);
				}, [running, sessionId, displayTitle, pending]);
				if (!supported) return null;
				const toggle = () => {
					const proceed = (perm) => {
						setPermission(perm);
						if (perm !== "granted") return;
						const next = !enabled;
						setEnabled(next);
						try {
							window.localStorage.setItem("dsh-notifier.enabled", next ? "1" : "0");
						} catch {}
						if (next) {
							ensureServiceWorker().catch(() => {});
							fireNotification(t("notify.testTitle"), {
								body: t("notify.testBody"),
								tag: "dsh-notifier-test",
								actions: [],
								data: {},
								ignoreFocus: true
							}).catch(() => {});
						} else {
							stopAllReminders();
						}
					};
					if (window.Notification.permission === "default") {
						window.Notification.requestPermission().then(proceed).catch(() => proceed(window.Notification.permission));
					} else {
						proceed(window.Notification.permission);
					}
				};
				const denied = permission === "denied";
				return react_jsx_runtime.jsxs("button", {
					type: "button",
					className: [NotifierControl_css_default.root, enabled ? "" : NotifierControl_css_default.off].join(" ").trim(),
					"aria-pressed": enabled,
					disabled: denied,
					title: denied ? t("notify.deniedHint") : t("notify.hint"),
					onClick: toggle,
					children: [react_jsx_runtime.jsx("span", {
						className: NotifierControl_css_default.dot
					}, "dot"), t(enabled ? "notify.on" : "notify.off")]
				});
			});
			/** Required client services: the slot system and the locale seat. */
			const inject = ["slots", "locale"];
			/** Mount the toggle and the SW→page answer bridge. */
			function apply(ctx) {
				armReminderFocusCancel();
				ctx.effect(() => ctx.locale.register(NS, {
					zh,
					en
				}), "notifier: dictionaries");
				ctx.effect(() => {
					if (typeof window === "undefined") return () => {};
					const onMessage = (event) => {
						const data = event.data;
						if (data === null || typeof data !== "object" || data.source !== "dsh-notifier" || data.action !== "approval-answer") return;
						const wait = activeApprovals.get(data.key);
						if (wait === void 0) return;
						const outcome = data.outcome === "allowed-once" || data.outcome === "rejected" ? data.outcome : null;
						if (outcome === null) return;
						stopReminder(`dsh-approval-${data.key}`);
						wait.respond({
							ok: true,
							value: {
								sessionId: wait.sessionId,
								approvalId: wait.payload?.approvalId,
								outcome
							}
						}).catch(() => {});
					};
					window.addEventListener("message", onMessage);
					return () => window.removeEventListener("message", onMessage);
				}, "notifier: message bridge");
				ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
					name: "conversation.input.right",
					id: "notifier",
					order: 50,
					locale: NS
				}, NotifierControl));
			}
			//#endregion
			exports.NotifierControl = NotifierControl;
			exports.apply = apply;
			exports.inject = inject;
			return module.exports;
		}
	});
}

//# sourceMappingURL=client.js.map
