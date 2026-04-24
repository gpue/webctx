/**
 * Screenshot module — captures viewport, full page, or element screenshots
 * from an Electron webContents.
 */

import type { ScreenshotOptions, ScreenshotResult } from "./types.js";

/**
 * Capture a screenshot from Electron webContents.
 *
 * @param webContents - Electron WebContents instance (typed as `unknown` to
 *   avoid hard Electron dependency in unit tests; validated at runtime)
 * @param options - Screenshot options
 */
export async function captureScreenshot(
	webContents: {
		capturePage: (rect?: unknown) => Promise<unknown>;
		executeJavaScript: (code: string) => Promise<unknown>;
	},
	options: ScreenshotOptions = {},
): Promise<ScreenshotResult> {
	type NativeImage = { toPNG: () => Buffer; getSize: () => { width: number; height: number } };

	let image: NativeImage;

	if (options.selector) {
		const rect = (await webContents.executeJavaScript(`
			(() => {
				const el = document.querySelector(${JSON.stringify(options.selector)});
				if (!el) return null;
				const r = el.getBoundingClientRect();
				return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
			})()
		`)) as { x: number; y: number; width: number; height: number } | null;

		if (!rect) throw new Error(`Element not found: ${options.selector}`);
		image = (await webContents.capturePage(rect)) as NativeImage;
	} else {
		image = (await webContents.capturePage()) as NativeImage;
	}

	const size = image.getSize();
	return {
		data: image.toPNG(),
		width: size.width,
		height: size.height,
		annotatedElements: [],
	};
}
