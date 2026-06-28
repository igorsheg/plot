export const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const encoder = new TextEncoder();
export const byteLength = (value: string): number =>
	encoder.encode(value).length;
