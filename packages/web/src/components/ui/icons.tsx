/**
 * Plot's icon module — the single seam over the icon vendor.
 *
 * The rest of the app imports icons from here, never from `@phosphor-icons/react`
 * directly, so the vendor stays swappable behind this file. Phosphor covers the
 * generic set; Plot's own work-state glyphs are vendored below and reached
 * through `WorkStateIcon`.
 */

import { forwardRef, type ReactNode, type SVGProps } from "react";
import type { Icon } from "@phosphor-icons/react";

export type { Icon };

// Phosphor icons in use across the app, re-exported through the seam.
export {
	ArrowUpRightIcon,
	CheckCircleIcon,
	CircleHalfTiltIcon,
	CircleNotchIcon,
	InfoIcon,
	MoonIcon,
	SunIcon,
	WarningCircleIcon,
	WarningIcon,
	XIcon,
} from "@phosphor-icons/react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
	readonly size?: number | string;
};

/**
 * Vendored glyphs are drawn on a 24px grid with a 2px stroke and paint with
 * `currentColor`, so colour comes from CSS `color` (or the `color` prop) exactly
 * like the Phosphor icons they sit beside.
 */
function glyph(name: string, children: ReactNode) {
	const Glyph = forwardRef<SVGSVGElement, IconProps>(function Glyph(
		{ size = "1em", ...props },
		ref,
	) {
		return (
			<svg
				ref={ref}
				xmlns="http://www.w3.org/2000/svg"
				width={size}
				height={size}
				viewBox="0 0 24 24"
				fill="none"
				aria-hidden
				{...props}
			>
				{children}
			</svg>
		);
	});
	Glyph.displayName = name;
	return Glyph;
}

const CircleDashed = glyph(
	"CircleDashed",
	<path
		d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
		stroke="currentColor"
		strokeWidth={2}
		strokeLinecap="round"
		strokeLinejoin="round"
		strokeDasharray="3 4"
	/>,
);

const CircleHalf = glyph(
	"CircleHalf",
	<>
		<path
			d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
			stroke="currentColor"
			strokeWidth={2}
		/>
		<path
			d="M12 5.75C13.1193 5.75 14.2181 6.05059 15.1815 6.62036C16.1449 7.19014 16.9377 8.00818 17.4769 8.98904C18.0161 9.9699 18.2821 11.0776 18.2469 12.1963C18.2118 13.3151 17.8768 14.4039 17.2771 15.3489L12 12V5.75Z"
			fill="currentColor"
		/>
	</>,
);

const CircleOpen = glyph(
	"CircleOpen",
	<circle cx={12} cy={12} r={9} stroke="currentColor" strokeWidth={2} />,
);

const CircleCheck = glyph(
	"CircleCheck",
	<>
		<circle
			cx={12}
			cy={12}
			r={9}
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M8 12.875L10.625 15.5L15 9"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</>,
);

const CircleX = glyph(
	"CircleX",
	<path
		d="M15 9L9 15M15 15L9 9M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
		stroke="currentColor"
		strokeWidth={2}
		strokeLinecap="round"
		strokeLinejoin="round"
	/>,
);

/** The work-item lifecycle vocabulary the river and drawer speak. */
export type WorkState = "attention" | "active" | "queued" | "done" | "canceled";

const STATE_GLYPH: Record<WorkState, ReturnType<typeof glyph>> = {
	attention: CircleOpen,
	active: CircleHalf,
	queued: CircleDashed,
	done: CircleCheck,
	canceled: CircleX,
};

/** One status glyph, selected by work state. Colour comes from `color`/CSS. */
export function WorkStateIcon({
	state,
	...props
}: { readonly state: WorkState } & IconProps) {
	const Glyph = STATE_GLYPH[state];
	return <Glyph {...props} />;
}
