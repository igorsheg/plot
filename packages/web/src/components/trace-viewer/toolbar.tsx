import { useCallback, type ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useTraceViewer } from "./root";

export function Toolbar() {
	const { state, actions, meta } = useTraceViewer();

	const handleQueryChange = useCallback(
		(e: ChangeEvent<HTMLInputElement>) => actions.setQuery(e.target.value),
		[actions],
	);

	return (
		<div className="flex items-center gap-2 border-b border-border px-3 py-2">
			<Input
				placeholder="search…"
				value={state.query}
				onChange={handleQueryChange}
				className="h-7 flex-1 text-xs"
				nativeInput
			/>
			<button
				type="button"
				className="type-meta hover:text-foreground"
				onClick={actions.toggleViewMode}
				aria-label={`switch to ${state.viewMode === "grouped" ? "raw" : "grouped"} view`}
			>
				{state.viewMode === "grouped" ? "raw" : "grouped"}
			</button>
			<span className="type-meta flex shrink-0 items-center gap-2">
				{meta.isLoading ? (
					<span className="relative flex size-2">
						<span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/40" />
						<span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
					</span>
				) : (
					<span
						className={cn(
							"inline-flex size-2 rounded-full",
							meta.total > 0 ? "bg-emerald-400" : "bg-zinc-400",
						)}
					/>
				)}
				{meta.total}
			</span>
		</div>
	);
}
