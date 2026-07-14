import { atom, onMount } from "nanostores";

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
	const unlisten = $layoutMode.listen(saveLayout);
	$layoutMode.set(storedLayout());
	return unlisten;
});

export const setLayoutMode = (mode: LayoutMode): void => {
	$layoutMode.set(mode);
};

export const nextLayoutMode = (mode: LayoutMode): LayoutMode =>
	mode === "river" ? "board" : "river";
