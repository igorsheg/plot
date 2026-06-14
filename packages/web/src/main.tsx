import React from "react";
import { createRoot } from "react-dom/client";
// oxlint-disable-next-line import/no-unassigned-import -- Vite CSS entry import.
import "./globals.css";
import { DashboardPage } from "./app/dashboard/DashboardPage";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "./components/ui/sonner";

const App = () => (
	<ThemeProvider>
		<DashboardPage />
		<Toaster />
	</ThemeProvider>
);

const root = document.getElementById("root");
if (!root) throw new Error("missing root element");
createRoot(root).render(<App />);
