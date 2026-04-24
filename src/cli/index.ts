#!/usr/bin/env node

/**
 * webctx CLI — agent-ready command-line interface.
 *
 * Commands:
 *   open <url>         Launch the interactive browser
 *   screenshot <url>   Take a screenshot
 *   click <url> <sel>  Click an element
 *   context <url>      Dump interactive elements as JSON
 *   serve              Start MCP server (stdio)
 */

import { Command } from "commander";

const program = new Command();

program
	.name("webctx")
	.description("Browser context tool for agentic web app improvement")
	.version("0.1.0");

program
	.command("open <url>")
	.description("Launch interactive browser with element picker")
	.action((_url: string) => {
		// TODO: launch Electron
		console.log("Not implemented yet");
		process.exitCode = 1;
	});

program
	.command("screenshot <url>")
	.description("Take a screenshot of a URL")
	.option("-o, --output <path>", "Output file path", "screenshot.png")
	.option("--full-page", "Capture full page", false)
	.option("--selector <sel>", "Capture specific element")
	.action((_url: string, _opts: Record<string, unknown>) => {
		// TODO: implement
		console.log("Not implemented yet");
		process.exitCode = 1;
	});

program
	.command("click <url> <selector>")
	.description("Click an element on a page")
	.action((_url: string, _selector: string) => {
		// TODO: implement
		console.log("Not implemented yet");
		process.exitCode = 1;
	});

program
	.command("context <url>")
	.description("Dump interactive elements as JSON context")
	.action((_url: string) => {
		// TODO: implement
		console.log("Not implemented yet");
		process.exitCode = 1;
	});

program
	.command("serve")
	.description("Start MCP server (stdio transport)")
	.action(async () => {
		const { startServer } = await import("../mcp/server.js");
		await startServer();
	});

program.parse();
