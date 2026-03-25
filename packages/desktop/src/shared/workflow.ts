import matter from "gray-matter";
import { stringify as yamlStringify } from "yaml";

const snakeToCamel = (s: string): string =>
	s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export const camelToSnake = (s: string): string =>
	s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export const transformKeys = (obj: unknown): unknown => {
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

export const transformKeysToSnake = (obj: unknown): unknown => {
	if (Array.isArray(obj)) return obj.map(transformKeysToSnake);
	if (obj !== null && typeof obj === "object") {
		const result: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
			result[camelToSnake(k)] = transformKeysToSnake(v);
		}
		return result;
	}
	return obj;
};

export function parseWorkflow(content: string): {
	frontmatter: Record<string, unknown>;
	body: string;
} {
	const { data, content: body } = matter(content);

	if (data === null || data === undefined) {
		return { frontmatter: {}, body: body.trim() };
	}
	if (typeof data !== "object" || Array.isArray(data)) {
		throw new Error("Front matter must be a YAML map");
	}

	return {
		frontmatter: transformKeys(data) as Record<string, unknown>,
		body: body.trim(),
	};
}

export function serializeWorkflow(
	frontmatter: Record<string, unknown>,
	body: string,
): string {
	const snaked = transformKeysToSnake(frontmatter) as Record<string, unknown>;
	const yaml = yamlStringify(snaked, { lineWidth: 0 });
	return `---\n${yaml}---\n\n${body}\n`;
}
