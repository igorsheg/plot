export const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const encoder = new TextEncoder();
export const byteLength = (value: string): number =>
	encoder.encode(value).length;
