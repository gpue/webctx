/**
 * Electron main process — launches the browser window with element picker.
 *
 * Architecture:
 * - BaseWindow hosts WebContentsView children: toolbar, target page, sidebar
 * - Picker script is injected into the target WebContentsView for element selection
 * - IPC channels connect toolbar <-> main <-> picker <-> sidebar
 */

import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	app,
	BaseWindow,
	type IpcMainInvokeEvent,
	ipcMain,
	screen,
	WebContentsView,
} from "electron";
import * as pty from "node-pty";
import { StateManager } from "../src/core/state.js";
import type {
	ConsoleEntry,
	ElementContext,
	NetworkEntry,
	ScreenshotOptions,
	ScreenshotResult,
} from "../src/core/types.js";

// Support both CJS (__dirname) and ESM (import.meta)
const currentDir =
	typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// ── State ──────────────────────────────────────────────────────────────────

const state = new StateManager();
let mainWindow: BaseWindow | null = null;
let toolbarView: WebContentsView | null = null;
let targetView: WebContentsView | null = null;
let sidebarView: WebContentsView | null = null;
let devtoolsView: WebContentsView | null = null;
let pickerActive = false;
let sidebarOpen = false;
let devtoolsOpen = false;
let closingDevtools = false; // guard against re-entry

// Right terminal panel (rightmost)
let terminalView: WebContentsView | null = null;
let terminalOpen = false;
let terminalWidth = 400;
let ptyProcess: pty.IPty | null = null;

const TOOLBAR_HEIGHT = 52;
const FAV_BAR_HEIGHT = 28;
const DEVTOOLS_HEIGHT_RATIO = 0.4;
let sidebarWidth = 320;
let favBarHeight = FAV_BAR_HEIGHT;

// Context items stored in chronological order (unified list)
interface ContextItemElement {
	type: "element";
	id: string;
	timestamp: number;
	data: ElementContext;
}
interface ContextItemScreenshot {
	type: "screenshot";
	id: string;
	timestamp: number;
	data: { dataBase64: string; width: number; height: number };
}
type ContextItem = ContextItemElement | ContextItemScreenshot;
const contextItems: ContextItem[] = [];
let nextItemId = 1;

// ── Console & Network capture ──────────────────────────────────────────────

const MAX_CONSOLE_ENTRIES = 1000;
const MAX_NETWORK_ENTRIES = 1000;
const consoleLogs: ConsoleEntry[] = [];
const networkLog: NetworkEntry[] = [];

// Map of in-flight network requests for duration tracking
const pendingRequests = new Map<string, { method: string; url: string; startTime: number }>();

const CONSOLE_LEVEL_MAP: Record<number, string> = {
	0: "log",
	1: "warn",
	2: "error",
	3: "debug",
	[-1]: "info",
};

function setupConsoleCapture(wc: Electron.WebContents): void {
	wc.on("console-message", (_event, level, message, line, sourceId) => {
		consoleLogs.push({
			level: CONSOLE_LEVEL_MAP[level] ?? String(level),
			message,
			source: sourceId,
			line,
			timestamp: Date.now(),
		});
		if (consoleLogs.length > MAX_CONSOLE_ENTRIES) {
			consoleLogs.splice(0, consoleLogs.length - MAX_CONSOLE_ENTRIES);
		}
	});
}

function setupNetworkCapture(wc: Electron.WebContents): void {
	wc.debugger.attach("1.3");
	wc.debugger.sendCommand("Network.enable");
	wc.debugger.on("message", (_event, method, params) => {
		handleDebuggerMessage(method, params);
	});
}

function handleRequestWillBeSent(params: Record<string, unknown>): void {
	const req = params.request as { url: string; method: string } | undefined;
	const id = params.requestId as string;
	if (req && id) {
		pendingRequests.set(id, {
			method: req.method,
			url: req.url,
			startTime: Date.now(),
		});
	}
}

function handleResponseReceived(params: Record<string, unknown>): void {
	const id = params.requestId as string;
	const resp = params.response as
		| { url: string; status: number; mimeType: string; headers: Record<string, string> }
		| undefined;
	const pending = pendingRequests.get(id);
	if (resp) {
		pushNetworkEntry({
			url: resp.url,
			method: pending?.method ?? "GET",
			status: resp.status,
			mimeType: resp.mimeType ?? "",
			size: -1,
			duration: pending ? Date.now() - pending.startTime : -1,
			timestamp: Date.now(),
		});
	}
	pendingRequests.delete(id);
}

