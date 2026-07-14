import { useStore } from "@nanostores/react";
import { createElement } from "react";
import { Button } from "../components/ui/button.js";
import { KanbanIcon, ListDashesIcon } from "../components/ui/icons.js";
import {
	$layoutMode,
	nextLayoutMode,
	setLayoutMode,
	type LayoutMode,
} from "./layout-store.js";

const modeIcon = {
	river: ListDashesIcon,
	board: KanbanIcon,
} as const;

const modeLabel: Record<LayoutMode, string> = {
	river: "river",
	board: "board",
};

export function LayoutToggle() {
	const mode = useStore($layoutMode);
	const next = nextLayoutMode(mode);
	return (
		<Button
			aria-label={`Layout: ${modeLabel[mode]}; switch to ${modeLabel[next]}`}
			onClick={() => setLayoutMode(next)}
			size="icon-sm"
			title={`layout: ${modeLabel[mode]}`}
			variant="ghost"
		>
			{createElement(modeIcon[mode], { "aria-hidden": true })}
		</Button>
	);
}
