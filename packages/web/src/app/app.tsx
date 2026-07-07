import { SessionMain } from "../components/session-document.js";
import {
	SessionDock,
	StoreSessionDockProvider,
} from "../components/session-dock/session-dock.js";
import Stack from "../components/ui/stack.js";
import { appShellClass, dockAnchorClass, themeAnchorClass } from "./styles.js";
import { ThemeToggle } from "../theme/theme.js";

export function PlotApp() {
	return (
		<Stack className={appShellClass()}>
			<div className={dockAnchorClass()}>
				<StoreSessionDockProvider>
					<SessionDock />
				</StoreSessionDockProvider>
			</div>
			<SessionMain />
			<div className={themeAnchorClass()}>
				<ThemeToggle />
			</div>
		</Stack>
	);
}
