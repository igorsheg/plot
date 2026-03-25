import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	camelToSnake,
	parseWorkflow,
	serializeWorkflow,
	transformKeysToSnake,
} from "./workflow";

const WORKFLOW_FIXTURE = readFileSync(
	join(__dirname, "../../../../WORKFLOW.md"),
	"utf-8",
);

describe("camelToSnake", () => {
	it("converts camelCase to snake_case", () => {
		expect(camelToSnake("intervalMs")).toBe("interval_ms");
		expect(camelToSnake("maxConcurrentAgents")).toBe("max_concurrent_agents");
		expect(camelToSnake("simple")).toBe("simple");
	});
});

describe("transformKeysToSnake", () => {
	it("recursively transforms nested objects", () => {
		const input = { dispatchStates: ["a"], modelByState: { plotTodo: "x" } };
		expect(transformKeysToSnake(input)).toEqual({
			dispatch_states: ["a"],
			model_by_state: { plot_todo: "x" },
		});
	});
});

describe("parseWorkflow", () => {
	it("parses frontmatter and body from real WORKFLOW.md", () => {
		const { frontmatter, body } = parseWorkflow(WORKFLOW_FIXTURE);
		expect(frontmatter.polling).toEqual({ intervalMs: 15000 });
		expect(frontmatter.server).toEqual({ port: 3000 });
		expect(body).toContain("## invariants");
	});

	it("handles empty frontmatter", () => {
		const { frontmatter, body } = parseWorkflow("---\n---\nhello");
		expect(frontmatter).toEqual({});
		expect(body).toBe("hello");
	});

	it("handles empty body", () => {
		const { frontmatter, body } = parseWorkflow("---\nfoo: bar\n---\n");
		expect(frontmatter).toEqual({ foo: "bar" });
		expect(body).toBe("");
	});

	it("handles CRLF line endings", () => {
		const crlf = "---\r\nfoo_bar: 1\r\n---\r\nhello\r\n";
		const { frontmatter, body } = parseWorkflow(crlf);
		expect(frontmatter).toEqual({ fooBar: 1 });
		expect(body).toBe("hello");
	});
});

describe("serializeWorkflow", () => {
	it("produces valid frontmatter document", () => {
		const output = serializeWorkflow({ fooBar: 1 }, "hello");
		expect(output).toBe("---\nfoo_bar: 1\n---\n\nhello\n");
	});
});

describe("round-trip", () => {
	it("parse → serialize → parse produces identical result", () => {
		const first = parseWorkflow(WORKFLOW_FIXTURE);
		const serialized = serializeWorkflow(first.frontmatter, first.body);
		const second = parseWorkflow(serialized);
		expect(second.frontmatter).toEqual(first.frontmatter);
		expect(second.body).toEqual(first.body);
	});

	it("preserves unknown keys", () => {
		const input = "---\ncustom_field: hello\nknown: true\n---\nbody";
		const { frontmatter, body } = parseWorkflow(input);
		expect(frontmatter.customField).toBe("hello");

		const serialized = serializeWorkflow(frontmatter, body);
		const reparsed = parseWorkflow(serialized);
		expect(reparsed.frontmatter.customField).toBe("hello");
		expect(reparsed.frontmatter.known).toBe(true);
	});
});
