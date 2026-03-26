import {
	createContext,
	use,
	useState,
	useEffect,
	useCallback,
	type ReactNode,
} from "react";
import { electroview } from "../index";

const rpc = () => electroview.rpc!;

type WindowChromeContext = {
	focused: boolean;
	close: () => void;
	minimize: () => void;
	zoom: () => void;
};

const ChromeContext = createContext<WindowChromeContext | null>(null);

function useChrome() {
	const ctx = use(ChromeContext);
	if (!ctx)
		throw new Error("WindowChrome.* must be used inside WindowChrome.Root");
	return ctx;
}

function Root({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	const [focused, setFocused] = useState(true);

	useEffect(() => {
		const onFocus = () => setFocused(true);
		const onBlur = () => setFocused(false);
		window.addEventListener("focus", onFocus);
		window.addEventListener("blur", onBlur);
		return () => {
			window.removeEventListener("focus", onFocus);
			window.removeEventListener("blur", onBlur);
		};
	}, []);

	const close = useCallback(() => {
		rpc().request.windowClose({});
	}, []);

	const minimize = useCallback(() => {
		rpc().request.windowMinimize({});
	}, []);

	const zoom = useCallback(() => {
		rpc().request.windowZoom({});
	}, []);

	return (
		<ChromeContext value={{ focused, close, minimize, zoom }}>
			<div className={className}>{children}</div>
		</ChromeContext>
	);
}

function Titlebar({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={`electrobun-webkit-app-region-drag flex shrink-0 items-center ${className ?? ""}`}
		>
			{children}
		</div>
	);
}

function Title({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<span
			className={`electrobun-webkit-app-region-no-drag text-label font-medium text-foreground/80 ${className ?? ""}`}
		>
			{children}
		</span>
	);
}

function TrafficLight({
	color,
	activeColor,
	focused,
	hovered,
	onClick,
	label,
	children,
}: {
	color: string;
	activeColor: string;
	focused: boolean;
	hovered: boolean;
	onClick: () => void;
	label: string;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			className="relative box-border size-3 rounded-full border border-black/[0.06] outline-none"
			style={{ backgroundColor: focused || hovered ? color : "#ddd" }}
			onClick={onClick}
			onMouseDown={(e) => {
				const btn = e.currentTarget;
				btn.style.backgroundColor = activeColor;
			}}
			onMouseUp={(e) => {
				const btn = e.currentTarget;
				btn.style.backgroundColor = color;
			}}
			aria-label={label}
		>
			<span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 group-hover/chrome:opacity-100">
				{children}
			</span>
		</button>
	);
}

function Controls({ className }: { className?: string }) {
	const { focused, close, minimize, zoom } = useChrome();
	const [hovered, setHovered] = useState(false);

	return (
		<div
			className={`electrobun-webkit-app-region-no-drag group/chrome flex items-center gap-[7px] ${className ?? ""}`}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			<TrafficLight
				color="#ff6159"
				activeColor="#bf4942"
				focused={focused}
				hovered={hovered}
				onClick={close}
				label="Close"
			>
				<svg className="size-[6px]" viewBox="0 0 8 8" fill="none" stroke="#4d0000" strokeWidth="1.2" strokeLinecap="round">
					<line x1="1" y1="1" x2="7" y2="7" />
					<line x1="7" y1="1" x2="1" y2="7" />
				</svg>
			</TrafficLight>
			<TrafficLight
				color="#ffbd2e"
				activeColor="#bf8e22"
				focused={focused}
				hovered={hovered}
				onClick={minimize}
				label="Minimize"
			>
				<svg className="size-[6px]" viewBox="0 0 8 8" fill="none" stroke="#995700" strokeWidth="1.2" strokeLinecap="round">
					<line x1="0" y1="4" x2="8" y2="4" />
				</svg>
			</TrafficLight>
			<TrafficLight
				color="#28c941"
				activeColor="#1d9730"
				focused={focused}
				hovered={hovered}
				onClick={zoom}
				label="Zoom"
			>
				<svg className="size-[6px]" viewBox="0 0 8 8" fill="none" stroke="#006500" strokeWidth="1.2" strokeLinecap="round">
					<polyline points="1,3.5 1,1 3.5,1" />
					<polyline points="7,4.5 7,7 4.5,7" />
				</svg>
			</TrafficLight>
		</div>
	);
}

function Content({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={`flex-1 overflow-auto ${className ?? ""}`}>{children}</div>
	);
}

const WindowChrome = {
	Root,
	Titlebar,
	Controls,
	Title,
	Content,
};

export { WindowChrome };
