/**
 * webctx MCP server — exposes browser automation tools to agents via stdio.
 *
 * Tools:
 * - webctx_navigate: Navigate to a URL
 * - webctx_screenshot: Capture a screenshot
 * - webctx_select: Select an element by CSS selector
 * - webctx_click: Click an element
 * - webctx_type: Type text into an element
 * - webctx_get_context: Get current selection/page state
 * - webctx_list_elements: List interactive elements on page
 * - webctx_pick: Enable interactive picker, return what user selects
 */

import { StateManager } from "../core/index.js";

// MCP server instance will be initialized here once @modelcontextprotocol/sdk is available.
// For now, export the state manager used by the server.

export const state = new StateManager();

export async function startServer(): Promise<void> {
	// TODO: implement MCP server with stdio transport
	console.log("webctx MCP server starting...");
	throw new Error("Not implemented");
}
