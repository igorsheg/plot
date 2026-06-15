import {
	createContext,
	type ReactNode,
	use,
	useCallback,
	useEffect,
	useState,
} from "react";

// Light/dark/system theming. The provider is the only owner of theme state and
// the only thing that writes the `.light`/`.dark` class to <html>; UI reads
// `useThemeContext()`. Ported from fluid-functionalism, modernized to `use()`.
type Theme = "system" | "light" | "dark";

const themeOrder: Theme[] = ["system", "light", "dark"];

interface ThemeContextValue {
	theme: Theme;
	setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useThemeContext() {
	const ctx = use(ThemeContext);
	if (!ctx) {
		throw new Error("useThemeContext must be used within a ThemeProvider");
	}
	return ctx;
}

function applyTheme(next: Theme) {
	const root = document.documentElement;
	root.classList.remove("light", "dark");
	if (next !== "system") root.classList.add(next);
}

export function ThemeProvider({
	children,
	defaultTheme = "system",
}: {
	children: ReactNode;
	defaultTheme?: Theme;
}) {
	const [theme, setThemeState] = useState<Theme>(defaultTheme);

	const setTheme = useCallback((next: Theme) => {
		const root = document.documentElement;
		root.classList.add("transitioning");
		void root.offsetHeight;
		setThemeState(next);
		setTimeout(() => root.classList.remove("transitioning"), 200);
	}, []);

	useEffect(() => {
		applyTheme(theme);
	}, [theme]);

	// Global keyboard shortcut: T cycles theme (a fluid signature).
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "t" && event.key !== "T") return;
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			const tag = (event.target as HTMLElement)?.tagName;
			if (
				tag === "INPUT" ||
				tag === "TEXTAREA" ||
				(event.target as HTMLElement)?.isContentEditable
			) {
				return;
			}
			event.preventDefault();
			setThemeState((prev) => {
				const next =
					themeOrder[(themeOrder.indexOf(prev) + 1) % themeOrder.length] ??
					prev;
				const root = document.documentElement;
				root.classList.add("transitioning");
				void root.offsetHeight;
				applyTheme(next);
				setTimeout(() => root.classList.remove("transitioning"), 200);
				return next;
			});
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);

	return (
		<ThemeContext.Provider value={{ theme, setTheme }}>
			{children}
		</ThemeContext.Provider>
	);
}

export type { Theme };
