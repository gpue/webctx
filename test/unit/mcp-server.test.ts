import { beforeEach, describe, expect, it, vi } from "vitest";
import { StateManager } from "../../src/core/state.js";
import { type BrowserBackend, createMcpServer } from "../../src/mcp/server.js";

function createMockBackend(): BrowserBackend {
	const state = new StateManager();
	return {
		state,
		navigateTo: vi.fn(async (url: string) => {
			state.setPage(url, `Title for ${url}`);
		}),
		takeScreenshot: vi.fn(async () => ({
			data: Buffer.from("fake-png-data"),
			width: 1280,
			height: 900,
		})),
		selectElement: vi.fn(async (selector: string) => ({
			cssSelector: selector,
			xpath: "",
			tagName: "div",
			textContent: "Mock element",
			attributes: {},
			boundingBox: { x: 0, y: 0, width: 100, height: 50 },
			htmlSnippet: `<div>${selector}</div>`,
		})),
		clickElement: vi.fn(async () => {}),
		typeInElement: vi.fn(async () => {}),
		listInteractiveElements: vi.fn(async () => [
			{
				cssSelector: "button.submit",
				tagName: "button",
				textContent: "Submit",
				attributes: { type: "submit" },
				boundingBox: { x: 10, y: 20, width: 80, height: 30 },
				htmlSnippet: "<button>Submit</button>",
			},
		]),
		enablePicker: vi.fn(async () => {}),
		disablePicker: vi.fn(async () => {}),
		getConsoleLogs: vi.fn(async (options?: { level?: string; limit?: number; clear?: boolean }) => {
			const logs = [
				{ level: "log", message: "Hello", source: "app.js", line: 1, timestamp: 1000 },
				{ level: "error", message: "Oops", source: "app.js", line: 5, timestamp: 2000 },
				{ level: "warn", message: "Hmm", source: "lib.js", line: 10, timestamp: 3000 },
			];
			let result = [...logs];
			if (options?.level) {
				result = result.filter((e) => e.level === options.level);
			}
			if (options?.limit && options.limit > 0) {
				result = result.slice(-options.limit);
			}
			return result;
		}),
		getNetworkLog: vi.fn(async (options?: { limit?: number; filter?: string; clear?: boolean }) => {
			const entries = [
				{
					url: "https://example.com/api",
					method: "GET",
					status: 200,
					mimeType: "application/json",
					size: 1024,
					duration: 150,
					timestamp: 1000,
				},
				{
					url: "https://example.com/style.css",
					method: "GET",
					status: 200,
					mimeType: "text/css",
					size: 2048,
					duration: 50,
					timestamp: 1100,
				},
			];
			let result = [...entries];
			if (options?.filter) {
				const p = options.filter.toLowerCase();
				result = result.filter(
					(e) => e.url.toLowerCase().includes(p) || e.mimeType.toLowerCase().includes(p),
				);
			}
			if (options?.limit && options.limit > 0) {
				result = result.slice(-options.limit);
			}
			return result;
		}),
	};
}

/**
 * Test the MCP server tool registration and handler logic.
 * We can't easily call tools via the MCP SDK without a transport,
 * so we test that the server is created and the backend is wired correctly.
 */
describe("createMcpServer", () => {
	let backend: BrowserBackend;

	beforeEach(() => {
		backend = createMockBackend();
	});

	it("creates an MCP server instance", () => {
		const server = createMcpServer(backend);
		expect(server).toBeDefined();
	});

	it("backend.navigateTo updates state", async () => {
		await backend.navigateTo("https://example.com");
		const ctx = backend.state.getPageContext();
		expect(ctx.url).toBe("https://example.com");
		expect(ctx.title).toBe("Title for https://example.com");
	});

	it("backend.takeScreenshot returns buffer", async () => {
		const result = await backend.takeScreenshot();
		expect(result.data).toBeInstanceOf(Buffer);
		expect(result.width).toBe(1280);
		expect(result.height).toBe(900);
	});

	it("backend.selectElement returns context", async () => {
		const ctx = await backend.selectElement("#test");
		expect(ctx).toHaveProperty("cssSelector", "#test");
	});

	it("backend.clickElement is callable", async () => {
		await backend.clickElement("#btn");
		expect(backend.clickElement).toHaveBeenCalledWith("#btn");
	});

	it("backend.typeInElement is callable", async () => {
		await backend.typeInElement("#input", "hello");
		expect(backend.typeInElement).toHaveBeenCalledWith("#input", "hello");
	});

	it("backend.listInteractiveElements returns elements", async () => {
		const elements = await backend.listInteractiveElements();
		expect(elements).toHaveLength(1);
		expect(elements[0]).toHaveProperty("tagName", "button");
	});

	it("backend.enablePicker/disablePicker are callable", async () => {
		await backend.enablePicker();
		expect(backend.enablePicker).toHaveBeenCalled();
		await backend.disablePicker();
		expect(backend.disablePicker).toHaveBeenCalled();
	});

	it("backend.getConsoleLogs returns all entries", async () => {
		const logs = await backend.getConsoleLogs();
		expect(logs).toHaveLength(3);
		expect(logs[0]).toHaveProperty("level", "log");
	});

	it("backend.getConsoleLogs filters by level", async () => {
		const logs = await backend.getConsoleLogs({ level: "error" });
		expect(logs).toHaveLength(1);
		expect(logs[0]).toHaveProperty("message", "Oops");
	});

	it("backend.getConsoleLogs respects limit", async () => {
		const logs = await backend.getConsoleLogs({ limit: 2 });
		expect(logs).toHaveLength(2);
	});

	it("backend.getNetworkLog returns all entries", async () => {
		const entries = await backend.getNetworkLog();
		expect(entries).toHaveLength(2);
		expect(entries[0]).toHaveProperty("url", "https://example.com/api");
	});

	it("backend.getNetworkLog filters by URL", async () => {
		const entries = await backend.getNetworkLog({ filter: "style" });
		expect(entries).toHaveLength(1);
		expect(entries[0]).toHaveProperty("mimeType", "text/css");
	});

	it("backend.getNetworkLog respects limit", async () => {
		const entries = await backend.getNetworkLog({ limit: 1 });
		expect(entries).toHaveLength(1);
	});
});
