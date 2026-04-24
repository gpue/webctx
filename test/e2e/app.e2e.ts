import * as path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

/**
 * E2E test scaffolding for the Electron app.
 * These tests launch the actual Electron process and interact with it.
 *
 * NOTE: These tests will be skipped until the Electron main process is implemented.
 */

const appPath = path.resolve(import.meta.dirname, "../../dist/electron/main.js");

test.describe("webctx Electron app", () => {
	test.skip(true, "Electron main process not yet implemented");

	test("launches and loads a URL", async () => {
		const app = await electron.launch({ args: [appPath] });
		const window = await app.firstWindow();

		await window.goto("https://example.com");
		await expect(window).toHaveTitle(/Example/);

		await app.close();
	});

	test("element picker selects on click", async () => {
		const app = await electron.launch({ args: [appPath] });
		const window = await app.firstWindow();

		await window.goto(`file://${path.resolve(import.meta.dirname, "../fixtures/simple.html")}`);

		// TODO: activate picker mode, click #page-title, verify selection state
		await app.close();
	});

	test("screenshot captures viewport", async () => {
		const app = await electron.launch({ args: [appPath] });
		const window = await app.firstWindow();

		await window.goto(`file://${path.resolve(import.meta.dirname, "../fixtures/simple.html")}`);

		const screenshot = await window.screenshot();
		expect(screenshot.byteLength).toBeGreaterThan(0);

		await app.close();
	});
});
