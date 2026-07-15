import { atom, onMount } from "nanostores";
import {
	$activeSessions,
	$selectedSession,
	selectBoardSession,
} from "./sessions-store.js";

export type LayoutMode = "river" | "board";

const storageKey = "plot:web:layout";

export const parseStoredLayout = (value: string | null): LayoutMode =>
	value === "board" ? "board" : "river";

const storedLayout = (): LayoutMode => {
	try {
		return parseStoredLayout(
			globalThis.localStorage?.getItem(storageKey) ?? null,
		);
	} catch {
		return "river";
	}
};

const saveLayout = (mode: LayoutMode) => {
	try {
		globalThis.localStorage?.setItem(storageKey, mode);
	} catch {
		// ponytail: persistence is a convenience; the layout must keep working.
	}
};

export const $layoutMode = atom<LayoutMode>("river");

onMount($layoutMode, () => {
	const reconcileBoardSession = () => {
		if ($layoutMode.get() === "board") selectBoardSession();
	};
	const unlistenLayout = $layoutMode.listen(saveLayout);
	const unlistenActive = $activeSessions.listen(reconcileBoardSession);
	const unlistenSelected = $selectedSession.listen(reconcileBoardSession);
	const mode = storedLayout();
	if (mode === "board") selectBoardSession();
	$layoutMode.set(mode);
	return () => {
		unlistenLayout();
		unlistenActive();
		unlistenSelected();
	};
});

export const setLayoutMode = (mode: LayoutMode): void => {
	if (mode === "board") selectBoardSession();
	$layoutMode.set(mode);
};

export const nextLayoutMode = (mode: LayoutMode): LayoutMode =>
	mode === "river" ? "board" : "river";
