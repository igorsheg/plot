import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";

export const plotTheme = defineTheme({
	name: "plot",
	extends: neutralTheme,
	typography: {
		scale: { base: 14, ratio: 1.2 },
		body: {
			family: "Inter Variable",
			fallbacks: "Inter, ui-sans-serif, system-ui, sans-serif",
		},
		heading: {
			family: "Inter Variable",
			fallbacks: "Inter, ui-sans-serif, system-ui, sans-serif",
		},
		code: {
			family: "Geist Mono",
			fallbacks: "ui-monospace, SFMono-Regular, Menlo, monospace",
		},
	},
	radius: { base: 6, multiplier: 1 },
});
