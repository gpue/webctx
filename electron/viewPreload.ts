/**
 * Preload for the BrowserView (target page).
 * Exposes a minimal IPC bridge for the picker script.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("__webctx", {
	elementSelected: (ctx: unknown) => ipcRenderer.invoke("picker:element-selected", ctx),
	elementDeselected: (cssSelector: string) =>
		ipcRenderer.invoke("picker:element-deselected", cssSelector),
});
