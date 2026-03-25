import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
	plugins: [tailwindcss()],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
			"@plot/sdk": fileURLToPath(new URL("../sdk/src/index.ts", import.meta.url)),
			"@plot/ui": fileURLToPath(new URL("../ui/src", import.meta.url)),
		},
	},
	server: {
		proxy: {
			"/rpc": "http://localhost:3000",
		},
	},
	build: {
		outDir: "dist",
		rollupOptions: {
			onwarn(warning, warn) {
				if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
				warn(warning);
			},
		},
	},
});
