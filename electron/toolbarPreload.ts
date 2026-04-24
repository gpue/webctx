/**
 * Preload for the toolbar window.
 * Exposes a safe API via contextBridge for the toolbar HTML.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("webctxToolbar", {
	navigate: (url: string) => ipcRenderer.invoke("navigate", url),
	goBack: () => ipcRenderer.invoke("go-back"),
	goForward: () => ipcRenderer.invoke("go-forward"),
	reload: () => ipcRenderer.invoke("reload"),
	togglePicker: () => ipcRenderer.invoke("toggle-picker"),
	clearSelection: () => ipcRenderer.invoke("clear-selection"),
	screenshot: (options: Record<string, unknown>) => ipcRenderer.invoke("screenshot", options),
	getContext: () => ipcRenderer.invoke("get-context"),
	onUrlChanged: (callback: (url: string) => void) => {
		ipcRenderer.on("url-changed", (_event: unknown, url: string) => callback(url));
	},
	onSelectionUpdated: (callback: (ctx: unknown) => void) => {
		ipcRenderer.on("selection-updated", (_event: unknown, ctx: unknown) => callback(ctx));
	},
});
