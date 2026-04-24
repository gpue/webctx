#!/usr/bin/env node

/**
 * webctx CLI — agent-ready command-line interface.
 *
 * Commands:
 *   open <url>                    Launch the interactive browser
 *   screenshot <url>              Take a screenshot
 *   click <url> <selector>        Click an element
 *   type <url> <selector> <text>  Type into an element
 *   context <url>                 Dump interactive elements as JSON
 *   serve                         Start MCP server (stdio)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";

const program = new Command();

program
	.name("webctx")
	.description("Browser context tool for agentic web app improvement")
	.version("0.1.0");

program
	.command("open <url>")
	.description("Launch interactive browser with element picker")
	.action(async (url: string) => {
		try {
			// Electron must be spawned as a child process when called from Node CLI
			const { spawn } = await import("node:child_process");
			const electronPath = path.resolve(import.meta.dirname, "../node_modules/.bin/electron");
			const mainPath = path.resolve(import.meta.dirname, "../electron/main.cjs");
			const child = spawn(electronPath, [mainPath, url], {
				stdio: "inherit",
				env: { ...process.env },
			});
			child.on("exit", (code) => {
				process.exitCode = code ?? 0;
			});
		} catch (err) {
			console.error("Failed to launch browser:", err);
			process.exitCode = 1;
		}
	});

program
	.command("screenshot <url>")
	.description("Take a screenshot of a URL")
	.option("-o, --output <path>", "Output file path", "screenshot.png")
	.option("--full-page", "Capture full page", false)
	.option("--selector <sel>", "Capture specific element")
	.action(async (url: string, opts: { output: string; fullPage: boolean; selector?: string }) => {
		try {
			const result = await runHeadless(url, async (backend) => {
				return backend.takeScreenshot({
					fullPage: opts.fullPage,
					selector: opts.selector,
				});
			});
			const outPath = path.resolve(opts.output);
			fs.writeFileSync(outPath, result.data);
			console.log(`Screenshot saved: ${outPath} (${result.width}x${result.height})`);
		} catch (err) {
			console.error("Screenshot failed:", err);
			process.exitCode = 1;
		}
	});

program
	.command("click <url> <selector>")
	.description("Click an element on a page")
	.action(async (url: string, selector: string) => {
		try {
			await runHeadless(url, async (backend) => {
				await backend.clickElement(selector);
				console.log(`Clicked: ${selector}`);
			});
		} catch (err) {
			console.error("Click failed:", err);
			process.exitCode = 1;
		}
	});

program
	.command("type <url> <selector> <text>")
	.description("Type text into an element")
	.action(async (url: string, selector: string, text: string) => {
		try {
			await runHeadless(url, async (backend) => {
				await backend.typeInElement(selector, text);
				console.log(`Typed "${text}" into ${selector}`);
			});
		} catch (err) {
			console.error("Type failed:", err);
			process.exitCode = 1;
		}
	});

program
	.command("context <url>")
	.description("Dump interactive elements and page context as JSON")
	.action(async (url: string) => {
		try {
			const result = await runHeadless(url, async (backend) => {
				const elements = await backend.listInteractiveElements();
				const ctx = backend.state.getPageContext();
				return { ...ctx, interactiveElements: elements };
			});
			console.log(JSON.stringify(result, null, 2));
		} catch (err) {
			console.error("Context dump failed:", err);
			process.exitCode = 1;
		}
	});

program
	.command("serve")
	.description("Start MCP server (stdio transport)")
	.option("--url <url>", "Initial URL to navigate to")
	.action(async (opts: { url?: string }) => {
		try {
			const { createElectronBackend } = await import("../core/backend.js");
			const { startMcpServer } = await import("../mcp/server.js");
			const backend = await createElectronBackend(opts.url, true);
			await startMcpServer(backend);
		} catch (err) {
			console.error("MCP server failed:", err);
			process.exitCode = 1;
		}
	});

program
	.command("logs <url>")
	.description("Dump console logs from a page")
	.option("--level <level>", "Filter by level (log, warn, error, info, debug)")
	.option("--limit <n>", "Max entries to return", "100")
	.action(async (url: string, opts: { level?: string; limit: string }) => {
		try {
			const result = await runHeadless(url, async (backend) => {
				// Wait briefly for page to emit console messages
				await new Promise((resolve) => setTimeout(resolve, 2000));
				return backend.getConsoleLogs({
					level: opts.level,
					limit: Number(opts.limit),
				});
			});
			console.log(JSON.stringify(result, null, 2));
		} catch (err) {
			console.error("Logs failed:", err);
			process.exitCode = 1;
		}
	});

program
	.command("network <url>")
	.description("Dump network traffic from a page")
	.option("--filter <pattern>", "Filter by URL or MIME type")
	.option("--limit <n>", "Max entries to return", "100")
	.action(async (url: string, opts: { filter?: string; limit: string }) => {
		try {
			const result = await runHeadless(url, async (backend) => {
				// Wait briefly for network requests to complete
				await new Promise((resolve) => setTimeout(resolve, 3000));
				return backend.getNetworkLog({
					filter: opts.filter,
					limit: Number(opts.limit),
				});
			});
			console.log(JSON.stringify(result, null, 2));
		} catch (err) {
			console.error("Network log failed:", err);
			process.exitCode = 1;
		}
	});

/**
 * Helper: launch Electron in headless mode, run an action, then quit.
 */
async function runHeadless<T>(
	url: string,
	action: (backend: import("../mcp/server.js").BrowserBackend) => Promise<T>,
): Promise<T> {
	const { createElectronBackend } = await import("../core/backend.js");
	const backend = await createElectronBackend(url, true);
	try {
		return await action(backend);
	} finally {
		const { app } = await import("electron");
		app.quit();
	}
}

program.parse();
