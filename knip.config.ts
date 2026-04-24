import type { KnipConfig } from "knip";

const config: KnipConfig = {
	entry: ["src/cli/index.ts", "src/mcp/server.ts", "electron/main.ts"],
	project: ["src/**/*.ts", "electron/**/*.ts"],
	ignore: ["dist/**"],
	ignoreDependencies: ["electron"],
};

export default config;