function handleLoadingFailed(params: Record<string, unknown>): void {
	const id = params.requestId as string;
	const pending = pendingRequests.get(id);
	if (pending) {
		pushNetworkEntry({
			url: pending.url,
			method: pending.method,
			status: 0,
			mimeType: "",
			size: -1,
			duration: Date.now() - pending.startTime,
			timestamp: Date.now(),
			error: (params.errorText as string) ?? "Unknown error",
		});
	}
	pendingRequests.delete(id);
}

function handleDebuggerMessage(method: string, params: Record<string, unknown>): void {
	if (method === "Network.requestWillBeSent") {
		handleRequestWillBeSent(params);
	} else if (method === "Network.responseReceived") {
		handleResponseReceived(params);
	} else if (method === "Network.loadingFailed") {
		handleLoadingFailed(params);
	}
}

function pushNetworkEntry(entry: NetworkEntry): void {
	networkLog.push(entry);
	if (networkLog.length > MAX_NETWORK_ENTRIES) {
		networkLog.splice(0, networkLog.length - MAX_NETWORK_ENTRIES);
	}
}

export function getConsoleLogs(options?: {
	level?: string;
	limit?: number;
	clear?: boolean;
}): ConsoleEntry[] {
	let entries = [...consoleLogs];
	if (options?.level) {
		entries = entries.filter((e) => e.level === options.level);
	}
	if (options?.limit && options.limit > 0) {
		entries = entries.slice(-options.limit);
	}
	if (options?.clear) {
		consoleLogs.length = 0;
	}
	return entries;
}

export function getNetworkLog(options?: {
	limit?: number;
	filter?: string;
	clear?: boolean;
}): NetworkEntry[] {
	let entries = [...networkLog];
	if (options?.filter) {
		const pattern = options.filter.toLowerCase();
		entries = entries.filter(
			(e) => e.url.toLowerCase().includes(pattern) || e.mimeType.toLowerCase().includes(pattern),
		);
	}
	if (options?.limit && options.limit > 0) {
		entries = entries.slice(-options.limit);
	}
	if (options?.clear) {
		networkLog.length = 0;
		pendingRequests.clear();
	}
	return entries;
}

// ── App lifecycle ──────────────────────────────────────────────────────────

export function getState(): StateManager {
	return state;
}

export function getMainWindow(): BaseWindow | null {
	return mainWindow;
}

export function getTargetView(): WebContentsView | null {
	return targetView;
}

