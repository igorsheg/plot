import { Schema } from "effect";

const strictOptions = {
	exact: true,
	onExcessProperty: "error",
	errors: "all",
} as const;

const preserveOptions = {
	...strictOptions,
	onExcessProperty: "preserve",
} as const;

export const optional = <S extends Schema.Top>(schema: S) =>
	Schema.optionalKey(schema);

export const decodeOrUndefined = <S extends Schema.Decoder<unknown>>(
	schema: S,
	value: unknown,
	options: "strict" | "preserve" = "strict",
): S["Type"] | undefined => {
	try {
		return Schema.decodeUnknownSync(
			schema,
			options === "preserve" ? preserveOptions : strictOptions,
		)(value);
	} catch {
		return undefined;
	}
};
