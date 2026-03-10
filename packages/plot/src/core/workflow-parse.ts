import { parse as parseYaml } from "yaml";

export const snakeToCamel = (s: string): string =>
  s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

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

export interface RawFrontmatter {
  readonly configRaw: Record<string, unknown>;
  readonly promptTemplate: string;
}

export function extractFrontmatter(content: string): RawFrontmatter {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return { configRaw: {}, promptTemplate: trimmed };
  }

  const endIdx = trimmed.indexOf("\n---", 3);
  if (endIdx === -1) {
    throw new Error("Unterminated YAML front matter");
  }

  const yamlBlock = trimmed.slice(3, endIdx);
  const promptTemplate = trimmed.slice(endIdx + 4).trim();
  const parsed = parseYaml(yamlBlock);

  if (parsed === null || parsed === undefined) {
    return { configRaw: {}, promptTemplate };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Front matter must be a YAML map");
  }

  return {
    configRaw: transformKeys(parsed) as Record<string, unknown>,
    promptTemplate,
  };
}
