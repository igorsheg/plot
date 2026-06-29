import { Schema } from "effect";

const strictOptions = {
	exact: true,
	onExcessProperty: "error",
	errors: "all",
} as const;

export const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
export const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0));
export const NonNegativeInteger = Schema.Int.check(
	Schema.isGreaterThanOrEqualTo(0),
);
export const StringRecord = Schema.Record(Schema.String, Schema.Unknown);

export const optional = <S extends Schema.Top>(schema: S) =>
	Schema.optionalKey(schema);

export const decodeBoundary = <S extends Schema.Decoder<unknown>>(
	schema: S,
	value: unknown,
): S["Type"] => Schema.decodeUnknownSync(schema, strictOptions)(value);

export const encodeBoundary = <S extends Schema.Encoder<unknown>>(
	schema: S,
	value: S["Type"],
): S["Encoded"] => Schema.encodeSync(schema, strictOptions)(value);
