import { Component, useRef, useCallback, type ReactNode } from "react";
import { Crepe } from "@milkdown/crepe";
import { MilkdownProvider, Milkdown, useEditor } from "@milkdown/react";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic-dark.css";

interface MarkdownEditorProps {
	value: string;
	onChange: (markdown: string) => void;
}

function MilkdownEditor({ value, onChange }: MarkdownEditorProps) {
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const debouncedOnChange = useCallback(
		(md: string) => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
			debounceRef.current = setTimeout(() => onChange(md), 300);
		},
		[onChange],
	);

	useEditor(
		(root) =>
			new Crepe({
				root,
				defaultValue: value,
			}).on((listener) =>
				listener.markdownUpdated((_ctx, md, prev) => {
					if (md !== prev) debouncedOnChange(md);
				}),
			),
		[],
	);

	return <Milkdown />;
}

interface ErrorBoundaryProps {
	children: ReactNode;
	fallback?: ReactNode;
}

interface ErrorBoundaryState {
	error: Error | null;
}

class EditorErrorBoundary extends Component<
	ErrorBoundaryProps,
	ErrorBoundaryState
> {
	state: ErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { error };
	}

	render() {
		if (this.state.error) {
			return (
				this.props.fallback ?? (
					<div style={{ padding: 16, color: "#f87171" }}>
						Editor failed to load: {this.state.error.message}
					</div>
				)
			);
		}
		return this.props.children;
	}
}

export function MarkdownEditor(props: MarkdownEditorProps) {
	return (
		<EditorErrorBoundary>
			<MilkdownProvider>
				<MilkdownEditor {...props} />
			</MilkdownProvider>
		</EditorErrorBoundary>
	);
}
