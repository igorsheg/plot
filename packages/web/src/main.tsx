import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { PlotApp } from "./app/app.js";
import { PlotErrorToaster } from "./app/plot-error-toaster.js";
import { ThemeProvider } from "./theme/theme.js";
import { ToastProvider } from "./components/ui/toast.js";
// oxlint-disable-next-line import/no-unassigned-import
import "./style.css";

const root = createRoot(document.getElementById("root")!);

const render = (children: ReactNode): void => {
	root.render(
		<StrictMode>
			<ThemeProvider>
				<ToastProvider>
					<PlotErrorToaster />
					{children}
				</ToastProvider>
			</ThemeProvider>
		</StrictMode>,
	);
};

render(<PlotApp />);
