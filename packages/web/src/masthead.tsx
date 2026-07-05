import { useRef, useState } from "react";
import { Button } from "./components/ui/button.js";
import type { FleetStream } from "./derive-fleet.js";
import { formatAgo, formatTokens } from "./format.js";
import { isRunLive } from "./board.js";
import type { PlotRun } from "./run.js";
import { useCountdown } from "./use-countdown.js";
import type { WebDashboardProjection } from "./api.js";

const soonestWake = (
	projection: WebDashboardProjection | undefined,
): number | undefined =>
	projection?.scheduledWakes
		.map((wake) => wake.dueAtMs)
		.toSorted((left, right) => left - right)[0];

const streamVerb = (stream: FleetStream | undefined): string | undefined =>
	stream?.state === "ended" ? "ended" : stream?.verb;

function HoldToStop({ onStop }: { readonly onStop: () => void }) {
	const [holding, setHolding] = useState(false);
	const timerRef = useRef<number | undefined>(undefined);
	const cancel = () => {
		window.clearTimeout(timerRef.current);
		timerRef.current = undefined;
		setHolding(false);
	};
	const start = () => {
		cancel();
		setHolding(true);
		timerRef.current = window.setTimeout(() => {
			setHolding(false);
			timerRef.current = undefined;
			onStop();
		}, 600);
	};
	return (
		<Button
			type="button"
			variant="ghost"
			className="masthead-hold overflow-hidden"
			data-holding={holding ? "true" : "false"}
			onPointerDown={start}
			onPointerCancel={cancel}
			onPointerLeave={cancel}
			onPointerUp={cancel}
		>
			<span className="relative z-10">Hold to stop</span>
		</Button>
	);
}

export function Masthead({
	onStop,
	projection,
	run,
	stream,
}: {
	readonly onStop: () => void;
	readonly projection: WebDashboardProjection | undefined;
	readonly run: PlotRun;
	readonly stream: FleetStream | undefined;
}) {
	const runtime = projection?.runtime;
	const name =
		projection?.workflowName ?? run.workflowName ?? stream?.name ?? run.id;
	const cwdName = runtime?.cwdName ?? run.cwdName ?? stream?.cwdName;
	const tickIntervalMs = runtime?.tickIntervalMs;
	const countdown = useCountdown(soonestWake(projection));
	const tokens = formatTokens(projection?.usageTotals.tokens ?? 0);
	const cost = `$${(projection?.usageTotals.cost ?? 0).toFixed(2)}`;
	const endedAt = Date.parse(run.lastSeenAt ?? run.createdAt);
	const meter = isRunLive(run)
		? `${tokens} tok · ${cost}${
				countdown === undefined
					? ""
					: ` · ${countdown.due ? "scan due" : `next scan in ${countdown.text}`}`
			}`
		: `ended ${formatAgo(Number.isFinite(endedAt) ? endedAt : Date.now())} ago · ${tokens} tok · ${cost}`;
	const facts = [
		streamVerb(stream),
		cwdName === name ? undefined : cwdName,
		tickIntervalMs === undefined
			? undefined
			: `every ${Math.round(tickIntervalMs / 1000)}s`,
		runtime?.model,
	].filter((fact) => fact !== undefined && fact !== "");
	return (
		<header className="flex items-center gap-4 border-b px-6 py-4">
			<div className="min-w-0 flex-1 space-y-1">
				<p className="truncate text-sm text-muted-foreground">
					<span className="font-semibold text-foreground">{name}</span>
					{facts.length > 0 && (
						<>
							<span> · </span>
							<span className="text-foreground">{facts[0]}</span>
							{facts.slice(1).map((fact) => (
								<span key={fact}> · {fact}</span>
							))}
						</>
					)}
				</p>
				<p className="min-w-48 truncate font-mono text-xs tabular-nums text-muted-foreground">
					{meter}
				</p>
			</div>
			{isRunLive(run) && <HoldToStop onStop={onStop} />}
		</header>
	);
}
