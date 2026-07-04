import { Theme } from "@astryxdesign/core";
import { IconButton } from "@astryxdesign/core/IconButton";
import { createContext, use, useCallback, useState } from "react";
import type { ReactNode } from "react";
import { plotTheme } from "./plot-theme.js";

export type ThemeMode = "light" | "dark" | "system";

const storageKey = "plot:web:theme";

/** Pure resolution so the tri-state contract is testable. */
export const parseStoredMode = (value: string | null): ThemeMode =>
	value === "light" || value === "dark" ? value : "system";

export const resolveDark = (
	mode: ThemeMode,
	systemPrefersDark: boolean,
): boolean => mode === "dark" || (mode === "system" && systemPrefersDark);

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

/** Owns theme state and persistence; Astryx Theme owns OS mode tracking. */
export function ThemeProvider({ children }: { readonly children: ReactNode }) {
	const [mode, setModeState] = useState<ThemeMode>(() => {
		try {
			return parseStoredMode(localStorage.getItem(storageKey));
		} catch {
			return "system";
		}
	});
	const setMode = useCallback((next: ThemeMode) => {
		setModeState(next);
		try {
			localStorage.setItem(storageKey, next);
		} catch {
			// ponytail: persistence is a convenience; theming must keep working.
		}
	}, []);
	return (
		<ThemeContext value={{ state: { mode }, actions: { setMode } }}>
			<Theme theme={plotTheme} mode={mode}>
				{children}
			</Theme>
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
		<IconButton
			label={`Theme: ${state.mode}`}
			icon={modeGlyph[state.mode]}
			variant="ghost"
			size="sm"
			tooltip={`theme: ${state.mode} · click for ${nextMode[state.mode]}`}
			onClick={() => actions.setMode(nextMode[state.mode])}
		/>
	);
}
