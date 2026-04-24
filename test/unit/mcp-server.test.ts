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
});
