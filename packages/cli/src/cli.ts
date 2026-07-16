import { createProcessCliHost, type CliHost } from "./cli-host.js";
import { CliUsageError, parseCliInvocation } from "./cli-parser.js";
import { executeCliInvocation } from "./commands.js";
import { renderCliError } from "./render.js";

export const runCli = async (
	args: readonly string[],
	host: CliHost = createProcessCliHost(),
): Promise<number> => {
	try {
		await executeCliInvocation(parseCliInvocation(args), host);
		return 0;
	} catch (error) {
		const usage = error instanceof CliUsageError;
		host.stderr(renderCliError(error, usage));
		return usage ? 2 : 1;
	}
};
