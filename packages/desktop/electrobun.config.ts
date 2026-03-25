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
		views: {
			main: {
				entrypoint: "src/views/main/index.tsx",
			},
		},
		copy: {
			"src/views/main/index.html": "views/main/index.html",
		},
	},
} satisfies ElectrobunConfig;
