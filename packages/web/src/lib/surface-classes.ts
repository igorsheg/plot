/**
 * Static lookup tables for surface tokens.
 *
 * Tailwind v4's static scanner only generates utility classes for literal
 * strings it sees in source. Template-literal class names like
 * `bg-surface-${level}` are invisible to the scanner, so the matching utility
 * never gets generated and the background renders transparent. These maps keep
 * the literal class names in source so Tailwind emits them.
 *
 *   <div className={surfaceClasses(level)} />
 *
 * Ported from fluid-functionalism (registry/default/lib/surface-classes).
 */

export const SURFACE_BG: Record<number, string> = {
	1: "bg-surface-1",
	2: "bg-surface-2",
	3: "bg-surface-3",
	4: "bg-surface-4",
	5: "bg-surface-5",
	6: "bg-surface-6",
	7: "bg-surface-7",
	8: "bg-surface-8",
};

export const SURFACE_SHADOW: Record<number, string> = {
	1: "shadow-surface-1",
	2: "shadow-surface-2",
	3: "shadow-surface-3",
	4: "shadow-surface-4",
	5: "shadow-surface-5",
	6: "shadow-surface-6",
	7: "shadow-surface-7",
	8: "shadow-surface-8",
};

export function surfaceClasses(
	bgLevel: number,
	shadowLevel: number = bgLevel,
): string {
	const bg = Math.max(1, Math.min(8, bgLevel));
	const shadow = Math.max(1, Math.min(8, shadowLevel));
	return `${SURFACE_BG[bg]} ${SURFACE_SHADOW[shadow]}`;
}
