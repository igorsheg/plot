import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Plot",
		identifier: "dev.plot.desktop",
		version: "0.0.1",
	},
	runtime: {
		exitOnLastWindowClosed: false,
	},
	build: {
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		copy: {
			"dist/index.html": "views/main/index.html",
			"dist/assets": "views/main/assets",
			"resources/tray-icon.svg": "views/tray-icon.svg",
		},
		watchIgnore: ["dist/**"],
	},
} satisfies ElectrobunConfig;
