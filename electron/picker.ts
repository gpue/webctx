/**
 * Element picker — injected into the target page via executeJavaScript.
 *
 * This is a self-contained IIFE that:
 * 1. Adds a hover overlay that follows the mouse
 * 2. On click, selects the element (generates context, highlights it)
 * 3. On shift+click, adds to multi-selection
 * 4. Communicates selections back via window.__webctx bridge
 *
 * Calling window.__webctxPickerCleanup() removes all picker artifacts.
 */

/* eslint-disable */

interface WebctxBridge {
	elementSelected: (ctx: unknown) => void;
	elementDeselected: (selector: string) => void;
}

declare global {
	interface Window {
		__webctxPickerActive?: boolean;
		__webctxPickerCleanup?: () => void;
		__webctxPickerDeselect?: (selector: string) => void;
		__webctxPickerClearAll?: () => void;
		__webctxPickerHide?: () => void;
		__webctxPickerShow?: () => void;
		__webctx?: WebctxBridge;
	}
}

(function webctxPicker() {
	// Avoid double-injection
	if (window.__webctxPickerActive) return;
	window.__webctxPickerActive = true;

	const HIGHLIGHT_COLOR = "rgba(59, 130, 246, 0.3)";
	const HIGHLIGHT_BORDER = "rgba(59, 130, 246, 0.8)";
	const SELECTED_COLOR = "rgba(34, 197, 94, 0.25)";
	const SELECTED_BORDER = "rgba(34, 197, 94, 0.8)";

	// ── Overlay elements ───────────────────────────────────────────────

	const hoverOverlay = document.createElement("div");
	hoverOverlay.id = "__webctx-hover";
	Object.assign(hoverOverlay.style, {
		position: "fixed",
		pointerEvents: "none",
		zIndex: "2147483646",
		background: HIGHLIGHT_COLOR,
		border: `2px solid ${HIGHLIGHT_BORDER}`,
		borderRadius: "2px",
		transition: "all 0.08s ease-out",
		display: "none",
	});
	document.documentElement.appendChild(hoverOverlay);

	const tooltip = document.createElement("div");
	tooltip.id = "__webctx-tooltip";
	Object.assign(tooltip.style, {
		position: "fixed",
		pointerEvents: "none",
		zIndex: "2147483647",
		background: "#1e1e2e",
		color: "#cdd6f4",
		padding: "3px 8px",
		borderRadius: "4px",
		fontSize: "11px",
		fontFamily: "monospace",
		whiteSpace: "nowrap",
		display: "none",
		boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
	});
	document.documentElement.appendChild(tooltip);

	// Track selected element overlays
	const selectedOverlays = new Map<string, HTMLDivElement>();

	// ── Selector generation (inline, no imports) ───────────────────────

	/** Try to produce a short, unique selector segment for a single element. */
	function selectorSegment(el: Element): { segment: string; terminal: boolean } {
		if (el.id) {
			return { segment: `#${CSS.escape(el.id)}`, terminal: true };
		}
		const testId = el.getAttribute("data-testid");
		if (testId) {
			return { segment: `[data-testid="${CSS.escape(testId)}"]`, terminal: true };
		}
		let seg = el.tagName.toLowerCase();
		const uniqueClass = findUniqueClassForElement(el);
		if (uniqueClass) {
			seg += `.${CSS.escape(uniqueClass)}`;
		} else {
			const idx = getChildIndex(el);
			if (idx > 0) seg += `:nth-child(${idx})`;
		}
		return { segment: seg, terminal: false };
	}

	function generateSelector(el: Element): string {
		if (el.id) return `#${CSS.escape(el.id)}`;

		const parts: string[] = [];
		let current: Element | null = el;

		while (current && current !== document.documentElement) {
			const { segment, terminal } = selectorSegment(current);
			parts.unshift(segment);
			if (terminal) break;
			current = current.parentElement;
		}

		return parts.join(" > ");
	}

	function findUniqueClassForElement(el: Element): string | null {
		if (!el.classList.length || !el.parentElement) return null;
		const siblings = Array.from(el.parentElement.children);
		for (const cls of el.classList) {
			if (cls.startsWith("__webctx")) continue;
			const count = siblings.filter((s) => s !== el && s.classList.contains(cls)).length;
			if (count === 0) return cls;
		}
		return null;
	}

	function getChildIndex(el: Element): number {
		if (!el.parentElement) return 0;
		const children = Array.from(el.parentElement.children);
		return children.indexOf(el) + 1;
	}

	function generateXPathForElement(el: Element): string {
		if (el.id) return `//*[@id="${el.id}"]`;
		const parts: string[] = [];
		let current: Element | null = el;
		while (current && current !== document.documentElement) {
			const tag = current.tagName.toLowerCase();
			const siblings = current.parentElement
				? Array.from(current.parentElement.children).filter((s) => s.tagName.toLowerCase() === tag)
				: [current];
			const idx = siblings.indexOf(current) + 1;
			parts.unshift(`${tag}[${idx}]`);
			current = current.parentElement;
		}
		parts.unshift("/html");
		return `/${parts.join("/")}`;
	}

	// ── Framework metadata extraction ─────────────────────────────────

	interface SourceLoc {
		fileName: string;
		lineNumber: number;
		columnNumber?: number;
	}

	interface FrameworkMeta {
		framework: "react" | "vue" | "svelte" | "unknown";
		componentName?: string;
		componentChain?: string[];
		sourceLocation?: SourceLoc;
		props?: Record<string, unknown>;
	}

	/** Get a React fiber from a DOM node (React 16+). */
	function getReactFiber(node: Element): Record<string, unknown> | null {
		for (const key of Object.keys(node)) {
			if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
				return (node as unknown as Record<string, Record<string, unknown>>)[key] ?? null;
			}
		}
		return null;
	}

	/** Extract a component name from a React fiber type. */
	function getReactComponentName(type: unknown): string | undefined {
		if (typeof type === "function") {
			const fn = type as { displayName?: string; name?: string };
			const name = fn.displayName || fn.name;
			return name && !name.startsWith("_") ? name : undefined;
		}
		// ForwardRef wraps in an object with render function
		if (type && typeof type === "object") {
			const render = (type as Record<string, unknown>).render;
			if (typeof render === "function") {
				const fn = render as { displayName?: string; name?: string };
				return fn.displayName || fn.name || undefined;
			}
		}
		return undefined;
	}

	/** Extract _debugSource from a fiber node. */
	function getReactDebugSource(fiber: Record<string, unknown>): SourceLoc | undefined {
		const ds = fiber._debugSource;
		if (!ds || typeof ds !== "object") return undefined;
		const src = ds as Record<string, unknown>;
		if (typeof src.fileName !== "string" || typeof src.lineNumber !== "number") return undefined;
		return {
			fileName: src.fileName as string,
			lineNumber: src.lineNumber as number,
			columnNumber: typeof src.columnNumber === "number" ? (src.columnNumber as number) : undefined,
		};
	}

	interface FiberWalkResult {
		chain: string[];
		sourceLocation?: SourceLoc;
		componentName?: string;
		props?: Record<string, unknown>;
	}

	/** Process a single React fiber node for component info. */
	function processReactFiber(fiber: Record<string, unknown>, result: FiberWalkResult): void {
		const name = getReactComponentName(fiber.type);
		if (name) {
			result.chain.push(name);
			if (!result.componentName) {
				result.componentName = name;
				result.props = extractPropsFromNode(fiber, "memoizedProps");
			}
		}
		if (!result.sourceLocation) {
			result.sourceLocation = getReactDebugSource(fiber);
		}
	}

	/** Walk React fiber tree upward to collect component names and source. */
	function extractReactMeta(node: Element): FrameworkMeta | null {
		const fiber = getReactFiber(node);
		if (!fiber) return null;

		const result: FiberWalkResult = { chain: [] };
		let current: Record<string, unknown> | null = fiber;
		while (current) {
			processReactFiber(current, result);
			current = (current.return as Record<string, unknown>) ?? null;
		}

		if (!result.componentName && result.chain.length === 0) return null;
		return {
			framework: "react",
			componentName: result.componentName,
			componentChain: result.chain.length > 0 ? result.chain : undefined,
			sourceLocation: result.sourceLocation,
			props: result.props,
		};
	}

	/** Extract Vue component name and file from a component options object. */
	function getVueComponentInfo(opts: Record<string, unknown>): {
		name?: string;
		file?: string;
	} {
		const name =
			(opts.name as string | undefined) ??
			(opts.__name as string | undefined) ??
			(opts.displayName as string | undefined);
		const file = typeof opts.__file === "string" ? (opts.__file as string) : undefined;
		return { name, file };
	}

	/** Extract serializable props from a component node if available. */
	function extractPropsFromNode(
		node: Record<string, unknown>,
		key: string,
	): Record<string, unknown> | undefined {
		const p = node[key];
		if (p && typeof p === "object") {
			return serializeProps(p as Record<string, unknown>);
		}
		return undefined;
	}

	/** Process a single Vue component instance node. */
	function processVueNode(node: Record<string, unknown>, result: FiberWalkResult): void {
		const type = node.type ?? node.$options;
		if (!type || typeof type !== "object") return;
		const info = getVueComponentInfo(type as Record<string, unknown>);
		if (info.name) {
			result.chain.push(info.name);
			if (!result.componentName) {
				result.componentName = info.name;
				result.props = extractPropsFromNode(node, "props");
			}
		}
		if (!result.sourceLocation && info.file) {
			result.sourceLocation = { fileName: info.file, lineNumber: 1 };
		}
	}

	/** Get Vue component instance from a DOM node. */
	function extractVueMeta(node: Element): FrameworkMeta | null {
		const vueInstance =
			(node as unknown as Record<string, unknown>).__vueParentComponent ??
			(node as unknown as Record<string, unknown>).__vue__;
		if (!vueInstance) return null;

		const result: FiberWalkResult = { chain: [] };
		let current: Record<string, unknown> | null = vueInstance as Record<string, unknown>;
		while (current) {
			processVueNode(current, result);
			current = (current.parent ?? current.$parent ?? null) as Record<string, unknown> | null;
		}

		if (!result.componentName && result.chain.length === 0) return null;
		return {
			framework: "vue",
			componentName: result.componentName,
			componentChain: result.chain.length > 0 ? result.chain : undefined,
			sourceLocation: result.sourceLocation,
			props: result.props,
		};
	}

	/** Get Svelte component metadata from a DOM node. */
	function extractSvelteMeta(node: Element): FrameworkMeta | null {
		// Svelte 4+: __svelte_meta
		const meta = (node as unknown as Record<string, unknown>).__svelte_meta;
		if (!meta) {
			// Svelte 5 / older: walk up to find __svelte_meta on ancestors
			let parent: Element | null = node.parentElement;
			while (parent) {
				const m = (parent as unknown as Record<string, unknown>).__svelte_meta;
				if (m) {
					return parseSvelteMeta(m as Record<string, unknown>);
				}
				parent = parent.parentElement;
			}
			return null;
		}
		return parseSvelteMeta(meta as Record<string, unknown>);
	}

	function parseSvelteMeta(meta: Record<string, unknown>): FrameworkMeta | null {
		const loc = meta.loc as Record<string, unknown> | undefined;
		let sourceLocation: SourceLoc | undefined;
		if (loc && typeof loc.file === "string") {
			sourceLocation = {
				fileName: loc.file as string,
				lineNumber: typeof loc.line === "number" ? (loc.line as number) : 1,
				columnNumber: typeof loc.column === "number" ? (loc.column as number) : undefined,
			};
		}
		return {
			framework: "svelte",
			sourceLocation,
		};
	}

	/** Check if a value is JSON-serializable for props extraction. */
	function isSerializablePrimitive(val: unknown): boolean {
		return (
			val === null ||
			val === undefined ||
			typeof val === "string" ||
			typeof val === "number" ||
			typeof val === "boolean"
		);
	}

	/** Check if an array contains only serializable primitives. */
	function isSerializableArray(val: unknown[]): boolean {
		return val.length <= 10 && val.every((v) => typeof v !== "function" && typeof v !== "object");
	}

	/** Serialize props, keeping only JSON-safe values. */
	function serializeProps(raw: Record<string, unknown>): Record<string, unknown> {
		const result: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(raw)) {
			if (key === "children" || key === "ref" || key.startsWith("__")) continue;
			if (isSerializablePrimitive(val)) {
				result[key] = val;
			} else if (Array.isArray(val) && isSerializableArray(val)) {
				result[key] = val;
			}
		}
		return result;
	}

	/** Try all frameworks and return the first match. */
	function extractFrameworkMeta(node: Element): FrameworkMeta | null {
		return extractReactMeta(node) ?? extractVueMeta(node) ?? extractSvelteMeta(node) ?? null;
	}

	// ── Build context for an element ───────────────────────────────────

	function buildContext(el: Element) {
		const rect = el.getBoundingClientRect();
		const attrs: Record<string, string> = {};
		for (const attr of el.attributes) {
			attrs[attr.name] = attr.value;
		}

		const meta = extractFrameworkMeta(el);

		return {
			cssSelector: generateSelector(el),
			xpath: generateXPathForElement(el),
			tagName: el.tagName.toLowerCase(),
			textContent: (el.textContent || "").trim().slice(0, 500),
			attributes: attrs,
			boundingBox: {
				x: Math.round(rect.x),
				y: Math.round(rect.y),
				width: Math.round(rect.width),
				height: Math.round(rect.height),
			},
			htmlSnippet: el.outerHTML.slice(0, 2000),
			sourceLocation: meta?.sourceLocation,
			componentChain: meta?.componentChain,
			frameworkInfo: meta
				? {
						framework: meta.framework,
						componentName: meta.componentName,
						props: meta.props,
					}
				: undefined,
		};
	}

	// ── Highlight a selected element ───────────────────────────────────

	function addSelectedOverlay(selector: string, rect: DOMRect): void {
		if (selectedOverlays.has(selector)) return;

		const overlay = document.createElement("div");
		overlay.className = "__webctx-selected";
		Object.assign(overlay.style, {
			position: "fixed",
			left: `${rect.x}px`,
			top: `${rect.y}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`,
			pointerEvents: "none",
			zIndex: "2147483645",
			background: SELECTED_COLOR,
			border: `2px solid ${SELECTED_BORDER}`,
			borderRadius: "2px",
		});

		// Label
		const label = document.createElement("div");
		Object.assign(label.style, {
			position: "absolute",
			top: "-18px",
			left: "0",
			background: SELECTED_BORDER,
			color: "#fff",
			padding: "1px 6px",
			borderRadius: "3px 3px 0 0",
			fontSize: "10px",
			fontFamily: "monospace",
			whiteSpace: "nowrap",
		});
		label.textContent = selector.length > 40 ? `${selector.slice(0, 37)}...` : selector;
		overlay.appendChild(label);

		document.documentElement.appendChild(overlay);
		selectedOverlays.set(selector, overlay);
	}

	function removeSelectedOverlay(selector: string): void {
		const overlay = selectedOverlays.get(selector);
		if (overlay) {
			overlay.remove();
			selectedOverlays.delete(selector);
		}
	}

	// ── Update overlay positions on scroll/resize ──────────────────────

	function updateOverlayPositions(): void {
		for (const [selector, overlay] of selectedOverlays) {
			const el = document.querySelector(selector);
			if (!el) {
				overlay.remove();
				selectedOverlays.delete(selector);
				continue;
			}
			const rect = el.getBoundingClientRect();
			Object.assign(overlay.style, {
				left: `${rect.x}px`,
				top: `${rect.y}px`,
				width: `${rect.width}px`,
				height: `${rect.height}px`,
			});
		}
	}

	// ── Event handlers ─────────────────────────────────────────────────

	const selectedSelectors = new Set<string>();

	function isPickerElement(el: Element): boolean {
		const id = el.id || "";
		return id.startsWith("__webctx") || el.classList.contains("__webctx-selected");
	}

	function onMouseMove(e: MouseEvent): void {
		const target = e.target as Element;
		if (!target || isPickerElement(target)) return;

		const rect = target.getBoundingClientRect();

		Object.assign(hoverOverlay.style, {
			display: "block",
			left: `${rect.x}px`,
			top: `${rect.y}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`,
		});

		const tag = target.tagName.toLowerCase();
		const id = target.id ? `#${target.id}` : "";
		const cls =
			target.className && typeof target.className === "string"
				? `.${target.className
						.split(/\s+/)
						.filter((c) => !c.startsWith("__webctx"))
						.slice(0, 2)
						.join(".")}`
				: "";
		tooltip.textContent = `${tag}${id}${cls}`;
		Object.assign(tooltip.style, {
			display: "block",
			left: `${Math.min(rect.x, window.innerWidth - 200)}px`,
			top: `${Math.max(rect.y - 24, 4)}px`,
		});
	}

	function onClick(e: MouseEvent): void {
		const target = e.target as Element;
		if (!target || isPickerElement(target)) return;

		e.preventDefault();
		e.stopPropagation();

		const ctx = buildContext(target);
		const selector = ctx.cssSelector;

		if (selectedSelectors.has(selector)) {
			// Shift+click or re-click to deselect
			selectedSelectors.delete(selector);
			removeSelectedOverlay(selector);
			window.__webctx?.elementDeselected(selector);
		} else {
			// Click always adds to selection
			selectedSelectors.add(selector);
			addSelectedOverlay(selector, target.getBoundingClientRect());
			window.__webctx?.elementSelected(ctx);
		}
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (e.key === "Escape") {
			cleanup();
		}
	}

	function onMouseLeave(): void {
		hoverOverlay.style.display = "none";
		tooltip.style.display = "none";
	}

	// ── Setup ──────────────────────────────────────────────────────────

	document.addEventListener("mousemove", onMouseMove, true);
	document.addEventListener("click", onClick, true);
	document.addEventListener("keydown", onKeyDown, true);
	document.documentElement.addEventListener("mouseleave", onMouseLeave);
	window.addEventListener("scroll", updateOverlayPositions, true);
	window.addEventListener("resize", updateOverlayPositions, true);

	function cleanup(): void {
		window.__webctxPickerActive = false;
		document.removeEventListener("mousemove", onMouseMove, true);
		document.removeEventListener("click", onClick, true);
		document.removeEventListener("keydown", onKeyDown, true);
		document.documentElement.removeEventListener("mouseleave", onMouseLeave);
		window.removeEventListener("scroll", updateOverlayPositions, true);
		window.removeEventListener("resize", updateOverlayPositions, true);
		hoverOverlay.remove();
		tooltip.remove();
		for (const overlay of selectedOverlays.values()) overlay.remove();
		selectedOverlays.clear();
		selectedSelectors.clear();
	}

	window.__webctxPickerCleanup = cleanup;

	/** Allow external code (main process) to deselect an element by selector. */
	window.__webctxPickerDeselect = (selector: string) => {
		if (selectedSelectors.has(selector)) {
			selectedSelectors.delete(selector);
			removeSelectedOverlay(selector);
		}
	};

	/** Allow external code to clear all selections without disabling the picker. */
	window.__webctxPickerClearAll = () => {
		for (const sel of selectedSelectors) {
			removeSelectedOverlay(sel);
		}
		selectedSelectors.clear();
	};

	/** Temporarily hide all picker overlays (for clean screenshots). */
	window.__webctxPickerHide = () => {
		hoverOverlay.style.display = "none";
		tooltip.style.display = "none";
		for (const overlay of selectedOverlays.values()) {
			overlay.style.display = "none";
		}
	};

	/** Restore picker overlays after hiding. */
	window.__webctxPickerShow = () => {
		for (const overlay of selectedOverlays.values()) {
			overlay.style.display = "block";
		}
	};
})();
