import { useStore } from "@nanostores/react";
import { useEffect } from "react";
import { toastManager } from "../components/ui/toast.js";
import { $plotError } from "./error-store.js";

export function PlotErrorToaster() {
	const error = useStore($plotError);

	useEffect(() => {
		if (error === undefined) return;
		toastManager.add({
			description: error,
			id: "plot-error",
			title: "Plot error",
			type: "error",
		});
	}, [error]);

	return null;
}
