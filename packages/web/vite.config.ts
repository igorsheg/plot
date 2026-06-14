import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": new URL("./src", import.meta.url).pathname,
			"next/link": new URL("./src/next-compat/link.tsx", import.meta.url)
				.pathname,
			"next/navigation": new URL(
				"./src/next-compat/navigation.ts",
				import.meta.url,
			).pathname,
		},
	},
});
