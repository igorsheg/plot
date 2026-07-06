import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PlotApp } from "./app/app.js";
import { ThemeProvider } from "./theme/theme.js";
// oxlint-disable-next-line import/no-unassigned-import
import "./style.css";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<ThemeProvider>
			<PlotApp />
		</ThemeProvider>
	</StrictMode>,
);
