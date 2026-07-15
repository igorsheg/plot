import type { Preview } from "@storybook/react-vite";
import { useEffect } from "react";
// oxlint-disable-next-line import/no-unassigned-import
import "../src/style.css";

/**
 * Plot's runtime toggles theme on <html> (`.dark` class + `data-mode`); the
 * toolbar mirrors that exactly so stories render in the real cascade.
 */
export const globalTypes = {
	theme: {
		description: "Plot theme",
		defaultValue: "light",
		toolbar: {
			title: "Theme",
			icon: "contrast",
			items: [
				{ value: "light", title: "Light" },
				{ value: "dark", title: "Dark" },
			],
			dynamicTitle: true,
		},
	},
};

const preview: Preview = {
	parameters: {
		layout: "fullscreen",
		controls: { expanded: true },
		options: {
			storySort: { order: ["Foundations", "Components", "Screens"] },
		},
	},
	decorators: [
		(Story, context) => {
			const dark = context.globals["theme"] === "dark";
			useEffect(() => {
				const el = document.documentElement;
				el.classList.toggle("dark", dark);
				el.dataset["mode"] = dark ? "dark" : "light";
				el.dataset["theme"] = "coss";
			}, [dark]);
			return (
				<div
					style={{
						minHeight: "100dvh",
						background: "var(--background)",
						color: "var(--foreground)",
						fontFamily: "var(--font-sans)",
					}}
				>
					<Story />
				</div>
			);
		},
	],
};

export default preview;
