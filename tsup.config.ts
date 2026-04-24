import { defineConfig } from "tsup";

export default defineConfig([
	// Main source (core, MCP server, CLI)
	{
		entry: {
			"cli/index": "src/cli/index.ts",
			"mcp/server": "src/mcp/server.ts",
			"core/index": "src/core/index.ts",
			"core/state": "src/core/state.ts",
			"core/selector": "src/core/selector.ts",
			"core/screenshot": "src/core/screenshot.ts",
			"core/backend": "src/core/backend.ts",
			"core/types": "src/core/types.ts",
		},
		outDir: "dist",
		format: "esm",
		target: "node20",
		sourcemap: true,
		clean: true,
		splitting: false,
		external: ["electron"],
	},
	// Electron process files (CJS required by Electron, .js extension for compatibility)
	{
		entry: {
			"electron/main": "electron/main.ts",
			"electron/toolbarPreload": "electron/toolbarPreload.ts",
			"electron/viewPreload": "electron/viewPreload.ts",
		},
		outDir: "dist",
		format: "cjs",
		target: "node20",
		sourcemap: true,
		splitting: false,
		external: ["electron"],
		outExtension: () => ({ js: ".js" }),
	},
	// Picker bundle (IIFE for injection into web pages)
	{
		entry: {
			"electron/pickerBundle": "electron/picker.ts",
		},
		outDir: "dist",
		format: "iife",
		target: "es2022",
		sourcemap: false,
		splitting: false,
		minify: true,
		outExtension: () => ({ js: ".js" }),
	},
]);
