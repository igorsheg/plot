import { useStore } from "@nanostores/react";
import type { CSSProperties } from "react";
import { $plotError } from "../app/store.js";
import { Text } from "./ui/text.js";

const toastStyle: CSSProperties = {
	background: "var(--color-kumo-base)",
	border: "1px solid var(--color-kumo-danger)",
	borderRadius: "var(--plot-space-3)",
	bottom: "var(--plot-space-4)",
	boxShadow:
		"0 var(--plot-space-4) var(--plot-space-8) var(--color-kumo-shadow-drop)",
	maxWidth:
		"min(calc(var(--plot-rhythm) * 128), calc(100vw - var(--plot-space-8)))",
	padding: "var(--plot-space-3) var(--plot-space-4)",
	position: "fixed",
	right: "var(--plot-space-4)",
};

export function ErrorToast() {
	const error = useStore($plotError);
	return error === undefined ? null : (
		<Text as="p" variant="error" DANGEROUS_style={toastStyle}>
			{error}
		</Text>
	);
}
