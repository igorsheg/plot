import matter from "gray-matter";

const snakeToCamel = (s: string): string =>
	s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

const transformKeys = (obj: unknown): unknown => {
	if (Array.isArray(obj)) return obj.map(transformKeys);
	if (obj !== null && typeof obj === "object") {
		const result: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
			result[snakeToCamel(k)] = transformKeys(v);
		}
		return result;
	}
	return obj;
};

interface RawFrontmatter {
	readonly configRaw: Record<string, unknown>;
	readonly promptTemplate: string;
}

export function extractFrontmatter(content: string): RawFrontmatter {
	const { data, content: promptBody } = matter(content);

	if (data === null || data === undefined) {
		return { configRaw: {}, promptTemplate: promptBody.trim() };
	}
	if (typeof data !== "object" || Array.isArray(data)) {
		throw new Error("Front matter must be a YAML map");
	}

	return {
		configRaw: transformKeys(data) as Record<string, unknown>,
		promptTemplate: promptBody.trim(),
	};
}
