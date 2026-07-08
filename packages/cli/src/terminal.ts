const esc = "\u001b[";

export const colorEnabled = (): boolean =>
	process.env["NO_COLOR"] === undefined && process.stdout.isTTY === true;

const ansi = (code: string, text: string, enabled = colorEnabled()): string =>
	enabled ? `${esc}${code}m${text}${esc}0m` : text;

export const terminalStyle = {
	bold: (text: string, enabled?: boolean) => ansi("1", text, enabled),
	muted: (text: string, enabled?: boolean) => ansi("2", text, enabled),
	accent: (text: string, enabled?: boolean) => ansi("36", text, enabled),
};

const logo = [
	"░█▀█░█░░░█▀█░▀█▀",
	"░█▀▀░█░░░█░█░░█░",
	"░▀░░░▀▀▀░▀▀▀░░▀░",
] as const;

export const renderWebDashboardReady = (
	url: string,
	options: { readonly color?: boolean } = {},
): string => {
	const color = options.color ?? colorEnabled();
	const heading = logo
		.map((line) => terminalStyle.accent(line, color))
		.join("\n");
	return [
		"",
		heading,
		"",
		`${terminalStyle.bold("Running at", color)} ${url}`,
		terminalStyle.muted("o open browser • q stop • Ctrl-C stop", color),
		"",
	].join("\n");
};
