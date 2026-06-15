import { RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
// oxlint-disable-next-line import/no-unassigned-import -- Vite CSS entry import (also loads self-hosted @font-face for Inter + Berkeley Mono).
import "./globals.css";
import { readBrowserControlHandoff } from "./app/dashboard/web-control-client";
import { IconProvider } from "./lib/icon-context";
import { ShapeProvider } from "./lib/shape-context";
import { SurfaceProvider } from "./lib/surface-context";
import { ThemeProvider } from "./lib/theme-context";
import { createDashboardRouter } from "./router";

const router = createDashboardRouter();

// Consume the Local Plot Server handoff (ws/token) before the router reads the
// URL: it persists the wsUrl to sessionStorage and strips those params, so the
// router only ever sees clean session/role state.
readBrowserControlHandoff(window.location);

// Fluid Functionalism providers: theme (light/dark, T), shape (corner radius, R),
// icon library (I), and the surface substrate the elevation ladder steps up from.
const App = () => (
	<ThemeProvider>
		<ShapeProvider>
			<IconProvider>
				<SurfaceProvider value={1}>
					<RouterProvider router={router} />
				</SurfaceProvider>
			</IconProvider>
		</ShapeProvider>
	</ThemeProvider>
);

const root = document.getElementById("root");
if (!root) throw new Error("missing root element");
createRoot(root).render(<App />);
