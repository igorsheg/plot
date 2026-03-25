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
		useAsar: true,
		asarUnpack: ["*.node", "*.dll", "*.dylib", "*.so"],
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		views: {
			main: {
				entrypoint: "src/views/main/index.tsx",
				minify: true,
			},
		},
		copy: {
			"src/views/main/index.html": "views/main/index.html",
		},
		mac: {
			codesign: true,
			notarize: true,
		},
	},
	release: {
		baseUrl: "",
	},
} satisfies ElectrobunConfig;
