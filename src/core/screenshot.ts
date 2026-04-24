import type { ScreenshotOptions, ScreenshotResult } from "./types.js";

/**
 * Screenshot module — captures viewport, full page, or element screenshots.
 * Wraps Electron's webContents.capturePage() API.
 *
 * Stub: implementation depends on Electron main process integration.
 */
export async function captureScreenshot(
	_webContents: unknown,
	_options: ScreenshotOptions,
): Promise<ScreenshotResult> {
	// TODO: implement with Electron webContents.capturePage()
	throw new Error("Not implemented");
}
