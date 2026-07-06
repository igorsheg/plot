import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PlotApp } from "./app/app.js";
import { LabPage } from "./app/lab.js";
import { ThemeProvider } from "./theme/theme.js";
// oxlint-disable-next-line import/no-unassigned-import
import "./style.css";

const isLab = import.meta.env.DEV && globalThis.location.pathname === "/lab";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<ThemeProvider>{isLab ? <LabPage /> : <PlotApp />}</ThemeProvider>
	</StrictMode>,
);
