import { useStore } from "@nanostores/react";
import { $selectedRun } from "../app/runs-store.js";
import {
	sessionDocumentClass,
	sessionMainClass,
} from "./session-document.styles.js";
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

function EmptySelection() {
	return (
		<VStack as="main" className={sessionMainClass()}>
			<VStack
				as="article"
				className={sessionDocumentClass({ state: "empty" })}
				gap={12}
				center
			>
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
		<VStack as="main" className={sessionMainClass()}>
			<VStack as="article" className={sessionDocumentClass()} gap={48}>
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
