import { createContext, type ReactNode, use } from "react";

// Tracks the substrate elevation level (1-8) for descendants. `Elevated` reads
// it, steps up by its offset, and re-provides — so nesting walks the surface
// ladder automatically. Ported from fluid-functionalism.
const SurfaceContext = createContext<number>(1);

export function useSurface(): number {
	return use(SurfaceContext);
}

export function SurfaceProvider({
	value,
	children,
}: {
	value: number;
	children: ReactNode;
}) {
	return (
		<SurfaceContext.Provider value={Math.max(1, Math.min(8, value))}>
			{children}
		</SurfaceContext.Provider>
	);
}
