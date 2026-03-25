import { cn } from "@plot/ui/lib/utils";

const styles: Record<string, string> = {
	connected: "bg-success",
	connecting: "bg-warning animate-pulse",
	disconnected: "bg-destructive",
};

interface StatusDotProps {
	status: string;
	className?: string;
}

export function StatusDot({ status, className }: StatusDotProps) {
	return (
		<span className={cn("size-1.5 rounded-full", styles[status], className)} aria-label={status} />
	);
}
