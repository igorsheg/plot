import type { CSSProperties } from "react";
import { ErrorToast } from "../components/error-toast.js";
import { SessionDock } from "../components/session-dock.js";
import { SessionMain } from "../components/session-document.js";
import Stack from "../components/ui/stack.js";

const shellStyle: CSSProperties = {
	background: "var(--color-kumo-canvas)",
	color: "var(--text-color-kumo-default)",
	minHeight: "100%",
};

export function PlotApp() {
	return (
		<Stack style={shellStyle}>
			<SessionDock />
			<SessionMain />
			<ErrorToast />
		</Stack>
	);
}