export async function launchApp(url?: string, headless = false): Promise<void> {
	await app.whenReady();

	mainWindow = new BaseWindow({
		width: 1280,
		height: 900,
		show: !headless,
		title: "webctx",
		backgroundColor: "#313244",
	});

	// Create toolbar view
	toolbarView = new WebContentsView({
		webPreferences: {
			preload: path.join(currentDir, "toolbarPreload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	mainWindow.contentView.addChildView(toolbarView);
	toolbarView.webContents.loadFile(path.join(currentDir, "toolbar.html"));

	// Create target page view
	targetView = new WebContentsView({
		webPreferences: {
			preload: path.join(currentDir, "viewPreload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	mainWindow.contentView.addChildView(targetView);

	// Create sidebar view (hidden initially)
	sidebarView = new WebContentsView({
		webPreferences: {
			preload: path.join(currentDir, "sidebarPreload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	mainWindow.contentView.addChildView(sidebarView);
	sidebarView.webContents.loadFile(path.join(currentDir, "sidebar.html"));

	resizeViews();

	mainWindow.on("resize", resizeViews);
	mainWindow.on("closed", () => {
		killPty();
		toolbarView?.webContents.close();
		targetView?.webContents.close();
		sidebarView?.webContents.close();
		terminalView?.webContents.close();
		// Don't close devtoolsView webContents — Electron manages it
		stopContextServer();
		mainWindow = null;
		toolbarView = null;
		targetView = null;
		sidebarView = null;
		devtoolsView = null;
		terminalView = null;
	});

	// Navigate to initial URL if provided
	if (url) {
		await navigateTo(url);
	}

	// Listen for page title/URL changes
	targetView.webContents.on("did-navigate", () => syncPageState());
	targetView.webContents.on("did-navigate-in-page", () => syncPageState());
	targetView.webContents.on("page-title-updated", () => syncPageState());

	// Capture console and network from target page
	setupConsoleCapture(targetView.webContents);
	try {
		setupNetworkCapture(targetView.webContents);
	} catch {
		console.warn("[webctx] Failed to attach debugger for network capture");
	}

	// Track DevTools close (e.g. user closes from within DevTools)
	targetView.webContents.on("devtools-closed", () => {
		cleanupDevtools();
	});

	// Start context HTTP server
	startContextServer();
}

/** Safely tear down devtools panel, guarding against re-entry. */
function cleanupDevtools(): void {
	if (closingDevtools) return;
	closingDevtools = true;
	devtoolsOpen = false;
	if (devtoolsView && mainWindow) {
		mainWindow.contentView.removeChildView(devtoolsView);
		// Don't call webContents.close() — Electron manages devtools webContents lifecycle.
		// Just drop the reference so it can be GC'd.
		devtoolsView = null;
	}
	resizeViews();
	if (toolbarView && !toolbarView.webContents.isDestroyed()) {
		toolbarView.webContents.send("devtools-toggled", false);
	}
	closingDevtools = false;
}

function resizeViews(): void {
	if (!mainWindow || !toolbarView || !targetView || !sidebarView) return;
	const { width, height } = mainWindow.getBounds();
	const totalToolbarHeight = TOOLBAR_HEIGHT + favBarHeight;
	const sidebarW = sidebarOpen ? sidebarWidth : 0;
	const termW = terminalOpen ? terminalWidth : 0;
	const contentWidth = width - sidebarW - termW;
	const contentHeight = height - totalToolbarHeight;
	const devtoolsGap = devtoolsOpen ? 1 : 0;
	const devtoolsH = devtoolsOpen
		? Math.round(contentHeight * DEVTOOLS_HEIGHT_RATIO) - devtoolsGap
		: 0;
	const targetH = contentHeight - devtoolsH - devtoolsGap;

	toolbarView.setBounds({
		x: 0,
		y: 0,
		width,
		height: totalToolbarHeight,
	});
	targetView.setBounds({
		x: 0,
		y: totalToolbarHeight,
		width: contentWidth,
		height: targetH,
	});
	if (devtoolsView) {
		devtoolsView.setBounds({
			x: 0,
			y: totalToolbarHeight + targetH + devtoolsGap,
			width: contentWidth,
			height: devtoolsH,
		});
	}
	sidebarView.setBounds({
		x: contentWidth,
		y: totalToolbarHeight,
		width: sidebarW,
		height: contentHeight,
	});
	if (terminalView) {
		terminalView.setBounds({
			x: contentWidth + sidebarW,
			y: totalToolbarHeight,
			width: termW,
			height: contentHeight,
		});
	}
}

function syncPageState(): void {
	if (!targetView) return;
	const url = targetView.webContents.getURL();
	const title = targetView.webContents.getTitle();
	state.setPage(url, title);

	if (toolbarView && !toolbarView.webContents.isDestroyed()) {
		toolbarView.webContents.send("url-changed", url, title);
	}
}

/** Send current context items to the sidebar. */
function pushSidebarUpdate(): void {
	if (!sidebarView || sidebarView.webContents.isDestroyed()) return;
	sidebarView.webContents.send("sidebar:context-updated", { items: contextItems });
}

// ── Navigation ─────────────────────────────────────────────────────────────

function hasScheme(input: string): boolean {
	return /^(https?|file):\/\//i.test(input);
}

function looksLikeHost(input: string): boolean {
	if (/\s/.test(input)) return false;
	if (/^localhost(:\d+)?(\/.*)?$/i.test(input)) return true;
	if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?(\/.*)?$/.test(input)) return true;
	if (input.includes(".")) return true;
	if (/^[^/]+:\d+/.test(input)) return true;
	return false;
}

function searchUrl(query: string): string {
	return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

async function tryLoad(url: string): Promise<boolean> {
	if (!targetView) return false;
	try {
		await targetView.webContents.loadURL(url);
		return true;
	} catch (err: unknown) {
		if (isAbortedError(err)) return true;
		return false;
	}
}

export async function navigateTo(input: string): Promise<void> {
	if (!targetView) throw new Error("No target view available");

	const trimmed = input.trim();

	if (hasScheme(trimmed)) {
		if (!(await tryLoad(trimmed))) {
			await tryLoad(searchUrl(trimmed));
		}
		syncPageState();
		return;
	}

	if (looksLikeHost(trimmed)) {
		if (await tryLoad(`https://${trimmed}`)) {
			syncPageState();
			return;
		}
		if (await tryLoad(`http://${trimmed}`)) {
			syncPageState();
			return;
		}
	}

	await tryLoad(searchUrl(trimmed));
	syncPageState();

	if (pickerActive) {
		await injectPicker();
	}
}

function isAbortedError(err: unknown): boolean {
	return err instanceof Error && "code" in err && (err as { code: string }).code === "ERR_ABORTED";
}

// ── Sidebar ────────────────────────────────────────────────────────────────

function setSidebarOpen(open: boolean): void {
	sidebarOpen = open;
	resizeViews();
	if (open) {
		pushSidebarUpdate();
	}
}

// ── Picker ─────────────────────────────────────────────────────────────────

async function injectPicker(): Promise<void> {
	if (!targetView) return;
	const pickerCode = await fs.promises.readFile(path.join(currentDir, "pickerBundle.js"), "utf-8");
	await targetView.webContents.executeJavaScript(pickerCode);
}

export async function enablePicker(): Promise<void> {
	pickerActive = true;
	await injectPicker();
}

export async function disablePicker(): Promise<void> {
	pickerActive = false;
	if (!targetView) return;
	await targetView.webContents.executeJavaScript("window.__webctxPickerCleanup?.();");
}

// ── Screenshot ─────────────────────────────────────────────────────────────

export async function takeScreenshot(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
	if (!targetView) throw new Error("No target view available");

	// Hide picker overlays for a clean screenshot, then wait for repaint
	await targetView.webContents.executeJavaScript(`
		new Promise(resolve => {
			window.__webctxPickerHide?.();
			const hl = document.getElementById('__webctx-sidebar-highlight');
			if (hl) hl.style.display = 'none';
			requestAnimationFrame(() => requestAnimationFrame(resolve));
		})
	`);

	let image: Electron.NativeImage;

	if (options.selector) {
		const rect = await targetView.webContents.executeJavaScript(`
			(() => {
				const el = document.querySelector(${JSON.stringify(options.selector)});
				if (!el) return null;
				const r = el.getBoundingClientRect();
				return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
			})()
		`);
		if (!rect) {
			await targetView.webContents.executeJavaScript("window.__webctxPickerShow?.();");
			throw new Error(`Element not found: ${options.selector}`);
		}
		image = await targetView.webContents.capturePage(rect);
	} else {
		image = await targetView.webContents.capturePage();
	}

	const size = image.getSize();
	const annotatedElements = options.annotate ? state.getSelection() : [];
	const pngBuffer = image.toPNG();

	// Restore picker overlays
	await targetView.webContents.executeJavaScript("window.__webctxPickerShow?.();");

	// Store for sidebar
	contextItems.push({
		type: "screenshot",
		id: String(nextItemId++),
		timestamp: Date.now(),
		data: {
			dataBase64: pngBuffer.toString("base64"),
			width: size.width,
			height: size.height,
		},
	});
	pushSidebarUpdate();

	return {
		data: pngBuffer,
		width: size.width,
		height: size.height,
		annotatedElements,
	};
}

// ── Element interaction ────────────────────────────────────────────────────

export async function clickElement(selector: string): Promise<void> {
	if (!targetView) throw new Error("No target view available");
	await targetView.webContents.executeJavaScript(`
		(() => {
			const el = document.querySelector(${JSON.stringify(selector)});
			if (!el) throw new Error('Element not found: ${selector}');
			el.click();
		})()
	`);
}

export async function typeInElement(selector: string, text: string): Promise<void> {
	if (!targetView) throw new Error("No target view available");
	await targetView.webContents.executeJavaScript(`
		(() => {
			const el = document.querySelector(${JSON.stringify(selector)});
			if (!el) throw new Error('Element not found');
			el.focus();
			el.value = ${JSON.stringify(text)};
			el.dispatchEvent(new Event('input', { bubbles: true }));
			el.dispatchEvent(new Event('change', { bubbles: true }));
		})()
	`);
}

export async function selectElement(selector: string): Promise<ElementContext | null> {
	if (!targetView) throw new Error("No target view available");
	const ctx: ElementContext | null = await targetView.webContents.executeJavaScript(`
		(() => {
			const el = document.querySelector(${JSON.stringify(selector)});
			if (!el) return null;
			const r = el.getBoundingClientRect();
			const attrs = {};
			for (const a of el.attributes) attrs[a.name] = a.value;
			return {
				cssSelector: ${JSON.stringify(selector)},
				xpath: '',
				tagName: el.tagName.toLowerCase(),
				textContent: (el.textContent || '').trim().slice(0, 500),
				attributes: attrs,
				boundingBox: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
				htmlSnippet: el.outerHTML.slice(0, 2000),
			};
		})()
	`);
	if (ctx) {
		state.select(ctx);
	}
	return ctx;
}

export async function listInteractiveElements(): Promise<ElementContext[]> {
	if (!targetView) throw new Error("No target view available");
	const elements: ElementContext[] = await targetView.webContents.executeJavaScript(`
		(() => {
			const interactiveSelectors = 'a, button, input, select, textarea, [role="button"], [onclick], [tabindex]';
			const results = [];
			for (const el of document.querySelectorAll(interactiveSelectors)) {
				const r = el.getBoundingClientRect();
				if (r.width === 0 && r.height === 0) continue;
				const attrs = {};
				for (const a of el.attributes) attrs[a.name] = a.value;
				results.push({
					cssSelector: '',
					xpath: '',
					tagName: el.tagName.toLowerCase(),
					textContent: (el.textContent || '').trim().slice(0, 500),
					attributes: attrs,
					boundingBox: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
					htmlSnippet: el.outerHTML.slice(0, 2000),
				});
			}
			return results;
		})()
	`);
	return elements;
}

// ── IPC handlers ───────────────────────────────────────────────────────────

function setupIpc(): void {
	// Toolbar -> Main
	ipcMain.handle("navigate", (_e: IpcMainInvokeEvent, url: string) => navigateTo(url));
	ipcMain.handle("go-back", () => targetView?.webContents.goBack());
	ipcMain.handle("go-forward", () => targetView?.webContents.goForward());
	ipcMain.handle("reload", () => targetView?.webContents.reload());
	ipcMain.handle("open-devtools", () => {
		if (!targetView || !mainWindow) return false;
		if (devtoolsOpen) {
			targetView.webContents.closeDevTools();
			cleanupDevtools();
			return false;
		}
		// Clean up any stale devtools view
		if (devtoolsView) {
			mainWindow.contentView.removeChildView(devtoolsView);
			devtoolsView = null;
		}
		devtoolsView = new WebContentsView();
		mainWindow.contentView.addChildView(devtoolsView);
		targetView.webContents.setDevToolsWebContents(devtoolsView.webContents);
		targetView.webContents.openDevTools({ mode: "detach", activate: false });
		devtoolsOpen = true;
		resizeViews();
		return true;
	});
	ipcMain.handle("toggle-picker", async () => {
		if (pickerActive) {
			await disablePicker();
			setSidebarOpen(false);
		} else {
			await enablePicker();
			setSidebarOpen(true);
		}
		return pickerActive;
	});
	ipcMain.handle("toggle-sidebar", () => {
		setSidebarOpen(!sidebarOpen);
		return sidebarOpen;
	});
	ipcMain.handle("get-picker-state", () => pickerActive);
	ipcMain.handle("get-context", () => state.getPageContext());
	ipcMain.handle("clear-selection", async () => {
		state.clearSelection();
		// Remove element items but keep screenshots
		for (let i = contextItems.length - 1; i >= 0; i--) {
			const ci = contextItems[i];
			if (ci && ci.type === "element") contextItems.splice(i, 1);
		}
		// Remove all picker overlays in the browser
		if (targetView && !targetView.webContents.isDestroyed()) {
			await targetView.webContents.executeJavaScript("window.__webctxPickerClearAll?.();");
		}
		pushSidebarUpdate();
	});
	ipcMain.handle("screenshot", (_e: IpcMainInvokeEvent, options: ScreenshotOptions) =>
		takeScreenshot(options),
	);

	// Picker (target WebContentsView) -> Main
	ipcMain.handle("picker:element-selected", (_e: IpcMainInvokeEvent, ctx: ElementContext) => {
		state.select(ctx);
		contextItems.push({
			type: "element",
			id: String(nextItemId++),
			timestamp: Date.now(),
			data: ctx,
		});
		pushSidebarUpdate();
	});
	ipcMain.handle("picker:element-deselected", (_e: IpcMainInvokeEvent, cssSelector: string) => {
		state.deselect(cssSelector);
		// Remove from contextItems
		const idx = contextItems.findIndex(
			(item) =>
				item.type === "element" && (item as ContextItemElement).data.cssSelector === cssSelector,
		);
		if (idx >= 0) contextItems.splice(idx, 1);
		pushSidebarUpdate();
	});

	// Sidebar -> Main
	ipcMain.handle("sidebar:clear-all", async () => {
		state.clearSelection();
		contextItems.length = 0;
		// Remove all picker overlays + sidebar highlight in the browser
		if (targetView && !targetView.webContents.isDestroyed()) {
			await targetView.webContents.executeJavaScript(
				"window.__webctxPickerClearAll?.(); (() => { const hl = document.getElementById('__webctx-sidebar-highlight'); if (hl) hl.style.display = 'none'; })()",
			);
		}
		pushSidebarUpdate();
	});
	ipcMain.handle("sidebar:remove-item", async (_e: IpcMainInvokeEvent, itemId: string) => {
		const idx = contextItems.findIndex((item) => item.id === itemId);
		if (idx >= 0) {
			const item = contextItems[idx] as ContextItem;
			if (item.type === "element" && targetView && !targetView.webContents.isDestroyed()) {
				state.deselect(item.data.cssSelector);
				// Remove green picker overlay + blue sidebar highlight
				await targetView.webContents.executeJavaScript(
					`window.__webctxPickerDeselect?.(${JSON.stringify(item.data.cssSelector)}); (() => { const hl = document.getElementById('__webctx-sidebar-highlight'); if (hl) hl.style.display = 'none'; })()`,
				);
			}
			contextItems.splice(idx, 1);
		}
		pushSidebarUpdate();
	});
	ipcMain.handle("sidebar:take-screenshot", () => takeScreenshot({}));
	ipcMain.handle("sidebar:copy-to-shell", async () => {
		const prompt = generateContextPrompt();
		await ensureTerminalOpen();
		writeToTerminal(prompt);
	});

	// Sidebar hover highlight
	ipcMain.handle("sidebar:highlight-element", async (_e: IpcMainInvokeEvent, selector: string) => {
		if (!targetView || targetView.webContents.isDestroyed()) return;
		await targetView.webContents.executeJavaScript(`
			(() => {
				let hl = document.getElementById('__webctx-sidebar-highlight');
				const el = document.querySelector(${JSON.stringify(selector)});
				if (!el) { if (hl) hl.style.display = 'none'; return; }
				const rect = el.getBoundingClientRect();
				if (!hl) {
					hl = document.createElement('div');
					hl.id = '__webctx-sidebar-highlight';
					Object.assign(hl.style, {
						position: 'fixed', pointerEvents: 'none', zIndex: '2147483644',
						background: 'rgba(137, 180, 250, 0.25)', border: '2px solid rgba(137, 180, 250, 0.8)',
						borderRadius: '2px', transition: 'all 0.1s ease-out',
					});
					document.documentElement.appendChild(hl);
				}
				Object.assign(hl.style, {
					display: 'block',
					left: rect.x + 'px', top: rect.y + 'px',
					width: rect.width + 'px', height: rect.height + 'px',
				});
			})()
		`);
	});
	ipcMain.handle("sidebar:clear-highlight", async () => {
		if (!targetView || targetView.webContents.isDestroyed()) return;
		await targetView.webContents.executeJavaScript(`
			(() => {
				const hl = document.getElementById('__webctx-sidebar-highlight');
				if (hl) hl.style.display = 'none';
			})()
		`);
	});

	// Favorites
	const favoritesPath = path.join(app.getPath("userData"), "favorites.json");
	ipcMain.handle("save-favorites", async (_e: IpcMainInvokeEvent, favs: unknown[]) => {
		await fs.promises.writeFile(favoritesPath, JSON.stringify(favs, null, 2), "utf-8");
	});
	ipcMain.handle("load-favorites", async () => {
		try {
			const data = await fs.promises.readFile(favoritesPath, "utf-8");
			return JSON.parse(data);
		} catch {
			return [];
		}
	});
	ipcMain.handle("set-favbar-height", (_e: IpcMainInvokeEvent, height: number) => {
		favBarHeight = height;
		resizeViews();
	});

	// Sidebar resize via drag handle
	let resizeInterval: ReturnType<typeof setInterval> | null = null;
	ipcMain.handle("sidebar:resize-start", () => {
		if (!mainWindow || resizeInterval) return;
		const startWidth = sidebarWidth;
		const startX = screen.getCursorScreenPoint().x;
		resizeInterval = setInterval(() => {
			if (!mainWindow) {
				if (resizeInterval) clearInterval(resizeInterval);
				resizeInterval = null;
				return;
			}
			const currentX = screen.getCursorScreenPoint().x;
			const delta = startX - currentX;
			const windowBounds = mainWindow.getBounds();
			const minWidth = 200;
			const maxWidth = Math.round(windowBounds.width * 0.6);
			sidebarWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + delta));
			resizeViews();
		}, 16);
	});
	ipcMain.handle("sidebar:resize-end", () => {
		if (resizeInterval) {
			clearInterval(resizeInterval);
			resizeInterval = null;
		}
	});

	// ── Terminal / Left panel ──────────────────────────────────────────

	ipcMain.handle("toggle-terminal", () => {
		if (terminalOpen) {
			closeTerminalPanel();
			return false;
		}
		openTerminalPanel();
		return true;
	});

	ipcMain.handle("terminal:input", (_e: IpcMainInvokeEvent, data: string) => {
		ptyProcess?.write(data);
	});

	ipcMain.handle("terminal:resize", (_e: IpcMainInvokeEvent, cols: number, rows: number) => {
		try {
			ptyProcess?.resize(cols, rows);
		} catch {
			// resize can fail if PTY is already dead
		}
	});

	ipcMain.handle("terminal:ready", (_e: IpcMainInvokeEvent, cols: number, rows: number) => {
		startPty(cols, rows);
	});

	// Terminal panel resize via drag handle (on left edge, so drag left = wider)
	let termResizeInterval: ReturnType<typeof setInterval> | null = null;
	ipcMain.handle("terminal:resize-start", () => {
		if (!mainWindow || termResizeInterval) return;
		const startWidth = terminalWidth;
		const startX = screen.getCursorScreenPoint().x;
		termResizeInterval = setInterval(() => {
			if (!mainWindow) {
				if (termResizeInterval) clearInterval(termResizeInterval);
				termResizeInterval = null;
				return;
			}
			const currentX = screen.getCursorScreenPoint().x;
			const delta = startX - currentX;
			const windowBounds = mainWindow.getBounds();
			const minWidth = 200;
			const maxWidth = Math.round(windowBounds.width * 0.6);
			terminalWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + delta));
			resizeViews();
		}, 16);
	});
	ipcMain.handle("terminal:resize-end", () => {
		if (termResizeInterval) {
			clearInterval(termResizeInterval);
			termResizeInterval = null;
		}
	});
}

// ── Terminal panel helpers ─────────────────────────────────────────────────

function openTerminalPanel(): void {
	if (!mainWindow || terminalView) return;
	terminalView = new WebContentsView({
		webPreferences: {
			preload: path.join(currentDir, "terminalPreload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	mainWindow.contentView.addChildView(terminalView);
	terminalView.webContents.loadFile(path.join(currentDir, "terminal.html"));
	terminalOpen = true;
	resizeViews();
	// Notify toolbar
	if (toolbarView && !toolbarView.webContents.isDestroyed()) {
		toolbarView.webContents.send("terminal-toggled", true);
	}
}

function closeTerminalPanel(): void {
	terminalOpen = false;
	killPty();
	if (terminalView && mainWindow) {
		mainWindow.contentView.removeChildView(terminalView);
		terminalView.webContents.close();
		terminalView = null;
	}
	resizeViews();
	// Notify toolbar
	if (toolbarView && !toolbarView.webContents.isDestroyed()) {
		toolbarView.webContents.send("terminal-toggled", false);
	}
}

function startPty(cols: number, rows: number): void {
	if (ptyProcess) return;
	const shell = process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "/bin/zsh");
	try {
		ptyProcess = pty.spawn(shell, [], {
			name: "xterm-256color",
			cols,
			rows,
			cwd: process.cwd(),
			env: process.env as Record<string, string>,
		});
	} catch (err) {
		console.error("[webctx] Failed to spawn PTY:", err);
		return;
	}
	ptyProcess.onData((data) => {
		if (terminalView && !terminalView.webContents.isDestroyed()) {
			terminalView.webContents.send("terminal:data", data);
		}
	});
	ptyProcess.onExit(() => {
		ptyProcess = null;
	});
}

function killPty(): void {
	if (ptyProcess) {
		ptyProcess.kill();
		ptyProcess = null;
	}
}

function formatElementForPrompt(item: ContextItemElement): string[] {
	const el = item.data;
	const lines: string[] = [`- \`${el.cssSelector}\` (${el.tagName})`];
	if (el.textContent) lines.push(`  Text: "${el.textContent.slice(0, 100)}"`);
	if (el.sourceLocation) {
		lines.push(`  Source: ${el.sourceLocation.fileName}:${el.sourceLocation.lineNumber}`);
	}
	if (el.frameworkInfo?.componentName) {
		lines.push(`  Component: ${el.frameworkInfo.componentName}`);
	}
	return lines;
}

function generateContextPrompt(): string {
	const pageCtx = state.getPageContext();
	const lines: string[] = ["# webctx context", ""];
	if (pageCtx.url) {
		lines.push(`Page: ${pageCtx.url}`);
		if (pageCtx.title) lines.push(`Title: ${pageCtx.title}`);
		lines.push("");
	}
	const elements = contextItems.filter((i): i is ContextItemElement => i.type === "element");
	if (elements.length > 0) {
		lines.push(`## Selected elements (${elements.length})`, "");
		for (const item of elements) {
			lines.push(...formatElementForPrompt(item));
		}
		lines.push("");
	}
	const screenshots = contextItems.filter((i) => i.type === "screenshot");
	if (screenshots.length > 0) {
		lines.push(`## Screenshots: ${screenshots.length} captured`, "");
	}
	return lines.join("\n");
}

async function ensureTerminalOpen(): Promise<void> {
	if (!terminalOpen) {
		openTerminalPanel();
		// Wait for the PTY to be ready (terminal:ready IPC triggers startPty)
		await new Promise<void>((resolve) => {
			const check = setInterval(() => {
				if (ptyProcess) {
					clearInterval(check);
					resolve();
				}
			}, 50);
			// Timeout after 5s
			setTimeout(() => {
				clearInterval(check);
				resolve();
			}, 5000);
		});
	}
}

function writeToTerminal(text: string): void {
	if (!ptyProcess) return;
	// Write as a heredoc-style cat so the prompt text appears cleanly
	// Use printf to avoid shell interpretation issues
	const escaped = text.replace(/\\/g, "\\\\").replace(/'/g, "'\\''");
	ptyProcess.write(`printf '%s\\n' '${escaped}'\r`);
}

// ── Headless mode (for MCP/CLI) ───────────────────────────────────────────

export async function launchHeadless(url?: string): Promise<void> {
	app.disableHardwareAcceleration();
	await launchApp(url, true);
}

// ── Context HTTP server ────────────────────────────────────────────────────

const CONTEXT_SERVER_PORT = 24842;
let contextServer: http.Server | null = null;

function handleContextRoute(res: http.ServerResponse): void {
	const pageCtx = state.getPageContext();
	const items = contextItems.map((item) => {
		if (item.type === "screenshot") {
			return {
				...item,
				data: {
					width: item.data.width,
					height: item.data.height,
					url: `http://localhost:${CONTEXT_SERVER_PORT}/screenshot/${item.id}`,
				},
			};
		}
		return item;
	});
	res.writeHead(200, { "Content-Type": "application/json" });
	res.end(JSON.stringify({ page: pageCtx, items }, null, 2));
}

function handleConsoleRoute(url: URL, res: http.ServerResponse): void {
	const level = url.searchParams.get("level") ?? undefined;
	const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined;
	const clear = url.searchParams.get("clear") === "true";
	const entries = getConsoleLogs({ level, limit, clear });
	res.writeHead(200, { "Content-Type": "application/json" });
	res.end(JSON.stringify(entries, null, 2));
}

function handleNetworkRoute(url: URL, res: http.ServerResponse): void {
	const filter = url.searchParams.get("filter") ?? undefined;
	const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined;
	const clear = url.searchParams.get("clear") === "true";
	const entries = getNetworkLog({ filter, limit, clear });
	res.writeHead(200, { "Content-Type": "application/json" });
	res.end(JSON.stringify(entries, null, 2));
}

function handleScreenshotRoute(id: string, res: http.ServerResponse): void {
	const item = contextItems.find((i) => i.type === "screenshot" && i.id === id);
	if (item && item.type === "screenshot") {
		const buf = Buffer.from(item.data.dataBase64, "base64");
		res.writeHead(200, {
			"Content-Type": "image/png",
			"Content-Length": String(buf.length),
		});
		res.end(buf);
		return;
	}
	res.writeHead(404, { "Content-Type": "application/json" });
	res.end(JSON.stringify({ error: "Screenshot not found" }));
}

function startContextServer(): void {
	if (contextServer) return;

	contextServer = http.createServer((req, res) => {
		const url = new URL(req.url ?? "/", `http://localhost:${CONTEXT_SERVER_PORT}`);

		// CORS headers for agent access
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type");

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		if (url.pathname === "/" || url.pathname === "/context") {
			handleContextRoute(res);
			return;
		}

		if (url.pathname === "/console") {
			handleConsoleRoute(url, res);
			return;
		}

		if (url.pathname === "/network") {
			handleNetworkRoute(url, res);
			return;
		}

		const screenshotMatch = url.pathname.match(/^\/screenshot\/(\w+)$/);
		if (screenshotMatch) {
			handleScreenshotRoute(screenshotMatch[1] as string, res);
			return;
		}

		res.writeHead(404, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "Not found" }));
	});

	contextServer.listen(CONTEXT_SERVER_PORT, "127.0.0.1", () => {
		console.log(`[webctx] Context server: http://localhost:${CONTEXT_SERVER_PORT}/context`);
	});

	contextServer.on("error", (err: NodeJS.ErrnoException) => {
		if (err.code === "EADDRINUSE") {
			console.warn(`[webctx] Port ${CONTEXT_SERVER_PORT} in use, context server disabled`);
			contextServer = null;
		} else {
			console.error("[webctx] Context server error:", err);
		}
	});
}

function stopContextServer(): void {
	if (contextServer) {
		contextServer.close();
		contextServer = null;
	}
}

// ── Crash diagnostics ──────────────────────────────────────────────────────

process.on("uncaughtException", (err) => {
	console.error("[CRASH] Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
	console.error("[CRASH] Unhandled rejection:", reason);
});

// ── Entry point ────────────────────────────────────────────────────────────

if (
	process.argv[1]?.endsWith("main.js") ||
	process.argv[1]?.endsWith("main.ts") ||
	process.argv[1]?.endsWith("main.cjs")
) {
	setupIpc();
	const urlArg = process.argv[2];
	launchApp(urlArg).catch((err) => {
		console.error("Failed to launch:", err);
		process.exit(1);
	});
}

export { setupIpc };
