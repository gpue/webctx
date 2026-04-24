# webctx

Browser-based element selection, click automation, and screenshotting tool for agentic web app improvement.

webctx gives AI agents and developers a way to **see**, **select**, and **interact** with web pages — then extract structured context (selectors, bounding boxes, HTML snippets, framework metadata) that can feed back into code generation and debugging workflows.

## Features

- **Interactive browser** — Electron app with BaseWindow + WebContentsView architecture, dark Catppuccin Mocha theme
- **Element picker** — Hover to highlight, click to select, shift+click for multi-select. Persistent green overlays with selector labels.
- **Framework metadata** — Auto-detects React, Vue, and Svelte components. Extracts source location, component chain, and serializable props.
- **Context sidebar** — Right panel showing a chronological list of selected elements and screenshots. Hover an item to highlight it on the page. "To Shell" button generates a markdown prompt and pastes it into the terminal.
- **Embedded terminal** — xterm.js + node-pty panel for running commands without leaving the browser
- **Embedded DevTools** — Chrome DevTools panel toggled from the toolbar
- **Favorites bar** — Bookmarkable pages with favicon, persisted to disk
- **Selector generation** — Unique CSS selectors (id > data-testid > unique class > nth-child) and XPath for every selected element
- **Screenshots** — Viewport, full-page, or single-element capture as PNG
- **Console log capture** — Ring buffer (1000 entries), filterable by level
- **Network traffic capture** — Via Chrome DevTools Protocol, tracks request/response/failure with duration
- **Context HTTP server** — `http://localhost:24842` serving `/context`, `/screenshot/:id`, `/console`, `/network` with CORS
- **MCP server** — 10 tools over stdio for any MCP-compatible agent or IDE
- **CLI** — Commands for scripting and CI pipelines

## Installation

```bash
git clone https://github.com/gpue/webctx.git && cd webctx
npm install
npm run build
```

Requires **Node.js >= 20**.

## Usage

### Interactive browser

```bash
npx webctx open https://example.com
```

**Toolbar controls:**

| Button | Action |
|--------|--------|
| ← → | Back / Forward |
| ↻ | Reload |
| URL bar | Type a URL or search term, press Enter |
| ☆ | Bookmark current page |
| Picker | Toggle element picker (blue = active, opens sidebar) |
| Terminal | Toggle embedded terminal panel |
| Settings | Toggle Chrome DevTools panel |

**Picker interaction:**

| Action | Effect |
|--------|--------|
| Hover | Blue highlight overlay + tooltip showing `tag#id.class` |
| Click | Select element (added to sidebar context list) |
| Shift+Click | Add element to multi-selection |
| Shift+Click (selected) | Deselect element |
| Escape | Dismiss picker |

**Sidebar actions:**

| Button | Action |
|--------|--------|
| Screenshot | Capture viewport screenshot, added to context list |
| To Shell | Generate markdown prompt from context and paste into terminal |
| Clear All | Remove all context items |
| Hover item | Blue highlight overlay on the target page |
| × on item | Remove individual item |

### CLI

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

# View console logs
npx webctx logs https://example.com --level error --limit 50

# View network traffic
npx webctx network https://example.com --limit 20
```

### MCP server

```bash
npx webctx serve
npx webctx serve --url https://example.com
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
| `webctx_console_logs` | Get captured console log entries |
| `webctx_network_log` | Get captured network traffic entries |

#### MCP configuration

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

### Context HTTP server

Runs automatically on `http://localhost:24842` when the Electron app is open.

| Endpoint | Description |
|----------|-------------|
| `GET /context` | Current page context with all selected elements |
| `GET /screenshot/:id` | Retrieve a screenshot by ID |
| `GET /console` | Console log entries (`?level=error&limit=50`) |
| `GET /network` | Network traffic entries (`?limit=20`) |

## Context format

```json
{
  "cssSelector": "#login-form > button.btn-primary",
  "xpath": "/html/body[1]/main[1]/form[1]/button[1]",
  "tagName": "button",
  "textContent": "Log In",
  "attributes": { "type": "submit", "class": "btn btn-primary" },
  "boundingBox": { "x": 120, "y": 340, "width": 80, "height": 36 },
  "htmlSnippet": "<button type=\"submit\" class=\"btn btn-primary\">Log In</button>",
  "framework": {
    "name": "react",
    "componentChain": ["LoginForm", "Button"],
    "sourceLocation": "src/components/LoginForm.tsx:42",
    "props": { "variant": "primary", "disabled": false }
  }
}
```

The `framework` field is only present when React, Vue, or Svelte is detected on the page.

## Layout

```
┌──────────────────────────────────────────────────────────┐
│                         toolbar                           │
├────────────────────────────────────────────────────────────┤
│                       favorites bar                       │
├──────────────────────────┬──────────────┬────────────────┤
│                          │   context    │                │
│      target page         │  (sidebar)   │   terminal     │
│                          │  resizable ↔ │  resizable ↔   │
│──────────────────────────│              │                │
│      devtools (optional) │              │                │
└──────────────────────────┴──────────────┴────────────────┘
```

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

### Quality tools

| Tool | Purpose |
|------|---------|
| [Vitest](https://vitest.dev) | Unit tests (38 tests, 80% coverage threshold) |
| [Playwright](https://playwright.dev) | E2E tests via `_electron` API |
| [Biome](https://biomejs.dev) | Linting and formatting |
| TypeScript `--noEmit` | Strict mode type checking |
| [Lefthook](https://github.com/evilmartians/lefthook) | Git hooks (pre-commit: biome + typecheck, pre-push: tests) |
| [Knip](https://knip.dev) | Dead code and unused dependency detection |

## License

MIT
