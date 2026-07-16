import { parseArgs } from "node:util";
import { isDocName, type DocName } from "./docs.js";
import { isHelpTarget, type CliHelpTarget } from "./help.js";

export class CliUsageError extends Error {
	override readonly name = "CliUsageError";
}

export type CliInvocation =
	| { readonly kind: "version" }
	| { readonly kind: "help"; readonly target: CliHelpTarget }
	| { readonly kind: "attach"; readonly workflowPath?: string }
	| { readonly kind: "start"; readonly workflowPath?: string }
	| { readonly kind: "stop"; readonly workflowPath?: string }
	| {
			readonly kind: "status";
			readonly workflowPath?: string;
			readonly all: boolean;
	  }
	| { readonly kind: "check"; readonly workflowPath?: string }
	| {
			readonly kind: "web";
			readonly host?: string;
			readonly port?: number;
	  }
	| {
			readonly kind: "docs";
			readonly topic?: DocName | "sdk";
			readonly paths: boolean;
	  }
	| {
			readonly kind: "auth";
			readonly action: "status" | "login" | "logout";
			readonly provider?: string;
	  }
	| { readonly kind: "models"; readonly search?: string };

const fail = (message: string): never => {
	throw new CliUsageError(message);
};

const parsed = <A>(parse: () => A): A => {
	try {
		return parse();
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error));
	}
};

const parsePositionals = (args: readonly string[]): string[] =>
	parsed(
		() =>
			parseArgs({
				args,
				options: {},
				strict: true,
				allowPositionals: true,
			}).positionals,
	);

const positional = (
	command: string,
	args: readonly string[],
): string | undefined => {
	const values = parsePositionals(args);
	if (args[0] === "--" && values.length !== 1)
		return fail(`${command} -- requires exactly one argument`);
	if (values.length > 1) return fail(`${command} accepts at most one argument`);
	return values[0];
};

const helpInvocation = (parts: readonly string[]): CliInvocation => {
	const target = parts.join(" ") || "root";
	if (!isHelpTarget(target)) return fail(`Unknown help target: ${target}`);
	return { kind: "help", target };
};

const parseHelp = (args: readonly string[]): CliInvocation | undefined => {
	if (args[0] === "help") return helpInvocation(args.slice(1));
	const flag = args.findIndex((arg) => arg === "--help" || arg === "-h");
	if (flag === -1) return;
	if (flag !== args.length - 1)
		return fail("help flag must be the final argument");
	return helpInvocation(args.slice(0, -1));
};

const parseStatus = (args: readonly string[]): CliInvocation => {
	const { values, positionals } = parsed(() =>
		parseArgs({
			args,
			options: { all: { type: "boolean" } },
			strict: true,
			allowPositionals: true,
		}),
	);
	if (positionals.length > 1)
		return fail("status accepts at most one Workflow path");
	if (values.all === true && positionals.length > 0)
		return fail("status accepts either a Workflow path or --all, not both");
	const workflowPath = positionals[0];
	return workflowPath === undefined
		? { kind: "status", all: values.all === true }
		: { kind: "status", workflowPath, all: false };
};

const parseWeb = (args: readonly string[]): CliInvocation => {
	const { values } = parsed(() =>
		parseArgs({
			args,
			options: { host: { type: "string" }, port: { type: "string" } },
			strict: true,
			allowPositionals: false,
		}),
	);
	if (values.host === "") return fail("--host requires a value");
	if (values.port !== undefined && !/^\d+$/.test(values.port))
		return fail(`Invalid Web port: ${values.port}`);
	const port = values.port === undefined ? undefined : Number(values.port);
	if (port !== undefined && (port < 1 || port > 65_535))
		return fail(`Invalid Web port: ${values.port}`);
	const result: { kind: "web"; host?: string; port?: number } = { kind: "web" };
	if (values.host !== undefined) result.host = values.host;
	if (port !== undefined) result.port = port;
	return result;
};

const parseDocs = (args: readonly string[]): CliInvocation => {
	const { values, positionals } = parsed(() =>
		parseArgs({
			args,
			options: { paths: { type: "boolean" } },
			strict: true,
			allowPositionals: true,
		}),
	);
	if (positionals.length > 1) return fail("docs accepts at most one topic");
	if (values.paths === true && positionals.length === 1)
		return fail("docs accepts either a topic or --paths, not both");
	const topic = positionals[0];
	if (topic !== undefined && topic !== "sdk" && !isDocName(topic))
		return fail(`Unknown docs topic: ${topic}`);
	return topic === undefined
		? { kind: "docs", paths: values.paths === true }
		: { kind: "docs", topic, paths: false };
};

const parseAuth = (args: readonly string[]): CliInvocation => {
	const values = parsePositionals(args);
	const action = values[0] ?? "status";
	if (action !== "status" && action !== "login" && action !== "logout")
		return fail(`Unknown auth command: ${action}`);
	if (action === "status" && values.length > 1)
		return fail("auth status accepts no arguments");
	if (values.length > 2)
		return fail(`auth ${action} accepts at most one provider`);
	return values[1] === undefined
		? { kind: "auth", action }
		: { kind: "auth", action, provider: values[1] };
};

const pathLike = (value: string): boolean =>
	value.includes("/") ||
	value.includes("\\") ||
	value.startsWith(".") ||
	/\.md$/i.test(value) ||
	/^[A-Za-z]:/.test(value);

export const parseCliInvocation = (args: readonly string[]): CliInvocation => {
	const help = parseHelp(args);
	if (help !== undefined) return help;
	const first = args[0];
	if (first === "--version" || first === "-v") {
		if (args.length !== 1) return fail("version flag accepts no arguments");
		return { kind: "version" };
	}
	if (first === "--") {
		if (args.length !== 2) return fail("-- requires exactly one Workflow path");
		return { kind: "attach", workflowPath: args[1]! };
	}
	if (first === undefined) return { kind: "attach" };
	if (first.startsWith("-")) return fail(`Unknown option: ${first}`);
	const rest = args.slice(1);
	if (first === "start" || first === "stop" || first === "check") {
		const workflowPath = positional(first, rest);
		return workflowPath === undefined
			? { kind: first }
			: { kind: first, workflowPath };
	}
	if (first === "status") return parseStatus(rest);
	if (first === "web") return parseWeb(rest);
	if (first === "docs") return parseDocs(rest);
	if (first === "auth") return parseAuth(rest);
	if (first === "models") {
		const search = positional(first, rest);
		return search === undefined ? { kind: "models" } : { kind: first, search };
	}
	if (!pathLike(first)) return fail(`Unknown command: ${first}`);
	if (rest.length > 0)
		return fail("Workflow invocation accepts exactly one path");
	return { kind: "attach", workflowPath: first };
};
