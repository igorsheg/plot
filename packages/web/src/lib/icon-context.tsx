import {
	createContext,
	type ReactNode,
	use,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";

import {
	iconLibraryOrder,
	iconMap,
	type IconComponent,
	type IconLibrary,
	type IconName,
} from "@/lib/icon-map";

// The active icon library, resolved by semantic name. Ported from
// fluid-functionalism, modernized to React 19 `use()`. With a single library
// installed the `I` shortcut is a no-op; the provider stays so adding libraries
// later needs no wiring at the call sites — they already go through `useIcon`.
export type { IconComponent, IconName, IconLibrary } from "@/lib/icon-map";
export { iconLibraryOrder, iconLibraryLabels } from "@/lib/icon-map";

interface IconContextValue {
	iconLibrary: IconLibrary;
	setIconLibrary: (lib: IconLibrary) => void;
}

const IconContext = createContext<IconContextValue | null>(null);

export function useIconLibrary() {
	const ctx = use(IconContext);
	if (!ctx) {
		throw new Error("useIconLibrary must be used within an IconProvider");
	}
	return ctx;
}

/** A single icon component by name. Falls back to Lucide with no provider. */
export function useIcon(name: IconName): IconComponent {
	const ctx = use(IconContext);
	if (!ctx) return iconMap.lucide[name];
	return iconMap[ctx.iconLibrary][name];
}

/** The full map for the active library. Falls back to Lucide with no provider. */
export function useIcons(): Record<IconName, IconComponent> {
	const ctx = use(IconContext);
	const lib = ctx?.iconLibrary ?? "lucide";
	return useMemo(() => iconMap[lib], [lib]);
}

export function IconProvider({
	children,
	defaultLibrary = "lucide",
}: {
	children: ReactNode;
	defaultLibrary?: IconLibrary;
}) {
	const [iconLibrary, setIconLibraryState] =
		useState<IconLibrary>(defaultLibrary);

	const setIconLibrary = useCallback((next: IconLibrary) => {
		setIconLibraryState(next);
	}, []);

	// Global keyboard shortcut: I cycles the icon library (a fluid signature).
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "i" && event.key !== "I") return;
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
			setIconLibraryState((prev) => {
				const idx = iconLibraryOrder.indexOf(prev);
				return iconLibraryOrder[(idx + 1) % iconLibraryOrder.length] ?? prev;
			});
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);

	return (
		<IconContext.Provider value={{ iconLibrary, setIconLibrary }}>
			{children}
		</IconContext.Provider>
	);
}
