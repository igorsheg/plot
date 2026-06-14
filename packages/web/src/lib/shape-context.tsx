import {
	createContext,
	type ReactNode,
	use,
	useCallback,
	useEffect,
	useState,
} from "react";

// Global corner-radius language. A provider exposes the active shape and the
// resolved class set; primitives read `useShape()` for their radius. Ported from
// fluid-functionalism, modernized to React 19 `use()`.
type ShapeVariant = "pill" | "rounded";

const shapeOrder: ShapeVariant[] = ["rounded", "pill"];

interface ShapeClasses {
	item: string;
	bg: string;
	focusRing: string;
	container: string;
	button: string;
	input: string;
}

const shapeMap: Record<ShapeVariant, ShapeClasses> = {
	pill: {
		item: "rounded-[20px]",
		bg: "rounded-[20px]",
		focusRing: "rounded-[22px]",
		container: "rounded-3xl",
		button: "rounded-[20px]",
		input: "rounded-[20px]",
	},
	rounded: {
		item: "rounded-lg",
		bg: "rounded-lg",
		focusRing: "rounded-[10px]",
		container: "rounded-xl",
		button: "rounded-lg",
		input: "rounded-lg",
	},
};

interface ShapeContextValue {
	shape: ShapeVariant;
	setShape: (shape: ShapeVariant) => void;
	classes: ShapeClasses;
}

const ShapeContext = createContext<ShapeContextValue | null>(null);

export function useShape(): ShapeClasses {
	const ctx = use(ShapeContext);
	return ctx ? ctx.classes : shapeMap.rounded;
}

export function useShapeContext() {
	const ctx = use(ShapeContext);
	if (!ctx) {
		throw new Error("useShapeContext must be used within a ShapeProvider");
	}
	return ctx;
}

function transitionShape(callback: () => void) {
	const root = document.documentElement;
	root.classList.add("transitioning");
	void root.offsetHeight;
	callback();
	setTimeout(() => root.classList.remove("transitioning"), 200);
}

export function ShapeProvider({
	children,
	defaultShape = "rounded",
}: {
	children: ReactNode;
	defaultShape?: ShapeVariant;
}) {
	const [shape, setShapeState] = useState<ShapeVariant>(defaultShape);

	const setShape = useCallback((next: ShapeVariant) => {
		transitionShape(() => setShapeState(next));
	}, []);

	// Global keyboard shortcut: R cycles corner radius (a fluid signature).
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "r" && event.key !== "R") return;
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
			transitionShape(() =>
				setShapeState((prev) => {
					const idx = shapeOrder.indexOf(prev);
					return shapeOrder[(idx + 1) % shapeOrder.length] ?? prev;
				}),
			);
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);

	return (
		<ShapeContext.Provider
			value={{ shape, setShape, classes: shapeMap[shape] }}
		>
			{children}
		</ShapeContext.Provider>
	);
}

export { shapeMap };
export type { ShapeVariant, ShapeClasses };
