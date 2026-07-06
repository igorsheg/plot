export type VariantMap = Record<string, { readonly classes: string }>;

export const resolveVariant = <T extends VariantMap>(
	variants: T,
	key: keyof T | string | undefined,
	fallback: keyof T | string,
): { readonly classes: string } =>
	variants[String(key ?? fallback)] ??
	variants[String(fallback)] ?? { classes: "" };
