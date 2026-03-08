import { useRuntimeSnapshot } from "@/lib/runtime";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Meter, MeterIndicator, MeterLabel, MeterTrack } from "@/components/ui/meter";
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
  const tone = ratio >= 0.85 ? "bg-destructive" : ratio >= 0.6 ? "bg-warning" : "bg-success";

  return (
    <Meter value={value} max={max} className="gap-1">
      <div className="flex items-center justify-between type-meta">
        <MeterLabel>depth vs peak</MeterLabel>
        <span className="type-body">
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
    return <p className="type-meta">{zeroLabel}</p>;
  }

  return (
    <div className="space-y-2">
      {entries.map(([label, value]) => {
        const percent = total === 0 ? 0 : Math.round((value / total) * 100);
        return (
          <div key={label} className="space-y-1">
            <div className="flex items-center justify-between gap-3 type-body">
              <span className="type-meta">{titleCase(label)}</span>
              <span className="type-body">
                {value} <span className="type-meta">({percent}%)</span>
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
      <div className="type-meta uppercase">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="type-title">{value}</span>
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
  const snapshot = useRuntimeSnapshot();
  if (!snapshot) return null;
  const { counts, observability } = snapshot;

  return (
    <section className="space-y-3">
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="type-title">queue</CardTitle>
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
            {(observability.commandQueueDepth > 0 || observability.commandQueuePeak > 0) && (
              <QueuePressureMeter
                depth={observability.commandQueueDepth}
                peak={observability.commandQueuePeak}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="type-title">retries</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat label="queued" value={counts.retrying} />
              <Stat label="stale drops" value={observability.staleRetryDropCount} tone="warning" />
            </div>
            <ReasonList
              reasons={observability.retriesScheduledByReason}
              zeroLabel="no retries scheduled yet"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="type-title">workers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between type-body">
                  <span className="type-meta">stops</span>
                  <span className="type-body">
                    {sum(observability.workerStopsByReason)}
                  </span>
                </div>
                <ReasonList
                  reasons={observability.workerStopsByReason}
                  zeroLabel="no worker stops recorded"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between type-body">
                  <span className="type-meta">exits</span>
                  <span className="type-body">
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
