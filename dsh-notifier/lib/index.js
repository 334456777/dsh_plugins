/**
 * dsh-notifier — host half.
 *
 * A surface plugin (the documented minimal form): the host body is a no-op
 * because the capability is a CLIENT UI surface (browser notifications for
 * completion and command approval). The browser half ships via
 * exports["./client"], discovered through the package.json dsh.client
 * declaration. The host `apply` exists so the plugin appears in the host
 * cordis composition and prints the documented "plugin loaded!" confirmation
 * when the profile boots.
 */

/** Plugin identity, mirroring the documented `export const name` shape. */
export const name = 'dsh-notifier';

/** No host-side hard dependencies (the client half declares its own). */
export const inject = [];

/** Host plugin body — nothing to register; the surface lives in the client. */
export function apply(_ctx) {
	console.log(`[dsh-notifier] plugin loaded!`);
}
