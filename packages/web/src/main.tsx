import React from "react";
import { createRoot } from "react-dom/client";
// oxlint-disable-next-line import/no-unassigned-import -- Vite CSS entry import.
import "./globals.css";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "./components/ui/sonner";

const App = () => (
	<ThemeProvider>
		<main className="min-h-screen bg-background text-foreground">
			<section className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-16">
				<p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
					Plot Web
				</p>
				<h1 className="text-4xl font-semibold tracking-tight">
					Web substrate imported; Plot-specific UX comes next.
				</h1>
				<p className="text-muted-foreground">
					This package carries the Vite/Rolldown shell, theme controller, UI
					primitives, and diff-viewer substrate without Next.js runtime
					coupling.
				</p>
			</section>
		</main>
		<Toaster />
	</ThemeProvider>
);

const root = document.getElementById("root");
if (!root) throw new Error("missing root element");
createRoot(root).render(<App />);
