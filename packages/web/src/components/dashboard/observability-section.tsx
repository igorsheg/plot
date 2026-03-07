import { useDashboard } from "./root";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Meter,
	MeterIndicator,
	MeterLabel,
	MeterTrack,
} from "@/components/ui/meter";
import { cn } from "@/lib/utils";

function sum(values: Record<string, number>): number {
	return Object.values(values).reduce((total, value) => total + value, 0);
}

function titleCase(label: string): string {
	return label.charAt(0).toUpperCase() + label.slice(1);
}

function QueuePressureMeter({ depth, peak }: { depth: number; peak: number }) {
	const max = Math.max(peak, depth, 1);
	const value = Math.min(depth, max);
	const ratio = value / max;
	const tone =
		ratio >= 0.85
			? "bg-destructive"
			: ratio >= 0.6
				? "bg-warning"
				: "bg-success";

	return (
		<Meter value={value} max={max} className="gap-1">
			<div className="flex items-center justify-between text-xs text-muted-foreground">
				<MeterLabel>depth vs peak</MeterLabel>
				<span className="font-mono text-foreground">
					{depth} / {peak}
				</span>
			</div>
			<MeterTrack className="h-1.5 rounded-full">
				<MeterIndicator className={cn("rounded-full transition-all", tone)} />
			</MeterTrack>
		</Meter>
	);
}

function ReasonList({
	reasons,
	zeroLabel,
}: {
	reasons: Record<string, number>;
	zeroLabel: string;
}) {
	const entries = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
	const total = sum(reasons);

	if (total === 0) {
		return <p className="text-xs text-muted-foreground">{zeroLabel}</p>;
	}

	return (
		<div className="space-y-2">
			{entries.map(([label, value]) => {
				const percent = total === 0 ? 0 : Math.round((value / total) * 100);
				return (
					<div key={label} className="space-y-1">
						<div className="flex items-center justify-between gap-3 text-xs">
							<span className="text-muted-foreground">{titleCase(label)}</span>
							<span className="font-mono text-foreground">
								{value}{" "}
								<span className="text-muted-foreground">({percent}%)</span>
							</span>
						</div>
						<Meter value={percent} max={100} className="gap-0">
							<MeterTrack className="h-1.5 rounded-full">
								<MeterIndicator className="rounded-full bg-foreground/60 transition-all" />
							</MeterTrack>
						</Meter>
					</div>
				);
			})}
		</div>
	);
}

function Stat({
	label,
	value,
	tone = "default",
}: {
	label: string;
	value: number;
	tone?: "default" | "warning";
}) {
	return (
		<div className="rounded-xl border border-border bg-background/60 px-3 py-2">
			<div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
				{label}
			</div>
			<div className="mt-1 flex items-center gap-2">
				<span className="font-mono text-lg text-foreground">{value}</span>
				{tone === "warning" && value > 0 ? (
					<Badge variant="warning" size="sm">
						hot
					</Badge>
				) : null}
			</div>
		</div>
	);
}

export function ObservabilitySection() {
	const { state } = useDashboard();
	const { counts, observability } = state.snapshot;

	return (
		<section className="space-y-3">
			<div className="flex items-center justify-between gap-3">
				<div>
					<h2 className="text-xs font-medium text-muted-foreground">Runtime</h2>
					<p className="text-xs text-muted-foreground">
						operator-facing queue, retry, and worker counters
					</p>
				</div>
				<Badge variant="outline" size="sm">
					{counts.running} running · {counts.retrying} queued retries
				</Badge>
			</div>

			<div className="grid gap-4 lg:grid-cols-3">
				<Card>
					<CardHeader>
						<CardTitle className="text-sm">queue</CardTitle>
						<CardDescription>
							current depth, peak depth, and pressure events
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-3 sm:grid-cols-3">
							<Stat label="depth" value={observability.commandQueueDepth} />
							<Stat label="peak" value={observability.commandQueuePeak} />
							<Stat
								label="pressure"
								value={observability.commandQueuePressureCount}
								tone="warning"
							/>
						</div>
						<QueuePressureMeter
							depth={observability.commandQueueDepth}
							peak={observability.commandQueuePeak}
						/>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-sm">retries</CardTitle>
						<CardDescription>
							scheduled retry mix and stale drops
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-3 sm:grid-cols-2">
							<Stat label="queued" value={counts.retrying} />
							<Stat
								label="stale drops"
								value={observability.staleRetryDropCount}
								tone="warning"
							/>
						</div>
						<ReasonList
							reasons={observability.retriesScheduledByReason}
							zeroLabel="no retries scheduled yet"
						/>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-sm">workers</CardTitle>
						<CardDescription>
							stop policy outcomes and final exit reasons
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-3">
							<div className="space-y-2">
								<div className="flex items-center justify-between text-xs">
									<span className="text-muted-foreground">stops</span>
									<span className="font-mono text-foreground">
										{sum(observability.workerStopsByReason)}
									</span>
								</div>
								<ReasonList
									reasons={observability.workerStopsByReason}
									zeroLabel="no worker stops recorded"
								/>
							</div>
							<div className="space-y-2">
								<div className="flex items-center justify-between text-xs">
									<span className="text-muted-foreground">exits</span>
									<span className="font-mono text-foreground">
										{sum(observability.workerExitsByReason)}
									</span>
								</div>
								<ReasonList
									reasons={observability.workerExitsByReason}
									zeroLabel="no worker exits recorded"
								/>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		</section>
	);
}
