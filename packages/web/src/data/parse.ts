import { isRecord } from "@plot/common/primitives";

export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	isRecord(value) ? value : undefined;

export const asString = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

export const asNumber = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const asStringArray = (value: unknown): readonly string[] | undefined =>
	Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: undefined;
