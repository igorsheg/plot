import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	server: {
		proxy: {
			"/api": {
				changeOrigin: true,
				target: process.env["PLOT_WEB_API_URL"] ?? "http://127.0.0.1:4317",
			},
		},
	},
});
