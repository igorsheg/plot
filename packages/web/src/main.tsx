import { createRoot } from "react-dom/client";
// oxlint-disable-next-line import/no-unassigned-import -- bundled Fluid Functionalism font.
import "@fontsource/inter";
// oxlint-disable-next-line import/no-unassigned-import -- Vite CSS entry import.
import "./globals.css";
import { DashboardPage } from "./app/dashboard/DashboardPage";
import { IconProvider } from "./lib/icon-context";
import { ShapeProvider } from "./lib/shape-context";
import { SurfaceProvider } from "./lib/surface-context";
import { ThemeProvider } from "./lib/theme-context";

// Fluid Functionalism providers: theme (light/dark, T), shape (corner radius, R),
// icon library (I), and the surface substrate the elevation ladder steps up from.
const App = () => (
	<ThemeProvider>
		<ShapeProvider>
			<IconProvider>
				<SurfaceProvider value={1}>
					<DashboardPage />
				</SurfaceProvider>
			</IconProvider>
		</ShapeProvider>
	</ThemeProvider>
);

const root = document.getElementById("root");
if (!root) throw new Error("missing root element");
createRoot(root).render(<App />);
