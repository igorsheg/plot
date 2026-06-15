import type { ComponentType } from "react";

// Minimal icon contract shared by primitives that accept an icon component.
// Compatible with lucide-react icons (size / strokeWidth / className). Ported in
// spirit from fluid-functionalism's icon-context, without the multi-library
// icon-map — lucide is the single source.
export type IconComponent = ComponentType<{
	size?: number | string;
	strokeWidth?: number | string;
	className?: string;
}>;
