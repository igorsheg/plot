import { Schema } from "effect";

// The web is a watcher over trusted producers that grow fields over time.
// Strict excess-property decoding turned every producer addition into a
// silent outage (rows dropped, projections rejected), so tolerant decoding
// is the only mode: unknown keys are preserved, known keys stay typed.
const decodeOptions = {
	exact: true,
	onExcessProperty: "preserve",
	errors: "all",
} as const;

export const optional = <S extends Schema.Top>(schema: S) =>
	Schema.optionalKey(schema);

export const decodeOrUndefined = <S extends Schema.Decoder<unknown>>(
	schema: S,
	value: unknown,
): S["Type"] | undefined => {
	try {
		return Schema.decodeUnknownSync(schema, decodeOptions)(value);
	} catch {
		return undefined;
	}
};
