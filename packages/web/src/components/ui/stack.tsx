"use client";

import { useMemo } from "react";
import type {
	ComponentProps,
	ComponentType,
	CSSProperties,
	ElementType,
	ReactNode,
} from "react";

export type Gap =
	| 0
	| 1
	| 2
	| 4
	| 8
	| 12
	| 16
	| 20
	| 24
	| 28
	| 32
	| 36
	| 40
	| 44
	| 48
	| true;

export type AlignContent =
	| "center"
	| "end"
	| "space-around"
	| "space-between"
	| "space-evenly"
	| "start"
	| "stretch";
export type AlignSelf = "baseline" | "center" | "end" | "start" | "stretch";

let defaultGap = 8;

export function setDefaultGap(gap: number) {
	defaultGap = gap;
}

export function resolveGap(gap: Gap | undefined) {
	return gap === true ? defaultGap : gap;
}

function resolveAlignment<T extends AlignContent | AlignSelf>(
	value: T | undefined,
) {
	return value === "start"
		? "flex-start"
		: value === "end"
			? "flex-end"
			: value;
}

export type StackPropsInternal = {
	readonly alignCenter?: boolean;
	readonly alignEnd?: boolean;
	readonly alignStart?: boolean;
	readonly around?: boolean;
	readonly baseline?: boolean;
	readonly between?: boolean;
	readonly center?: boolean;
	readonly children?: ReactNode;
	readonly columnGap?: Gap;
	readonly content?: AlignContent;
	readonly end?: boolean;
	readonly evenly?: boolean;
	readonly flex1?: boolean;
	readonly gap?: Gap;
	readonly horizontalPadding?: Gap;
	readonly inline?: boolean;
	readonly padding?: Gap;
	readonly reverse?: boolean;
	readonly rowGap?: Gap;
	readonly safe?: boolean;
	readonly self?: AlignSelf;
	readonly shrink0?: boolean;
	readonly stretch?: boolean;
	readonly vertical?: boolean;
	readonly verticalPadding?: Gap;
	readonly wrap?: boolean;
};

type AcceptsStyle<C extends ElementType> =
	"style" extends keyof ComponentProps<C> ? C : never;
type AsProp<Component extends ElementType> = { readonly as?: Component };
type PropsToOmit<
	Component extends ElementType,
	Props,
> = keyof (AsProp<Component> & Props);
type BaseStackProps<Component extends ElementType> = StackPropsInternal &
	Omit<ComponentProps<Component>, PropsToOmit<Component, StackPropsInternal>>;

export type StackProps<Component extends ElementType = "div"> =
	AcceptsStyle<Component> extends never
		? never
		: AsProp<Component> & BaseStackProps<Component>;

export default function Stack<Component extends ElementType = "div">({
	alignCenter,
	alignEnd,
	alignStart,
	around,
	as,
	baseline,
	between,
	center,
	columnGap: columnGapProp,
	content,
	end,
	evenly,
	flex1,
	gap: gapProp,
	horizontalPadding,
	inline,
	padding,
	reverse,
	rowGap: rowGapProp,
	safe,
	self,
	shrink0,
	stretch,
	style,
	vertical,
	verticalPadding,
	wrap,
	...props
}: StackProps<Component>) {
	const baseStyle = useMemo(() => {
		const next: CSSProperties = {
			alignContent: resolveAlignment(content),
			alignItems: alignStart
				? "flex-start"
				: alignCenter
					? "center"
					: alignEnd
						? "flex-end"
						: baseline
							? "baseline"
							: undefined,
			alignSelf: resolveAlignment(self),
			display: inline ? "inline-flex" : "flex",
			flexDirection: vertical
				? reverse
					? "column-reverse"
					: "column"
				: reverse
					? "row-reverse"
					: "row",
			flexGrow: stretch ? 1 : undefined,
			flexShrink: shrink0 ? 0 : undefined,
			flexWrap: wrap ? "wrap" : "nowrap",
			justifyContent: center
				? `${safe ? "safe " : ""}center`
				: end
					? `${safe ? "safe " : ""}flex-end`
					: between
						? "space-between"
						: evenly
							? "space-evenly"
							: around
								? "space-around"
								: "flex-start",
			...(flex1 ? { flex: "1 1 0%" } : {}),
		};

		const gap = resolveGap(gapProp);
		const rowGap = resolveGap(rowGapProp);
		const columnGap = resolveGap(columnGapProp);
		if (rowGap != null) next.rowGap = rowGap;
		if (columnGap != null) next.columnGap = columnGap;
		if (gap != null && rowGap == null && columnGap == null) next.gap = gap;

		const vGap = rowGap ?? gap;
		const hGap = columnGap ?? gap;
		if (padding === true) {
			if (vGap != null) next.paddingTop = next.paddingBottom = vGap;
			if (hGap != null) next.paddingLeft = next.paddingRight = hGap;
		} else if (padding != null) {
			next.padding = padding;
		} else {
			if (verticalPadding != null || vGap != null) {
				next.paddingTop = next.paddingBottom =
					verticalPadding === true ? vGap : verticalPadding;
			}
			if (horizontalPadding != null || hGap != null) {
				next.paddingLeft = next.paddingRight =
					horizontalPadding === true ? hGap : horizontalPadding;
			}
		}
		return next;
	}, [
		alignCenter,
		alignEnd,
		alignStart,
		around,
		baseline,
		between,
		center,
		columnGapProp,
		content,
		end,
		evenly,
		flex1,
		gapProp,
		horizontalPadding,
		inline,
		padding,
		reverse,
		rowGapProp,
		safe,
		self,
		shrink0,
		stretch,
		vertical,
		verticalPadding,
		wrap,
	]);

	const Component = as || "div";
	return <Component style={{ ...baseStyle, ...style }} {...props} />;
}

export const VStack = <Component extends ElementType = "div">(
	props: StackProps<Component> & { readonly vertical?: never },
) => <Stack {...props} vertical />;

export const asStack = <Component extends ElementType = "div">(
	Component: AcceptsStyle<Component>,
): ComponentType<BaseStackProps<Component>> => {
	const StackComponent = (props: BaseStackProps<Component>) => (
		<Stack {...(props as StackProps<Component>)} as={Component} />
	);
	const name =
		typeof Component === "string"
			? Component
			: ("displayName" in (Component as ComponentType<unknown>) &&
					(Component as ComponentType<unknown>).displayName) ||
				("name" in (Component as ComponentType<unknown>) &&
					(Component as ComponentType<unknown>).name);
	StackComponent.displayName = name ? `Stack(${name})` : "Stack";
	return StackComponent;
};
