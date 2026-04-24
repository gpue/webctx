# AGENTS.md

This file provides context for AI agents working on the webctx codebase.

## Project overview

webctx is a browser-based element selection, click automation, and screenshotting tool designed to generate structured context for agentic web app improvement. It runs as an Electron application with an MCP server and CLI interface.

An agent navigates to a page, selects elements (interactively or programmatically), and receives back structured JSON context (CSS selectors, XPath, bounding boxes, attributes, HTML snippets) that can inform code generation and debugging.

## Tech stack

- **Runtime**: Electron (single engine for both interactive and headless modes)
- **Language**: TypeScript (strict mode, ES2022 target)
- **Build**: tsup (ESM for core/CLI, CJS for Electron main/preload, IIFE for picker injection)
- **Package manager**: npm
- **Node version**: >= 20

## Architecture

```
electron/          Electron main process, preloads, picker injection script
  main.ts          Window management, BrowserView, IPC handlers, navigation
  picker.ts        Self-contained IIFE injected into target pages for element selection
  toolbarPreload.ts  contextBridge for toolbar window
  viewPreload.ts     contextBridge for target page BrowserView
  toolbar.html       Toolbar UI rendered in the main window

src/core/          Core logic, decoupled from Electron where possible
  types.ts         Shared interfaces (ElementContext, PageContext, BoundingBox, etc.)
  state.ts         In-memory state manager for selections and page metadata
  selector.ts      CSS selector and XPath generation from MinimalElement interface
  screenshot.ts    Screenshot capture via Electron webContents
  backend.ts       BrowserBackend adapter bridging Electron APIs to MCP/CLI

src/mcp/           MCP server
  server.ts        8 tools over stdio transport, depends on BrowserBackend interface

src/cli/           CLI entry point
  index.ts         commander-based CLI wrapping the backend

test/unit/         Vitest unit tests
test/e2e/          Playwright E2E tests using the _electron API
test/fixtures/     Static HTML pages for deterministic testing
```

### Key design decisions

- **BrowserBackend interface** (`src/mcp/server.ts`): The MCP server and CLI depend on an abstract `BrowserBackend` interface, not Electron directly. This makes the server logic unit-testable with mock backends.
- **Picker is a standalone IIFE** (`electron/picker.ts`): Built as a self-contained bundle injected via `executeJavaScript`. It has its own selector generation logic (duplicated from `src/core/selector.ts` intentionally) because it runs in the target page context without access to Node.js modules.
- **CJS for Electron files**: Electron's main process requires CommonJS. The `tsup.config.ts` outputs `.js` extensions (not `.cjs`) via `outExtension` for compatibility with Electron's module loader.
- **State is in-memory only**: The `StateManager` does not persist across sessions. This is intentional for v1 simplicity.

## Code quality gates

All of the following must pass before code is merged. They are enforced by Lefthook git hooks and the CI workflow.

### Type checking

```bash
npm run typecheck    # tsc --noEmit
```

TypeScript is configured with strict mode and additional strictness flags:
- `noUnusedLocals`, `noUnusedParameters`
- `noFallthroughCasesInSwitch`
- `noUncheckedIndexedAccess`
- `isolatedModules`

### Linting and formatting

```bash
npm run lint         # biome check .
npm run lint:fix     # biome check --write .
```

Biome v2.4 handles both linting and formatting in a single tool. Key rules:
- `noExcessiveCognitiveComplexity`: max 15
- `noUnusedImports`, `noUnusedVariables`: error
- `useConst`, `useNodejsImportProtocol`: error
- `noExplicitAny`: warn
- Import organization is enforced (auto-sorted)
- Indentation: tabs, line width: 100

### Unit tests

```bash
npm test             # vitest run
npm run test:watch   # vitest (watch mode)
npm run test:coverage # vitest run --coverage
```

Coverage thresholds enforced at **80%** for lines, functions, branches, and statements. Current test suites:

| Suite | What it covers |
|-------|---------------|
| `state.test.ts` | StateManager: select, deselect, clear, multi-select, page context |
| `selector.test.ts` | CSS selector and XPath generation, bounding box extraction |
| `screenshot.test.ts` | Screenshot capture with mock webContents |
| `mcp-server.test.ts` | MCP server creation and backend integration |

### E2E tests

```bash
npm run test:e2e     # playwright test
```

Uses Playwright's `_electron` API to launch the actual Electron app and interact with it. Requires `npm run build` first.

### Dead code detection

```bash
npm run deadcode     # knip
```

Knip detects unused files, exports, and dependencies. Entry points are configured in `knip.config.ts`.

### Git hooks (Lefthook)

| Hook | Checks |
|------|--------|
| `pre-commit` | Biome lint/format on staged files + `tsc --noEmit` (parallel) |
| `pre-push` | Full test suite |

### Combined quality command

```bash
npm run quality      # typecheck + lint + test (all three, sequential)
```

## How to add a new MCP tool

1. Define the tool in `src/mcp/server.ts` using `server.tool()` with a zod schema for parameters
2. Add the corresponding method to the `BrowserBackend` interface in the same file
3. Implement the method in `src/core/backend.ts` (Electron adapter) and `electron/main.ts` (actual logic)
4. Add a unit test in `test/unit/mcp-server.test.ts` using the mock backend
5. Add a CLI command in `src/cli/index.ts` if the tool should be callable from the command line
6. Update the README tools table

## How to modify the picker

The picker (`electron/picker.ts`) is injected into target web pages as a bundled IIFE. It cannot import Node.js modules or project source files. All logic must be self-contained within the IIFE.

After modifying the picker, rebuild with `npm run build` — tsup will produce `dist/electron/pickerBundle.js` which the main process reads and injects at runtime.

Keep cognitive complexity under 15 per function (enforced by Biome). Extract helper functions within the IIFE scope if needed.

## Commit conventions

- Use imperative mood: "Add feature" not "Added feature"
- Prefix maintenance commits with `chore:`
- The nightly release workflow skips commits containing `[skip ci]`
