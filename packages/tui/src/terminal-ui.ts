import { visibleWidth } from "./text-width.js";

export interface Component {
	render(width: number): string[];
	handleInput?(data: string): void;
	invalidate(): void;
}

type InputListenerResult = { readonly consume?: boolean } | undefined;

type InputListener = (data: string) => InputListenerResult;

export const parseKey = (data: string): string | undefined => {
	if (data === "\u0003") return "ctrl+c";
	if (data === "\r") return "enter";
	if (data === "\n") return "return";
	if (data === "\u001b") return "escape";
	if (data === "\u001b[A") return "up";
	if (data === "\u001b[B") return "down";
	if (data.length === 1) return data;
	return undefined;
};

export const matchesKey = (data: string, key: string): boolean =>
	parseKey(data) === key;

export class ProcessTerminal {
	readonly input = process.stdin;
	readonly output = process.stdout;
	get columns(): number {
		return this.output.columns ?? 80;
	}
	get rows(): number {
		return this.output.rows ?? 24;
	}
	write(text: string): void {
		this.output.write(text);
	}
}

export class TUI {
	private child: Component | undefined;
	private focus: Component | undefined;
	private renderQueued = false;
	private running = false;
	private previousLines: string[] = [];
	private previousWidth = 0;
	private previousHeight = 0;
	private rendered = false;
	private readonly inputListeners: InputListener[] = [];
	private readonly onData = (chunk: Buffer | string) =>
		this.handleInput(String(chunk));
	private readonly onResize = () => this.requestRender(true);

	constructor(private readonly terminal: ProcessTerminal) {}

	addChild(child: Component): void {
		this.child = child;
	}

	setFocus(child: Component): void {
		this.focus = child;
	}

	addInputListener(listener: InputListener): void {
		this.inputListeners.push(listener);
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.previousLines = [];
		this.previousWidth = 0;
		this.previousHeight = 0;
		this.rendered = false;
		this.terminal.write("\x1b[?1049h\x1b[?25l");
		this.terminal.input.setRawMode?.(true);
		this.terminal.input.resume();
		this.terminal.input.on("data", this.onData);
		this.terminal.output.on("resize", this.onResize);
		this.requestRender();
	}

	stop(): void {
		if (!this.running) return;
		this.running = false;
		this.terminal.input.off("data", this.onData);
		this.terminal.output.off("resize", this.onResize);
		this.terminal.input.setRawMode?.(false);
		this.terminal.input.pause();
		this.terminal.write("\x1b[?25h\x1b[?1049l\n");
	}

	requestRender(force = false): void {
		if (force) {
			this.previousLines = [];
			this.previousWidth = 0;
			this.previousHeight = 0;
			this.rendered = false;
		}
		if (!this.running || this.renderQueued) return;
		this.renderQueued = true;
		queueMicrotask(() => {
			this.renderQueued = false;
			if (!this.running) return;
			this.render();
		});
	}

	private handleInput(data: string): void {
		for (const listener of this.inputListeners) {
			if (listener(data)?.consume) return;
		}
		this.focus?.handleInput?.(data);
		this.requestRender();
	}

	private render(): void {
		const width = this.terminal.columns;
		const height = this.terminal.rows;
		const lines = (this.child?.render(width) ?? [])
			.slice(0, height)
			.map((line) => fitLine(line, width));
		const fullRender =
			!this.rendered ||
			this.previousWidth !== width ||
			this.previousHeight !== height;
		if (fullRender) {
			this.terminal.write(syncOutput(`\x1b[H\x1b[2J${lines.join("\n")}`));
		} else {
			const maxLines = Math.max(lines.length, this.previousLines.length);
			let output = "";
			for (let row = 0; row < maxLines; row++) {
				const line = lines[row] ?? "";
				if (line === (this.previousLines[row] ?? "")) continue;
				output += `\x1b[${row + 1};1H\x1b[2K${line}`;
			}
			if (output.length > 0) this.terminal.write(syncOutput(output));
		}
		this.previousLines = lines;
		this.previousWidth = width;
		this.previousHeight = height;
		this.rendered = true;
	}
}

const syncOutput = (text: string): string => `\x1b[?2026h${text}\x1b[?2026l`;

const fitLine = (line: string, width: number): string => {
	const used = visibleWidth(line);
	return used >= width ? line : `${line}${" ".repeat(width - used)}`;
};
