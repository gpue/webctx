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

	// ── Build context for an element ───────────────────────────────────

	function buildContext(el: Element) {
		const rect = el.getBoundingClientRect();
		const attrs: Record<string, string> = {};
		for (const attr of el.attributes) {
			attrs[attr.name] = attr.value;
		}
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

		if (e.shiftKey && selectedSelectors.has(selector)) {
			// Deselect
			selectedSelectors.delete(selector);
			removeSelectedOverlay(selector);
			window.__webctx?.elementDeselected(selector);
		} else {
			// Select (shift = add, no shift = replace)
			if (!e.shiftKey) {
				for (const sel of selectedSelectors) {
					removeSelectedOverlay(sel);
					window.__webctx?.elementDeselected(sel);
				}
				selectedSelectors.clear();
			}

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

	// ── Setup ──────────────────────────────────────────────────────────

	document.addEventListener("mousemove", onMouseMove, true);
	document.addEventListener("click", onClick, true);
	document.addEventListener("keydown", onKeyDown, true);
	window.addEventListener("scroll", updateOverlayPositions, true);
	window.addEventListener("resize", updateOverlayPositions, true);

	function cleanup(): void {
		window.__webctxPickerActive = false;
		document.removeEventListener("mousemove", onMouseMove, true);
		document.removeEventListener("click", onClick, true);
		document.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("scroll", updateOverlayPositions, true);
		window.removeEventListener("resize", updateOverlayPositions, true);
		hoverOverlay.remove();
		tooltip.remove();
		for (const overlay of selectedOverlays.values()) overlay.remove();
		selectedOverlays.clear();
		selectedSelectors.clear();
	}

	window.__webctxPickerCleanup = cleanup;
})();
