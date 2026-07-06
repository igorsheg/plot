const encoder = new TextEncoder();

export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const isPositiveInteger = (value: number): boolean =>
	Number.isInteger(value) && value >= 1;

export const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export const byteLength = (value: string): number =>
	encoder.encode(value).length;

export const hasErrnoCode = (error: unknown, code: string): boolean =>
	isRecord(error) && error["code"] === code;
