import { useEffect } from "react";
import { useActionQueue } from "./action-queue.js";

const rowSelector = '[data-needs-you-row="true"]';

const isTypingTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target.isContentEditable
	);
};

const rows = (): readonly HTMLElement[] =>
	Array.from(document.querySelectorAll<HTMLElement>(rowSelector));

const focusedRow = (): HTMLElement | undefined =>
	document.activeElement instanceof HTMLElement
		? (document.activeElement.closest<HTMLElement>(rowSelector) ?? undefined)
		: undefined;

const focusBy = (delta: number): void => {
	const all = rows();
	if (all.length === 0) return;
	const current = focusedRow();
	const index = current === undefined ? -1 : all.indexOf(current);
	all[(index + delta + all.length) % all.length]?.focus();
};

const dispatchToFocused = (kind: "comment" | "primary"): void => {
	focusedRow()
		?.querySelector<HTMLElement>('[data-operator-zone="true"]')
		?.dispatchEvent(
			new CustomEvent("plot:queue-action", { bubbles: true, detail: { kind } }),
		);
};

export function useQueueKeys({ active }: { readonly active: boolean }) {
	const queue = useActionQueue();
	useEffect(() => {
		if (!active) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				isTypingTarget(event.target) ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey
			)
				return;
			switch (event.key) {
				case "j":
					event.preventDefault();
					focusBy(1);
					break;
				case "k":
					event.preventDefault();
					focusBy(-1);
					break;
				case "e":
					event.preventDefault();
					dispatchToFocused("primary");
					break;
				case "r":
					event.preventDefault();
					dispatchToFocused("comment");
					break;
				case "Enter": {
					const row = focusedRow();
					if (row?.dataset["workHref"] === undefined) return;
					event.preventDefault();
					window.location.hash = row.dataset["workHref"];
					break;
				}
				case "u":
					event.preventDefault();
					queue.actions.undoLatest();
					break;
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [active, queue.actions]);
}
