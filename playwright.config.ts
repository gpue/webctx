import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "test/e2e",
	timeout: 30_000,
	retries: 1,
	use: {
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "electron",
			testMatch: "**/*.e2e.ts",
		},
	],
});
