import { useStore } from "@nanostores/react";
import { CircleHalfTiltIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import { atom, onMount } from "nanostores";
import { createElement, type ReactNode } from "react";
import { Button } from "../components/ui/button.js";

export type ThemeMode = "light" | "dark" | "system";

const storageKey = "plot:web:theme";

export const parseStoredMode = (value: string | null): ThemeMode =>
	value === "light" || value === "dark" ? value : "system";

export const resolveDark = (
	mode: ThemeMode,
	systemPrefersDark: boolean,
): boolean => mode === "dark" || (mode === "system" && systemPrefersDark);

const storedMode = (): ThemeMode => {
	try {
		return parseStoredMode(
			globalThis.localStorage?.getItem(storageKey) ?? null,
		);
	} catch {
		return "system";
	}
};

const saveMode = (mode: ThemeMode) => {
	try {
		globalThis.localStorage?.setItem(storageKey, mode);
	} catch {
		// ponytail: persistence is a convenience; theming must keep working.
	}
};

const systemDark = (): MediaQueryList | undefined =>
	globalThis.window?.matchMedia("(prefers-color-scheme: dark)");

const applyMode = (mode: ThemeMode, systemPrefersDark = false) => {
	const root = globalThis.document?.documentElement;
	if (root === undefined) return;
	const dark = resolveDark(mode, systemPrefersDark);
	root.dataset["theme"] = "coss";
	root.dataset["mode"] = dark ? "dark" : "light";
	root.classList.toggle("dark", dark);
};

export const $themeMode = atom<ThemeMode>("system");

onMount($themeMode, () => {
	const media = systemDark();
	const applyCurrent = (mode: ThemeMode) => {
		saveMode(mode);
		applyMode(mode, media?.matches ?? false);
	};
	const unlisten = $themeMode.listen(applyCurrent);
	const next = storedMode();
	$themeMode.set(next);
	applyMode(next, media?.matches ?? false);
	const onSystemChange = () => {
		if ($themeMode.get() === "system")
			applyMode("system", media?.matches ?? false);
	};
	media?.addEventListener("change", onSystemChange);
	return () => {
		unlisten();
		media?.removeEventListener("change", onSystemChange);
	};
});

export const setThemeMode = (mode: ThemeMode): void => {
	$themeMode.set(mode);
};

export const nextThemeMode = (mode: ThemeMode): ThemeMode => {
	switch (mode) {
		case "system":
			return "light";
		case "light":
			return "dark";
		case "dark":
			return "system";
	}
};

const modeIcon = {
	light: SunIcon,
	dark: MoonIcon,
	system: CircleHalfTiltIcon,
} as const;

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
	useStore($themeMode);
	return <>{children}</>;
}

export function ThemeToggle() {
	const mode = useStore($themeMode);
	const next = nextThemeMode(mode);
	return (
		<Button
			aria-label={`Theme: ${mode}; click for ${next}`}
			size="icon-sm"
			title={`theme: ${mode}`}
			variant="ghost"
			onClick={() => setThemeMode(next)}
		>
			{createElement(modeIcon[mode], { "aria-hidden": true })}
		</Button>
	);
}
