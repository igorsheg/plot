import { errorMessage } from "@plot/common/primitives";
import { CliUsageError, parseCliInvocation } from "./cli-parser.js";
import {
	createProcessCliRuntime,
	type CliRuntimeOverrides,
} from "./cli-runtime.js";
import { executeCliInvocation } from "./commands.js";

export const runPlotCli = async (
	args: readonly string[],
	overrides: CliRuntimeOverrides = {},
): Promise<number> => {
	const runtime = createProcessCliRuntime(overrides);
	try {
		const invocation = parseCliInvocation(args);
		await executeCliInvocation(invocation, runtime);
		return 0;
	} catch (error) {
		await runtime.writeStderr(`Error: ${errorMessage(error)}\n`);
		return error instanceof CliUsageError ? 2 : 1;
	}
};
