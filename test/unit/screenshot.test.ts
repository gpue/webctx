import { describe, expect, it, vi } from "vitest";
import { captureScreenshot } from "../../src/core/screenshot.js";

function createMockWebContents(options?: {
	imageBuffer?: Buffer;
	imageSize?: { width: number; height: number };
	elementRect?: { x: number; y: number; width: number; height: number } | null;
}) {
	const buf = options?.imageBuffer ?? Buffer.from("fake-png");
	const size = options?.imageSize ?? { width: 800, height: 600 };
	const mockImage = {
		toPNG: () => buf,
		getSize: () => size,
	};

	return {
		capturePage: vi.fn(async () => mockImage),
		executeJavaScript: vi.fn(async () => options?.elementRect ?? null),
	};
}

describe("captureScreenshot", () => {
	it("captures viewport screenshot by default", async () => {
		const wc = createMockWebContents();
		const result = await captureScreenshot(wc);
		expect(result.data).toBeInstanceOf(Buffer);
		expect(result.width).toBe(800);
		expect(result.height).toBe(600);
		expect(wc.capturePage).toHaveBeenCalledOnce();
	});

	it("captures full page screenshot", async () => {
		const wc = createMockWebContents();
		const result = await captureScreenshot(wc, { fullPage: true });
		expect(result.data).toBeInstanceOf(Buffer);
		expect(wc.capturePage).toHaveBeenCalledOnce();
	});

	it("captures element screenshot when selector provided", async () => {
		const rect = { x: 10, y: 20, width: 100, height: 50 };
		const wc = createMockWebContents({ elementRect: rect });
		const result = await captureScreenshot(wc, { selector: "#target" });
		expect(result.data).toBeInstanceOf(Buffer);
		expect(wc.executeJavaScript).toHaveBeenCalledOnce();
		expect(wc.capturePage).toHaveBeenCalledWith(rect);
	});

	it("throws when selector element not found", async () => {
		const wc = createMockWebContents({ elementRect: null });
		await expect(captureScreenshot(wc, { selector: "#missing" })).rejects.toThrow(
			"Element not found: #missing",
		);
	});

	it("returns empty annotatedElements array", async () => {
		const wc = createMockWebContents();
		const result = await captureScreenshot(wc);
		expect(result.annotatedElements).toEqual([]);
	});
});
