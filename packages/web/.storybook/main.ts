import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
	stories: ["../src/**/*.stories.@(ts|tsx)"],
	addons: [],
	framework: {
		name: "@storybook/react-vite",
		options: {},
	},
	// framer-motion must bind to the same React instance Storybook pre-bundles,
	// or its hooks fire with a null dispatcher ("Cannot read properties of null").
	// Dedupe React and force `motion` into the same optimize pass.
	viteFinal: (viteConfig) => ({
		...viteConfig,
		resolve: {
			...viteConfig.resolve,
			dedupe: [...(viteConfig.resolve?.dedupe ?? []), "react", "react-dom"],
		},
		optimizeDeps: {
			...viteConfig.optimizeDeps,
			include: [...(viteConfig.optimizeDeps?.include ?? []), "motion/react"],
		},
	}),
};

export default config;
