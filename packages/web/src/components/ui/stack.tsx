"use client";

import type {
	ComponentPropsWithoutRef,
	CSSProperties,
	ElementType,
	ReactElement,
} from "react";

interface StackOwnProps {
	readonly align?: CSSProperties["alignItems"];
	readonly as?: ElementType;
	readonly direction?: CSSProperties["flexDirection"];
	readonly gap?: number;
	readonly justify?: CSSProperties["justifyContent"];
	readonly wrap?: boolean;
}

export type StackProps<Component extends ElementType = "div"> = StackOwnProps &
	Omit<ComponentPropsWithoutRef<Component>, keyof StackOwnProps>;

export default function Stack<Component extends ElementType = "div">({
	align,
	as,
	direction,
	gap,
	justify,
	style,
	wrap,
	...props
}: StackProps<Component>): ReactElement {
	const Element = as ?? "div";
	return (
		<Element
			style={{
				display: "flex",
				alignItems: align,
				flexDirection: direction,
				flexWrap: wrap ? "wrap" : undefined,
				gap,
				justifyContent: justify,
				...style,
			}}
			{...props}
		/>
	);
}

export const VStack = <Component extends ElementType = "div">(
	props: StackProps<Component>,
): ReactElement => <Stack {...props} direction="column" />;
