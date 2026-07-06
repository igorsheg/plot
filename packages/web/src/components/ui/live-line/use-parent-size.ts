/**
 * Environment-observation hooks: ResizeObserver-driven parent sizing
 * (rAF-debounced) and the prefers-reduced-motion media query.
 */

import { type RefObject, useEffect, useRef, useState } from "react";

interface ParentSize {
	width: number;
	height: number;
}

export function useParentSize(): {
	ref: RefObject<HTMLDivElement | null>;
	width: number;
	height: number;
} {
	const ref = useRef<HTMLDivElement | null>(null);
	const [size, setSize] = useState<ParentSize>({ width: 0, height: 0 });

	useEffect(() => {
		const element = ref.current;
		if (element === null) {
			return;
		}
		let raf = 0;
		const measure = () => {
			const rect = element.getBoundingClientRect();
			const width = Math.floor(rect.width);
			const height = Math.floor(rect.height);
			setSize((prev) =>
				prev.width === width && prev.height === height
					? prev
					: { width, height },
			);
		};
		const observer = new ResizeObserver(() => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(measure);
		});
		observer.observe(element);
		measure();
		return () => {
			cancelAnimationFrame(raf);
			observer.disconnect();
		};
	}, []);

	return { ref, width: size.width, height: size.height };
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
	const [reduced, setReduced] = useState(
		() =>
			typeof window !== "undefined" &&
			window.matchMedia(REDUCED_MOTION_QUERY).matches,
	);

	useEffect(() => {
		const query = window.matchMedia(REDUCED_MOTION_QUERY);
		const onChange = () => setReduced(query.matches);
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);

	return reduced;
}
