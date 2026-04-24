# webctx

Browser-based element selection, click automation, and screenshotting tool for agentic web app improvement.

webctx gives AI agents and developers a way to **see**, **select**, and **interact** with web pages — then extract structured context (selectors, bounding boxes, HTML snippets) that can feed back into code generation and debugging workflows.

## Features

- **Interactive browser** — Electron window with a target page view and a toolbar for navigation
- **Element picker** — Hover to highlight, click to select, shift+click for multi-select. Selected elements get persistent overlays with selector labels.
- **Selector generation** — Produces unique CSS selectors (id > data-testid > unique class > nth-child) and XPath for every selected element
- **Context extraction** — For each selection: CSS selector, XPath, tag name, text content, all attributes, bounding box, and an HTML snippet
- **Screenshots** — Viewport, full-page, or single-element capture as PNG
- **MCP server** — 8 tools exposed over stdio for any MCP-compatible agent or IDE
- **CLI** — Headless commands for scripting and CI pipelines

## Installation

```bash
git clone <repo-url> && cd webctx
npm install
npm run build
```

Requires **Node.js >= 20**.

## Usage

### Interactive browser

```bash
# Launch with a URL
npx webctx open https://example.com

# Or after building
npm start -- https://example.com
```

**Toolbar controls:**

| Button | Action |
|--------|--------|
| `◀` `▶` | Back / Forward |
| `↻` | Reload |
| URL bar | Type a URL and press Enter to navigate |
| `☷` | Toggle element picker (blue = active) |
| Badge | Shows count of selected elements |
| `✕` | Clear all selections |
| `☑` | Take a screenshot |

**Picker interaction:**

| Action | Effect |
|--------|--------|
| Hover | Blue highlight overlay + tooltip showing `tag#id.class` |
| Click | Select element (replaces previous selection) |
| Shift+Click | Add element to multi-selection |
| Shift+Click (selected) | Deselect element |
| Escape | Dismiss picker |

Selected elements are shown with a green overlay and a label displaying their CSS selector.

### CLI

All commands work headlessly — no visible window needed.

```bash
# Take a screenshot
npx webctx screenshot https://example.com -o page.png
npx webctx screenshot https://example.com --selector "#hero" -o hero.png
npx webctx screenshot https://example.com --full-page -o full.png

# Click an element
npx webctx click https://example.com "button.submit"

# Type into an input
npx webctx type https://example.com "#search" "query text"

# Dump all interactive elements as JSON
npx webctx context https://example.com
```

The `context` command outputs JSON with all interactive elements (links, buttons, inputs, etc.) including their selectors, text content, attributes, and bounding boxes — ready to be consumed by an agent.

### MCP server

Start the stdio-based MCP server for integration with IDEs and agents:

```bash
npx webctx serve
npx webctx serve --url https://example.com  # pre-navigate
```

**Available tools:**

| Tool | Description |
|------|-------------|
| `webctx_navigate` | Navigate the browser to a URL |
| `webctx_screenshot` | Capture a screenshot (viewport, full page, or element) |
| `webctx_select` | Select an element by CSS selector |
| `webctx_click` | Click an element |
| `webctx_type` | Type text into an input element |
| `webctx_get_context` | Get current page state and all selected elements |
| `webctx_list_elements` | List all interactive elements on the page |
| `webctx_pick` | Enable/disable the interactive element picker |

#### MCP configuration example

```json
{
  "mcpServers": {
    "webctx": {
      "command": "npx",
      "args": ["webctx", "serve"]
    }
  }
}
```

## Context format

When an element is selected (via picker, CLI, or MCP), the returned context looks like this:

```json
{
  "cssSelector": "#login-form > button.btn-primary",
  "xpath": "/html/body[1]/main[1]/form[1]/button[1]",
  "tagName": "button",
  "textContent": "Log In",
  "attributes": {
    "type": "submit",
    "class": "btn btn-primary"
  },
  "boundingBox": {
    "x": 120,
    "y": 340,
    "width": 80,
    "height": 36
  },
  "htmlSnippet": "<button type=\"submit\" class=\"btn btn-primary\">Log In</button>"
}
```

The full page context (`webctx_get_context` / `webctx context`) includes the URL, title, timestamp, and an array of all selected elements in this format.

## Development

```bash
npm run dev          # Launch Electron in dev mode
npm run build        # Build all targets (ESM, CJS, IIFE)
npm test             # Run unit tests (Vitest)
npm run test:e2e     # Run E2E tests (Playwright + Electron)
npm run test:coverage # Unit tests with coverage report
npm run lint         # Biome lint + format check
npm run lint:fix     # Auto-fix lint/format issues
npm run typecheck    # TypeScript type checking
npm run quality      # Run typecheck + lint + tests
npm run deadcode     # Detect unused code with Knip
```

### Architecture

```
electron/
  main.ts             Electron main process, IPC handlers, window management
  toolbar.html        Toolbar UI (URL bar, navigation, picker toggle)
  toolbarPreload.ts   contextBridge for toolbar <-> main IPC
  viewPreload.ts      contextBridge for target page <-> main IPC
  picker.ts           Element picker (injected IIFE: hover, select, overlay)
src/
  core/
    types.ts          Shared type definitions (ElementContext, PageContext, etc.)
    state.ts          In-memory state manager for selections and page info
    selector.ts       CSS selector and XPath generation from DOM elements
    screenshot.ts     Screenshot capture via Electron webContents
    backend.ts        BrowserBackend adapter bridging Electron to MCP/CLI
  mcp/
    server.ts         MCP server with 8 tools, stdio transport
  cli/
    index.ts          CLI entry point (commander)
test/
  unit/               Unit tests (state, selector, screenshot, MCP server)
  e2e/                E2E tests (Playwright with Electron)
  fixtures/           Static HTML pages for deterministic testing
```

### Quality tools

| Tool | Purpose |
|------|---------|
| [Vitest](https://vitest.dev) | Unit tests |
| [Playwright](https://playwright.dev) | E2E tests via `_electron` API |
| [Biome](https://biomejs.dev) | Linting and formatting |
| TypeScript `--noEmit` | Type checking |
| [Lefthook](https://github.com/evilmartians/lefthook) | Git hooks (pre-commit: biome + typecheck, pre-push: tests) |
| [Knip](https://knip.dev) | Dead code and unused dependency detection |

## License

MIT
