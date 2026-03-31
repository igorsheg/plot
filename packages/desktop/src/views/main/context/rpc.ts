import { Electroview } from "electrobun/view";
import type { DesktopRPC } from "../../../shared/rpc";

type DesktopElectroview = InstanceType<typeof Electroview<ReturnType<typeof Electroview.defineRPC<DesktopRPC>>>>;
let electroviewInstance: DesktopElectroview | null = null;

export function initRpc() {
	if (electroviewInstance) return;
	const schema = Electroview.defineRPC<DesktopRPC>({
		handlers: {
			requests: {},
			messages: {
				projectUpdated(info) {
					window.dispatchEvent(new CustomEvent("plot:project-updated", { detail: info }));
				},
				authStateChanged(state) {
					window.dispatchEvent(new CustomEvent("plot:auth-state", { detail: state }));
				},
				folderPicked(data) {
					window.dispatchEvent(new CustomEvent("plot:folder-picked", { detail: data }));
				},
			},
		},
	});
	electroviewInstance = new Electroview({ rpc: schema });
}

export function rpc() {
	if (!electroviewInstance) throw new Error("RPC not initialized");
	return electroviewInstance.rpc!;
}
