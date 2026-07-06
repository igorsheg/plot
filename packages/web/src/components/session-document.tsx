import { useStore } from "@nanostores/react";
import type { CSSProperties } from "react";
import { $selectedRun } from "../app/store.js";
import {
	SessionHeader,
	StoreSessionHeaderProvider,
} from "./session-header/session-header.js";
import {
	SessionWork,
	StoreSessionWorkProvider,
} from "./session-work/session-work.js";
import { VStack } from "./ui/stack.js";
import { Text } from "./ui/text.js";

const mainStyle: CSSProperties = {
	flex: "1 1 0%",
	minWidth: 0,
	padding:
		"var(--plot-page-top) var(--plot-space-8) var(--plot-page-bottom) calc(var(--plot-rhythm) * 20)",
};

const documentStyle: CSSProperties = {
	margin: "0 auto",
	maxWidth: "calc(var(--plot-rhythm) * 208)",
	width: "100%",
};

const emptyDocumentStyle: CSSProperties = {
	...documentStyle,
	minHeight: "calc(var(--plot-rhythm) * 128)",
};

function EmptySelection() {
	return (
		<VStack as="main" style={mainStyle}>
			<VStack as="article" style={emptyDocumentStyle} gap={12} center>
				<Text variant="heading1" as="h1">
					No active sessions.
				</Text>
				<Text variant="secondary">
					The dock only shows live sessions. Start one and it will appear here.
				</Text>
			</VStack>
		</VStack>
	);
}

function SessionDocument() {
	return (
		<VStack as="main" style={mainStyle}>
			<VStack as="article" style={documentStyle} gap={48}>
				<StoreSessionHeaderProvider>
					<SessionHeader />
				</StoreSessionHeaderProvider>
				<StoreSessionWorkProvider>
					<SessionWork />
				</StoreSessionWorkProvider>
			</VStack>
		</VStack>
	);
}

export function SessionMain() {
	const selectedRun = useStore($selectedRun);
	return selectedRun === undefined ? <EmptySelection /> : <SessionDocument />;
}
