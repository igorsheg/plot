// @ts-nocheck
// Minimal vendored pi-mono terminal/TUI substrate used by Plot.

export {
	matchesKey,
	parseKey,
	setKittyProtocolActive,
	isKittyProtocolActive,
	isKeyRelease,
	type KeyId,
} from "./keys.ts";
export { ProcessTerminal, type Terminal } from "./terminal.ts";
export { type Component, TUI } from "./tui.ts";
export { truncateToWidth, visibleWidth } from "./utils.ts";
