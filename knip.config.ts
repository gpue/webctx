import type { KnipConfig } from "knip";

const config: KnipConfig = {
	entry: [
		"src/cli/index.ts",
		"src/mcp/server.ts",
		"electron/main.ts",
		"src/core/backend.ts",
		"electron/terminalPreload.ts",
	],
	project: ["src/**/*.ts", "electron/**/*.ts"],
	ignore: ["dist/**"],
	ignoreDependencies: ["electron", "@xterm/xterm", "@xterm/addon-fit"],
};

export default config;
