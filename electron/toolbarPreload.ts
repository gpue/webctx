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
	saveFavorites: (favs: unknown[]) => ipcRenderer.invoke("save-favorites", favs),
	loadFavorites: () => ipcRenderer.invoke("load-favorites"),
	setFavBarHeight: (height: number) => ipcRenderer.invoke("set-favbar-height", height),
	openDevTools: () => ipcRenderer.invoke("open-devtools"),
	toggleTerminal: () => ipcRenderer.invoke("toggle-terminal"),
	onUrlChanged: (callback: (url: string, title: string) => void) => {
		ipcRenderer.on("url-changed", (_event: unknown, url: string, title: string) =>
			callback(url, title),
		);
	},
	onDevToolsToggled: (callback: (active: boolean) => void) => {
		ipcRenderer.on("devtools-toggled", (_event: unknown, active: boolean) => callback(active));
	},
	onTerminalToggled: (callback: (active: boolean) => void) => {
		ipcRenderer.on("terminal-toggled", (_event: unknown, active: boolean) => callback(active));
	},
});
