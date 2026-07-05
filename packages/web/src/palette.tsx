import { useEffect, useMemo, useRef, useState } from "react";
import { useOptionalActionQueue } from "./action-queue.js";
import {
	buildCommands,
	commandGroups,
	filterCommands,
	type CommandGroup,
	type PaletteCommand,
} from "./commands.js";
import type { FleetStream } from "./derive-fleet.js";
import { workItemHref } from "./work-card.js";
import { cn } from "./lib/utils.js";
import { useOptionalSession } from "./session-context.js";
import { nextThemeMode, useTheme } from "./theme.js";
import { useNow } from "./use-countdown.js";
import { readLastSeenAnchor } from "./use-last-seen.js";

const groupsWithCommands = (
	commands: readonly PaletteCommand[],
): readonly {
	readonly group: CommandGroup;
	readonly commands: readonly PaletteCommand[];
}[] =>
	commandGroups.flatMap((group) => {
		const items = commands.filter((command) => command.group === group);
		return items.length === 0 ? [] : [{ group, commands: items }];
	});

export function Palette({
	onOpenChange,
	onSelectStream,
	open,
	streams,
}: {
	readonly onOpenChange: (open: boolean) => void;
	readonly onSelectStream: (key: string) => void;
	readonly open: boolean;
	readonly streams: readonly FleetStream[];
}) {
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const session = useOptionalSession();
	const queue = useOptionalActionQueue();
	const theme = useTheme();
	const nowMs = useNow();
	const projection = session?.state.projection;
	const anchorMs = readLastSeenAnchor(projection?.sessionId);
	const commands = useMemo(
		() =>
			filterCommands(
				buildCommands({ anchorMs, nowMs, projection, streams }),
				query,
			),
		[anchorMs, nowMs, projection, query, streams],
	);
	const grouped = groupsWithCommands(commands);
	const selectedCommand = commands[selected];
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				onOpenChange(true);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onOpenChange]);
	useEffect(() => {
		if (!open) return;
		setQuery("");
		setSelected(0);
		window.setTimeout(() => inputRef.current?.focus(), 0);
	}, [open]);
	useEffect(() => {
		setSelected((current) =>
			Math.min(current, Math.max(0, commands.length - 1)),
		);
	}, [commands.length]);
	const close = () => onOpenChange(false);
	const run = (command: PaletteCommand | undefined) => {
		if (command === undefined) return;
		switch (command.kind) {
			case "open-stream":
				onSelectStream(command.streamKey);
				break;
			case "inspect-work":
				window.location.hash = workItemHref(command.workKey);
				break;
			case "run-action":
				queue?.actions.enqueue(command.input);
				break;
			case "jump-time":
				if (session === undefined) break;
				if (command.targetMs === undefined) {
					session.actions.endScrub();
				} else {
					session.actions.scrubTo({
						playheadMs: command.targetMs,
						projection:
							session.state.liveProjection ?? session.state.projection,
					});
				}
				break;
			case "toggle-theme":
				theme.actions.setMode(nextThemeMode(theme.state.mode));
				break;
		}
		close();
	};
	if (!open) return null;
	let index = 0;
	return (
		<div className="fixed inset-0 z-50 bg-background/80 p-4">
			<div
				className="mx-auto mt-24 max-w-lg overflow-hidden rounded-lg border bg-background shadow-lg"
				onKeyDown={(event) => {
					if (event.key === "Tab") {
						event.preventDefault();
						inputRef.current?.focus();
					}
				}}
			>
				<input
					ref={inputRef}
					className="w-full border-b bg-background px-4 py-3 text-sm outline-none"
					placeholder="Search commands"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => {
						switch (event.key) {
							case "ArrowDown":
								event.preventDefault();
								setSelected((current) =>
									commands.length === 0 ? 0 : (current + 1) % commands.length,
								);
								break;
							case "ArrowUp":
								event.preventDefault();
								setSelected((current) =>
									commands.length === 0
										? 0
										: (current - 1 + commands.length) % commands.length,
								);
								break;
							case "Enter":
								event.preventDefault();
								run(selectedCommand);
								break;
							case "Escape":
								event.preventDefault();
								close();
								break;
						}
					}}
				/>
				<div className="max-h-80 overflow-y-auto py-2">
					{grouped.length === 0 ? (
						<p className="px-4 py-6 text-sm text-muted-foreground">
							No commands.
						</p>
					) : (
						grouped.map(({ group, commands: groupCommands }) => (
							<div key={group} className="py-1">
								<div className="px-4 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
									{group}
								</div>
								{groupCommands.map((command) => {
									const commandIndex = index++;
									return (
										<button
											key={command.id}
											type="button"
											className={cn(
												"w-full px-4 py-2 text-left text-sm",
												commandIndex === selected && "bg-sidebar-accent",
											)}
											onMouseEnter={() => setSelected(commandIndex)}
											onClick={() => run(command)}
										>
											{command.label}
										</button>
									);
								})}
							</div>
						))
					)}
				</div>
				<div className="border-t px-4 py-2 text-xs text-muted-foreground">
					↑↓ navigate · ↵ run · esc close
				</div>
			</div>
		</div>
	);
}
