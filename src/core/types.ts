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
	/** Source file location from framework debug metadata (dev mode only) */
	sourceLocation?: SourceLocation;
	/** Component ancestor chain from nearest to root, e.g. ["NavItem", "Sidebar", "App"] */
	componentChain?: string[];
	/** Framework-specific metadata extracted from internal data structures */
	frameworkInfo?: FrameworkInfo;
}

/** Source file location resolved from framework debug metadata. */
export interface SourceLocation {
	/** File path (relative to bundler root, e.g. "src/components/NavItem.tsx") */
	fileName: string;
	/** Line number (1-indexed) */
	lineNumber: number;
	/** Column number (0-indexed) */
	columnNumber?: number;
}

/** Framework detection result with component-level details. */
export interface FrameworkInfo {
	framework: "react" | "vue" | "svelte" | "unknown";
	/** Nearest component name, e.g. "NavItem" */
	componentName?: string;
	/** Component props (serializable subset) */
	props?: Record<string, unknown>;
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

/**
 * Console log entry captured from the target page.
 */
export interface ConsoleEntry {
	/** Log level: log, warn, error, info, debug */
	level: string;
	/** Message text */
	message: string;
	/** Source file URL */
	source: string;
	/** Line number in source */
	line: number;
	/** Timestamp (ms since epoch) */
	timestamp: number;
}

/**
 * Network request entry captured from the target page.
 */
export interface NetworkEntry {
	/** Request URL */
	url: string;
	/** HTTP method */
	method: string;
	/** HTTP status code (0 if failed) */
	status: number;
	/** Response MIME type */
	mimeType: string;
	/** Response size in bytes (-1 if unknown) */
	size: number;
	/** Duration in milliseconds (-1 if unknown) */
	duration: number;
	/** Timestamp (ms since epoch) */
	timestamp: number;
	/** Error message if the request failed */
	error?: string;
}
