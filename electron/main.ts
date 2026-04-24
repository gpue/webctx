/**
 * Electron main process — launches the browser window with element picker.
 *
 * Architecture:
 * - Main BrowserWindow hosts a toolbar (URL bar, controls)
 * - A BrowserView is attached for the target web page
 * - Picker script is injected into the BrowserView for element selection
 * - IPC channels connect toolbar <-> main <-> picker
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	app,
	type BrowserView,
	type BrowserWindow,
	type IpcMainInvokeEvent,
	ipcMain,
} from "electron";
import { StateManager } from "../src/core/state.js";
import type { ElementContext, ScreenshotOptions, ScreenshotResult } from "../src/core/types.js";

// Support both CJS (__dirname) and ESM (import.meta)
const currentDir =
	typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// ── State ──────────────────────────────────────────────────────────────────

const state = new StateManager();
let mainWindow: BrowserWindow | null = null;
let targetView: BrowserView | null = null;
let pickerActive = false;

const TOOLBAR_HEIGHT = 52;

// ── App lifecycle ──────────────────────────────────────────────────────────

export function getState(): StateManager {
	return state;
}

export function getMainWindow(): BrowserWindow | null {
	return mainWindow;
}

export function getTargetView(): BrowserView | null {
	return targetView;
}

export async function launchApp(url?: string, headless = false): Promise<void> {
	// Dynamic import to allow this module to be loaded without Electron in tests
	const { BrowserWindow: BW, BrowserView: BView } = await import("electron");

	await app.whenReady();

	mainWindow = new BW({
		width: 1280,
		height: 900,
		show: !headless,
		webPreferences: {
			preload: path.join(currentDir, "toolbarPreload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	// Load toolbar UI
	mainWindow.loadFile(path.join(currentDir, "toolbar.html"));

	// Create the BrowserView for the target page
	targetView = new BView({
		webPreferences: {
			preload: path.join(currentDir, "viewPreload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	mainWindow.setBrowserView(targetView);
	resizeView();

	mainWindow.on("resize", resizeView);
	mainWindow.on("closed", () => {
		mainWindow = null;
		targetView = null;
	});

	// Navigate to initial URL if provided
	if (url) {
		await navigateTo(url);
	}

	// Listen for page title/URL changes
	targetView.webContents.on("did-navigate", () => syncPageState());
	targetView.webContents.on("did-navigate-in-page", () => syncPageState());
	targetView.webContents.on("page-title-updated", () => syncPageState());
}

function resizeView(): void {
	if (!mainWindow || !targetView) return;
	const { width, height } = mainWindow.getBounds();
	targetView.setBounds({
		x: 0,
		y: TOOLBAR_HEIGHT,
		width,
		height: height - TOOLBAR_HEIGHT,
	});
}

function syncPageState(): void {
	if (!targetView) return;
	const url = targetView.webContents.getURL();
	const title = targetView.webContents.getTitle();
	state.setPage(url, title);

	// Notify toolbar of URL change
	if (mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.webContents.send("url-changed", url);
	}
}

// ── Navigation ─────────────────────────────────────────────────────────────

export async function navigateTo(url: string): Promise<void> {
	if (!targetView) throw new Error("No target view available");

	// Normalize URL
	let normalizedUrl = url;
	if (!/^https?:\/\//i.test(normalizedUrl)) {
		normalizedUrl = `https://${normalizedUrl}`;
	}

	await targetView.webContents.loadURL(normalizedUrl);
	syncPageState();

	// Re-inject picker if it was active
	if (pickerActive) {
		await injectPicker();
	}
}

// ── Picker ─────────────────────────────────────────────────────────────────

async function injectPicker(): Promise<void> {
	if (!targetView) return;

	const pickerCode = await import("node:fs").then((fs) =>
		fs.promises.readFile(path.join(currentDir, "pickerBundle.js"), "utf-8"),
	);

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

	let image: Electron.NativeImage;

	if (options.selector) {
		// Capture specific element by scrolling to it and clipping
		const rect = await targetView.webContents.executeJavaScript(`
			(() => {
				const el = document.querySelector(${JSON.stringify(options.selector)});
				if (!el) return null;
				const r = el.getBoundingClientRect();
				return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
			})()
		`);
		if (!rect) throw new Error(`Element not found: ${options.selector}`);
		image = await targetView.webContents.capturePage(rect);
	} else if (options.fullPage) {
		// Full page: scroll and stitch (simplified — capture current scroll extent)
		image = await targetView.webContents.capturePage();
	} else {
		image = await targetView.webContents.capturePage();
	}

	const size = image.getSize();
	const annotatedElements = options.annotate ? state.getSelection() : [];

	return {
		data: image.toPNG(),
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
	ipcMain.handle("toggle-picker", async () => {
		if (pickerActive) {
			await disablePicker();
		} else {
			await enablePicker();
		}
		return pickerActive;
	});
	ipcMain.handle("get-picker-state", () => pickerActive);
	ipcMain.handle("get-context", () => state.getPageContext());
	ipcMain.handle("clear-selection", () => state.clearSelection());
	ipcMain.handle("screenshot", (_e: IpcMainInvokeEvent, options: ScreenshotOptions) =>
		takeScreenshot(options),
	);

	// Picker (BrowserView) -> Main
	ipcMain.handle("picker:element-selected", (_e: IpcMainInvokeEvent, ctx: ElementContext) => {
		state.select(ctx);
		// Notify toolbar
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.send("selection-updated", state.getPageContext());
		}
	});
	ipcMain.handle("picker:element-deselected", (_e: IpcMainInvokeEvent, cssSelector: string) => {
		state.deselect(cssSelector);
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.send("selection-updated", state.getPageContext());
		}
	});
}

// ── Headless mode (for MCP/CLI) ───────────────────────────────────────────

export async function launchHeadless(url?: string): Promise<void> {
	app.disableHardwareAcceleration();
	await launchApp(url, true);
}

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
