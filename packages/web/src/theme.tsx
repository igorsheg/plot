import { createContext, use, useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "./components/ui/button.js";
import {
	Tooltip,
	TooltipPopup,
	TooltipTrigger,
} from "./components/ui/tooltip.js";

export type ThemeMode = "light" | "dark" | "system";

const storageKey = "plot:web:theme";

/** Pure resolution so the tri-state contract is testable. */
export const parseStoredMode = (value: string | null): ThemeMode =>
	value === "light" || value === "dark" ? value : "system";

export const resolveDark = (
	mode: ThemeMode,
	systemPrefersDark: boolean,
): boolean => mode === "dark" || (mode === "system" && systemPrefersDark);

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)");

const applyMode = (mode: ThemeMode) => {
	document.documentElement.classList.toggle(
		"dark",
		resolveDark(mode, systemDark().matches),
	);
};

interface ThemeContextValue {
	readonly state: { readonly mode: ThemeMode };
	readonly actions: { readonly setMode: (mode: ThemeMode) => void };
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const useTheme = (): ThemeContextValue => {
	const value = use(ThemeContext);
	if (value === null) throw new Error("useTheme outside ThemeProvider");
	return value;
};

/** Owns theme state; the only module that touches localStorage/matchMedia. */
export function ThemeProvider({ children }: { readonly children: ReactNode }) {
	const [mode, setModeState] = useState<ThemeMode>(() =>
		parseStoredMode(localStorage.getItem(storageKey)),
	);
	const setMode = useCallback((next: ThemeMode) => {
		setModeState(next);
		try {
			localStorage.setItem(storageKey, next);
		} catch {
			// ponytail: persistence is a convenience; theming must keep working.
		}
	}, []);
	useEffect(() => {
		applyMode(mode);
		if (mode !== "system") return;
		const media = systemDark();
		const onChange = () => applyMode("system");
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, [mode]);
	return (
		<ThemeContext value={{ state: { mode }, actions: { setMode } }}>
			{children}
		</ThemeContext>
	);
}

const nextMode: Record<ThemeMode, ThemeMode> = {
	system: "light",
	light: "dark",
	dark: "system",
};

const modeGlyph: Record<ThemeMode, string> = {
	light: "☀",
	dark: "☾",
	system: "◐",
};

export function ThemeToggle() {
	const { state, actions } = useTheme();
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						size="sm"
						variant="ghost"
						aria-label={`Theme: ${state.mode}`}
						onClick={() => actions.setMode(nextMode[state.mode])}
					/>
				}
			>
				{modeGlyph[state.mode]}
			</TooltipTrigger>
			<TooltipPopup>
				theme: {state.mode} · click for {nextMode[state.mode]}
			</TooltipPopup>
		</Tooltip>
	);
}
