import { createRoot } from "react-dom/client";
// oxlint-disable-next-line import/no-unassigned-import -- bundled Fluid Functionalism font.
import "@fontsource/inter";
// oxlint-disable-next-line import/no-unassigned-import -- Vite CSS entry import.
import "./globals.css";
import { DashboardPage } from "./app/dashboard/DashboardPage";
import { ShapeProvider } from "./lib/shape-context";
import { SurfaceProvider } from "./lib/surface-context";
import { ThemeProvider } from "./lib/theme-context";

// Fluid Functionalism providers: theme (light/dark), shape (corner radius), and
// the surface substrate the elevation ladder steps up from.
const App = () => (
	<ThemeProvider>
		<ShapeProvider>
			<SurfaceProvider value={1}>
				<DashboardPage />
			</SurfaceProvider>
		</ShapeProvider>
	</ThemeProvider>
);

const root = document.getElementById("root");
if (!root) throw new Error("missing root element");
createRoot(root).render(<App />);
