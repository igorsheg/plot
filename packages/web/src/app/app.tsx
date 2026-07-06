import type { CSSProperties } from "react";
import { ErrorToast } from "../components/error-toast.js";
import { SessionMain } from "../components/session-document.js";
import {
	SessionDock,
	StoreSessionDockProvider,
} from "../components/session-dock/session-dock.js";
import Stack from "../components/ui/stack.js";
import { ThemeToggle } from "../theme/theme.js";

const shellStyle: CSSProperties = {
	background: "var(--color-kumo-canvas)",
	color: "var(--text-color-kumo-default)",
	minHeight: "100%",
};

const dockAnchorStyle: CSSProperties = {
	left: 0,
	paddingLeft: "var(--plot-space-4)",
	position: "fixed",
	top: "50%",
	transform: "translateY(-50%)",
	zIndex: 40,
};

const themeAnchorStyle: CSSProperties = {
	position: "fixed",
	right: "var(--plot-space-4)",
	top: "var(--plot-space-4)",
	zIndex: 40,
};

export function PlotApp() {
	return (
		<Stack style={shellStyle}>
			<div style={dockAnchorStyle}>
				<StoreSessionDockProvider>
					<SessionDock />
				</StoreSessionDockProvider>
			</div>
			<SessionMain />
			<div style={themeAnchorStyle}>
				<ThemeToggle />
			</div>
			<ErrorToast />
		</Stack>
	);
}
