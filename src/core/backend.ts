/**
 * Electron backend — bridges the MCP/CLI layer to the Electron browser.
 * Provides the BrowserBackend interface used by the MCP server and CLI.
 */

import type { BrowserBackend } from "../mcp/server.js";
import type { StateManager } from "./state.js";
import type { ScreenshotOptions } from "./types.js";

/**
 * Create an Electron-backed browser backend.
 * This dynamically imports Electron APIs so the module can be loaded
 * in non-Electron contexts (for testing/type-checking).
 */
export async function createElectronBackend(
	initialUrl?: string,
	headless = false,
): Promise<BrowserBackend> {
	// Import from the electron main module
	const electronMain = await import("../../electron/main.js");

	electronMain.setupIpc();

	if (headless) {
		await electronMain.launchHeadless(initialUrl);
	} else {
		await electronMain.launchApp(initialUrl);
	}

	const stateManager = electronMain.getState();

	return {
		state: stateManager as StateManager,

		async navigateTo(url: string): Promise<void> {
			await electronMain.navigateTo(url);
		},

		async takeScreenshot(
			options?: ScreenshotOptions,
		): Promise<{ data: Buffer; width: number; height: number }> {
			const result = await electronMain.takeScreenshot(options);
			return { data: result.data, width: result.width, height: result.height };
		},

		async selectElement(selector: string): Promise<unknown> {
			return electronMain.selectElement(selector);
		},

		async clickElement(selector: string): Promise<void> {
			await electronMain.clickElement(selector);
		},

		async typeInElement(selector: string, text: string): Promise<void> {
			await electronMain.typeInElement(selector, text);
		},

		async listInteractiveElements(): Promise<unknown[]> {
			return electronMain.listInteractiveElements();
		},

		async enablePicker(): Promise<void> {
			await electronMain.enablePicker();
		},

		async disablePicker(): Promise<void> {
			await electronMain.disablePicker();
		},
	};
}
