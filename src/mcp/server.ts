/**
 * webctx MCP server — exposes browser automation tools to agents via stdio.
 *
 * Tools:
 * - webctx_navigate:       Navigate to a URL
 * - webctx_screenshot:     Capture a screenshot (returns base64 PNG)
 * - webctx_select:         Select an element by CSS selector
 * - webctx_click:          Click an element
 * - webctx_type:           Type text into an element
 * - webctx_get_context:    Get current selection/page state
 * - webctx_list_elements:  List interactive elements on page
 * - webctx_pick:           Enable/disable interactive picker
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { StateManager } from "../core/state.js";

/** Abstraction over the browser backend so the MCP server is testable. */
export interface BrowserBackend {
	state: StateManager;
	navigateTo(url: string): Promise<void>;
	takeScreenshot(options?: {
		fullPage?: boolean;
		selector?: string;
		annotate?: boolean;
	}): Promise<{ data: Buffer; width: number; height: number }>;
	selectElement(selector: string): Promise<unknown>;
	clickElement(selector: string): Promise<void>;
	typeInElement(selector: string, text: string): Promise<void>;
	listInteractiveElements(): Promise<unknown[]>;
	enablePicker(): Promise<void>;
	disablePicker(): Promise<void>;
}

export function createMcpServer(backend: BrowserBackend): McpServer {
	const server = new McpServer({
		name: "webctx",
		version: "0.1.0",
	});

	// ── navigate ─────────────────────────────────────────────────────

	server.tool(
		"webctx_navigate",
		"Navigate the browser to a URL",
		{
			url: z.string().describe("The URL to navigate to"),
		},
		async ({ url }) => {
			await backend.navigateTo(url);
			const ctx = backend.state.getPageContext();
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ url: ctx.url, title: ctx.title }, null, 2),
					},
				],
			};
		},
	);

	// ── screenshot ───────────────────────────────────────────────────

	server.tool(
		"webctx_screenshot",
		"Capture a screenshot of the current page or a specific element",
		{
			fullPage: z.boolean().optional().describe("Capture full page (default: viewport only)"),
			selector: z.string().optional().describe("CSS selector of element to capture"),
			annotate: z.boolean().optional().describe("Overlay selection highlights on the screenshot"),
		},
		async ({ fullPage, selector, annotate }) => {
			const result = await backend.takeScreenshot({ fullPage, selector, annotate });
			return {
				content: [
					{
						type: "image" as const,
						data: result.data.toString("base64"),
						mimeType: "image/png" as const,
					},
				],
			};
		},
	);

	// ── select ───────────────────────────────────────────────────────

	server.tool(
		"webctx_select",
		"Select a page element by CSS selector, adding it to the current selection",
		{
			selector: z.string().describe("CSS selector of the element to select"),
		},
		async ({ selector }) => {
			const ctx = await backend.selectElement(selector);
			return {
				content: [
					{
						type: "text" as const,
						text: ctx ? JSON.stringify(ctx, null, 2) : `Element not found: ${selector}`,
					},
				],
			};
		},
	);

	// ── click ────────────────────────────────────────────────────────

	server.tool(
		"webctx_click",
		"Click an element on the page",
		{
			selector: z.string().describe("CSS selector of the element to click"),
		},
		async ({ selector }) => {
			await backend.clickElement(selector);
			return {
				content: [{ type: "text" as const, text: `Clicked: ${selector}` }],
			};
		},
	);

	// ── type ─────────────────────────────────────────────────────────

	server.tool(
		"webctx_type",
		"Type text into an input element",
		{
			selector: z.string().describe("CSS selector of the input element"),
			text: z.string().describe("Text to type"),
		},
		async ({ selector, text }) => {
			await backend.typeInElement(selector, text);
			return {
				content: [
					{
						type: "text" as const,
						text: `Typed into ${selector}: "${text}"`,
					},
				],
			};
		},
	);

	// ── get_context ──────────────────────────────────────────────────

	server.tool(
		"webctx_get_context",
		"Get the current page context including all selected elements",
		{},
		async () => {
			const ctx = backend.state.getPageContext();
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(ctx, null, 2),
					},
				],
			};
		},
	);

	// ── list_elements ────────────────────────────────────────────────

	server.tool(
		"webctx_list_elements",
		"List all interactive elements on the current page (links, buttons, inputs, etc.)",
		{},
		async () => {
			const elements = await backend.listInteractiveElements();
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(elements, null, 2),
					},
				],
			};
		},
	);

	// ── pick ─────────────────────────────────────────────────────────

	server.tool(
		"webctx_pick",
		"Enable or disable the interactive element picker in the browser UI",
		{
			enabled: z.boolean().describe("true to enable picker, false to disable"),
		},
		async ({ enabled }) => {
			if (enabled) {
				await backend.enablePicker();
			} else {
				await backend.disablePicker();
			}
			return {
				content: [
					{
						type: "text" as const,
						text: `Picker ${enabled ? "enabled" : "disabled"}`,
					},
				],
			};
		},
	);

	return server;
}

/** Start MCP server with stdio transport, connected to the given backend. */
export async function startMcpServer(backend: BrowserBackend): Promise<void> {
	const server = createMcpServer(backend);
	const transport = new StdioServerTransport();
	await server.connect(transport);
}
