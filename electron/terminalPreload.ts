/**
 * Preload for the terminal WebContentsView.
 * Exposes a safe IPC API via contextBridge for the terminal HTML.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("webctxTerminal", {
	input: (data: string) => ipcRenderer.invoke("terminal:input", data),
	resize: (cols: number, rows: number) => ipcRenderer.invoke("terminal:resize", cols, rows),
	ready: (cols: number, rows: number) => ipcRenderer.invoke("terminal:ready", cols, rows),
	resizeStart: () => ipcRenderer.invoke("terminal:resize-start"),
	resizeEnd: () => ipcRenderer.invoke("terminal:resize-end"),
	onData: (callback: (data: string) => void) => {
		ipcRenderer.on("terminal:data", (_event: unknown, data: string) => callback(data));
	},
});
