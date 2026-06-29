import { EventEmitter } from "node:events";
import { describe, expect, test } from "bun:test";
import {
	TUI,
	type Component,
	type ProcessTerminal,
} from "../src/terminal-ui.js";

class FakeInput extends EventEmitter {
	isRaw = false;
	setRawMode(value: boolean): void {
		this.isRaw = value;
	}
	resume(): void {}
	pause(): void {}
}

class FakeOutput extends EventEmitter {
	columns = 20;
	rows = 5;
}

class FakeTerminal {
	readonly input = new FakeInput();
	readonly output = new FakeOutput();
	readonly writes: string[] = [];
	get columns(): number {
		return this.output.columns;
	}
	get rows(): number {
		return this.output.rows;
	}
	write(text: string): void {
		this.writes.push(text);
	}
	clearWrites(): void {
		this.writes.length = 0;
	}
}

class LinesComponent implements Component {
	constructor(public lines: string[]) {}
	render(): string[] {
		return this.lines;
	}
	invalidate(): void {}
}

const flushRender = async () => {
	await Promise.resolve();
};

describe("TUI renderer", () => {
	test("does not clear the whole screen on unchanged rerenders", async () => {
		const terminal = new FakeTerminal();
		const component = new LinesComponent(["one", "two"]);
		const tui = new TUI(terminal as unknown as ProcessTerminal);
		tui.addChild(component);
		tui.start();
		await flushRender();
		terminal.clearWrites();

		tui.requestRender();
		await flushRender();

		expect(terminal.writes.join("")).not.toContain("\x1b[2J");
		tui.stop();
	});

	test("updates changed lines without a full clear", async () => {
		const terminal = new FakeTerminal();
		const component = new LinesComponent(["one", "two"]);
		const tui = new TUI(terminal as unknown as ProcessTerminal);
		tui.addChild(component);
		tui.start();
		await flushRender();
		terminal.clearWrites();

		component.lines = ["one", "TWO"];
		tui.requestRender();
		await flushRender();

		const output = terminal.writes.join("");
		expect(output).not.toContain("\x1b[2J");
		expect(output).toContain("\x1b[2;1H\x1b[2KTWO");
		tui.stop();
	});

	test("clears stale rows when content shrinks", async () => {
		const terminal = new FakeTerminal();
		const component = new LinesComponent(["one", "two", "three"]);
		const tui = new TUI(terminal as unknown as ProcessTerminal);
		tui.addChild(component);
		tui.start();
		await flushRender();
		terminal.clearWrites();

		component.lines = ["one"];
		tui.requestRender();
		await flushRender();

		const output = terminal.writes.join("");
		expect(output).not.toContain("\x1b[2J");
		expect(output).toContain("\x1b[2;1H\x1b[2K");
		expect(output).toContain("\x1b[3;1H\x1b[2K");
		tui.stop();
	});
});
