export type UnknownRecord = Record<string, unknown>;

export const asRecord = (value: unknown): UnknownRecord | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as UnknownRecord)
		: undefined;

export const asString = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

export const asNumber = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const asStringArray = (value: unknown): readonly string[] | undefined =>
	Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: undefined;
