import type { ProjectableEvent } from "./types.js";

export const str = (v: unknown) => (typeof v === "string" ? v : undefined);
export const num = (v: unknown) => (typeof v === "number" ? v : undefined);
export const at = (e: ProjectableEvent) =>
	Date.parse(e.timestamp) || Date.now();
export const cap = <T>(xs: readonly T[], n: number) => xs.slice(0, n);
