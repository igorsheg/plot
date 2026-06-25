import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PlotApp } from "./app.js";
// oxlint-disable-next-line import/no-unassigned-import
import "./style.css";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<PlotApp />
	</StrictMode>,
);
