/**
 * Preload for the sidebar WebContentsView.
 * Exposes a safe API via contextBridge for the sidebar HTML.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("webctxSidebar", {
	clearAll: () => ipcRenderer.invoke("sidebar:clear-all"),
	removeItem: (itemId: string) => ipcRenderer.invoke("sidebar:remove-item", itemId),
	takeScreenshot: () => ipcRenderer.invoke("sidebar:take-screenshot"),
	highlightElement: (selector: string) => ipcRenderer.invoke("sidebar:highlight-element", selector),
	clearHighlight: () => ipcRenderer.invoke("sidebar:clear-highlight"),
	copyToShell: () => ipcRenderer.invoke("sidebar:copy-to-shell"),
	resizeStart: () => ipcRenderer.invoke("sidebar:resize-start"),
	resizeEnd: () => ipcRenderer.invoke("sidebar:resize-end"),
	onContextUpdated: (callback: (data: unknown) => void) => {
		ipcRenderer.on("sidebar:context-updated", (_event: unknown, data: unknown) => callback(data));
	},
});
