import type { ComponentPropsWithoutRef, Ref } from "react";

import { Elevated } from "@/lib/elevated";
import { useShape } from "@/lib/shape-context";
import { cn } from "@/lib/utils";

// Compound card: a namespace of layout slots (Header/Body/Footer) over an
// elevated surface, instead of one component taking renderHeader/showFooter
// props (composition-patterns: architecture-compound-components). Root sits on
// the surface ladder via Elevated, so nested cards keep stepping up.
interface CardRootProps extends ComponentPropsWithoutRef<"div"> {
	/** Steps above the substrate. 2 = a raised panel on the page floor. */
	offset?: number;
	ref?: Ref<HTMLDivElement>;
}

function CardRoot({
	offset = 2,
	className,
	children,
	ref,
	...props
}: CardRootProps) {
	const shape = useShape();
	return (
		<Elevated
			offset={offset}
			ref={ref}
			className={cn(shape.container, "overflow-hidden", className)}
			{...props}
		>
			{children}
		</Elevated>
	);
}

function CardHeader({ className, ...props }: ComponentPropsWithoutRef<"div">) {
	return <div className={cn("px-4 pt-4", className)} {...props} />;
}

function CardBody({ className, ...props }: ComponentPropsWithoutRef<"div">) {
	return <div className={cn("px-4 py-3", className)} {...props} />;
}

function CardFooter({ className, ...props }: ComponentPropsWithoutRef<"div">) {
	return (
		<div
			className={cn("flex items-center gap-2 px-4 pb-4 pt-2", className)}
			{...props}
		/>
	);
}

export const Card = Object.assign(CardRoot, {
	Root: CardRoot,
	Header: CardHeader,
	Body: CardBody,
	Footer: CardFooter,
});
