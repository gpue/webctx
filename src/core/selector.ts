import type { BoundingBox } from "./types.js";

/**
 * Generate a unique CSS selector for a DOM element.
 * Uses a combination of ID, class, and nth-child strategies.
 */
export function generateCssSelector(element: MinimalElement): string {
	// If element has an ID, use it directly
	if (element.id) {
		return `#${cssEscape(element.id)}`;
	}

	const parts: string[] = [];
	let current: MinimalElement | null = element;

	while (current && current.tagName.toLowerCase() !== "html") {
		let selector = current.tagName.toLowerCase();

		if (current.id) {
			selector = `#${cssEscape(current.id)}`;
			parts.unshift(selector);
			break;
		}

		// Try unique class combination
		const uniqueClass = findUniqueClass(current);
		if (uniqueClass) {
			selector += `.${cssEscape(uniqueClass)}`;
		} else if (current.parentElement) {
			const index = getNthChildIndex(current);
			if (index > 0) {
				selector += `:nth-child(${index})`;
			}
		}

		parts.unshift(selector);
		current = current.parentElement;
	}

	return parts.join(" > ");
}

/**
 * Generate an XPath expression for a DOM element.
 */
export function generateXPath(element: MinimalElement): string {
	if (element.id) {
		return `//*[@id="${element.id}"]`;
	}

	const parts: string[] = [];
	let current: MinimalElement | null = element;

	while (current && current.tagName.toLowerCase() !== "html") {
		const tag = current.tagName.toLowerCase();
		const index = getXPathIndex(current);
		parts.unshift(`${tag}[${index}]`);
		current = current.parentElement;
	}

	parts.unshift("/html");
	return `/${parts.join("/")}`;
}

/**
 * Extract a bounding box from a DOMRect-like object.
 */
export function extractBoundingBox(rect: {
	x: number;
	y: number;
	width: number;
	height: number;
}): BoundingBox {
	return {
		x: Math.round(rect.x),
		y: Math.round(rect.y),
		width: Math.round(rect.width),
		height: Math.round(rect.height),
	};
}

// -- Internal helpers --

/**
 * Minimal interface representing a DOM element for selector generation.
 * Allows unit testing without a real DOM.
 */
export interface MinimalElement {
	tagName: string;
	id: string;
	className: string;
	parentElement: MinimalElement | null;
	children: MinimalElement[];
}

function cssEscape(value: string): string {
	return value.replace(/([#.,:;[\]()>+~"'\\=^$|!@&{}*/%?<>`\s])/g, "\\$1");
}

function findUniqueClass(element: MinimalElement): string | null {
	if (!element.className || !element.parentElement) return null;

	const classes = element.className.split(/\s+/).filter(Boolean);
	const siblings = element.parentElement.children;

	for (const cls of classes) {
		const matchCount = siblings.filter(
			(s) => s !== element && s.className.split(/\s+/).includes(cls),
		).length;
		if (matchCount === 0) return cls;
	}

	return null;
}

function getNthChildIndex(element: MinimalElement): number {
	if (!element.parentElement) return 0;
	const siblings = element.parentElement.children;
	let index = 0;
	for (const sibling of siblings) {
		index++;
		if (sibling === element) return index;
	}
	return 0;
}

function getXPathIndex(element: MinimalElement): number {
	if (!element.parentElement) return 1;
	const tag = element.tagName.toLowerCase();
	const siblings = element.parentElement.children.filter((s) => s.tagName.toLowerCase() === tag);
	let index = 0;
	for (const sibling of siblings) {
		index++;
		if (sibling === element) return index;
	}
	return 1;
}
