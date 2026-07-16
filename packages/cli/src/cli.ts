import { errorMessage } from "@plot/common/primitives";
import { createProcessCliHost, type CliHost } from "./cli-host.js";
import { CliUsageError, parseCliInvocation } from "./cli-parser.js";
import { executeCliInvocation } from "./commands.js";

export const runCli = async (
	args: readonly string[],
	host: CliHost = createProcessCliHost(),
): Promise<number> => {
	try {
		await executeCliInvocation(parseCliInvocation(args), host);
		return 0;
	} catch (error) {
		host.stderr(`Error: ${errorMessage(error)}\n`);
		return error instanceof CliUsageError ? 2 : 1;
	}
};
