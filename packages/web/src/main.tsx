import { RouterProvider } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { createRoot } from "react-dom/client";
// oxlint-disable-next-line import/no-unassigned-import -- Vite CSS entry import (also loads self-hosted @font-face for Inter + Berkeley Mono).
import "./globals.css";
import { readBrowserControlHandoff } from "./app/dashboard/web-control-client";
import { createDashboardRouter } from "./router";

const router = createDashboardRouter();

// Consume the Local Plot Server handoff (ws/token) before the router reads the
// URL: it persists the wsUrl to sessionStorage and strips those params, so the
// router only ever sees clean session/role state.
readBrowserControlHandoff(window.location);

const App = () => (
	<MotionConfig reducedMotion="user">
		<RouterProvider router={router} />
	</MotionConfig>
);

const root = document.getElementById("root");
if (!root) throw new Error("missing root element");
createRoot(root).render(<App />);
