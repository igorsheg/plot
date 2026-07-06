import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { PlotApp } from "./app/app.js";
import { ThemeProvider } from "./theme/theme.js";
// oxlint-disable-next-line import/no-unassigned-import
import "./style.css";

const root = createRoot(document.getElementById("root")!);

const render = (children: ReactNode): void => {
	root.render(
		<StrictMode>
			<ThemeProvider>{children}</ThemeProvider>
		</StrictMode>,
	);
};

if (import.meta.env.DEV && globalThis.location.pathname === "/lab") {
	void import("./app/lab.js").then(({ LabPage }) => render(<LabPage />));
} else {
	render(<PlotApp />);
}
