import "./app.css";
import { createRoot } from "react-dom/client";
import { Electroview } from "electrobun/view";
import type { DesktopRPC } from "../../shared/rpc";
import { App } from "./app";

const rpc = Electroview.defineRPC<DesktopRPC>({
	handlers: {
		requests: {},
		messages: {
			projectUpdated(info) {
				window.dispatchEvent(
					new CustomEvent("plot:project-updated", { detail: info }),
				);
			},
			authStateChanged(state) {
				window.dispatchEvent(
					new CustomEvent("plot:auth-state", { detail: state }),
				);
			},
			snapshotUpdate(data) {
				window.dispatchEvent(
					new CustomEvent("plot:snapshot", { detail: data }),
				);
			},
		},
	},
});

const electroview = new Electroview({ rpc });

export { electroview };

const params = new URLSearchParams(window.location.search);
const projectId = params.get("projectId") ?? "";

createRoot(document.getElementById("root")!).render(
	<App projectId={projectId} />,
);
