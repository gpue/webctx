/**
 * Represents a selected element's context — the core data structure
 * that agents consume to understand what's on the page.
 */
export interface ElementContext {
	/** Unique CSS selector for this element */
	cssSelector: string;
	/** XPath selector as fallback */
	xpath: string;
	/** Element tag name (lowercase) */
	tagName: string;
	/** Element's visible text content (trimmed, max 500 chars) */
	textContent: string;
	/** All HTML attributes */
	attributes: Record<string, string>;
	/** Bounding box relative to viewport */
	boundingBox: BoundingBox;
	/** Outer HTML snippet (max 2000 chars) */
	htmlSnippet: string;
}

export interface BoundingBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Full page context returned to agents via MCP or CLI.
 */
export interface PageContext {
	url: string;
	title: string;
	selectedElements: ElementContext[];
	timestamp: number;
}

/**
 * Screenshot result with optional metadata.
 */
export interface ScreenshotResult {
	/** PNG buffer */
	data: Buffer;
	/** Width in pixels */
	width: number;
	/** Height in pixels */
	height: number;
	/** Elements that were highlighted in the screenshot (if annotated) */
	annotatedElements: ElementContext[];
}

/**
 * Options for taking a screenshot.
 */
export interface ScreenshotOptions {
	/** Capture full page or just the viewport */
	fullPage?: boolean;
	/** If set, capture only this element */
	selector?: string;
	/** Overlay selection highlights on the screenshot */
	annotate?: boolean;
}

/**
 * Navigation options.
 */
export interface NavigateOptions {
	url: string;
	waitUntil?: "load" | "domcontentloaded" | "networkidle";
	timeout?: number;
}
