import { describe, expect, it } from "vitest";
import {
	extractBoundingBox,
	generateCssSelector,
	generateXPath,
	type MinimalElement,
} from "../../src/core/selector.js";

function makeEl(overrides: Partial<MinimalElement> & { tagName: string }): MinimalElement {
	return {
		id: "",
		className: "",
		parentElement: null,
		children: [],
		...overrides,
	};
}

/**
 * Build a simple DOM tree for testing:
 *   html > body > parent > [child1, child2, child3]
 */
function buildTree() {
	const html = makeEl({ tagName: "HTML" });
	const body = makeEl({ tagName: "BODY", parentElement: html });
	html.children = [body];

	const parent = makeEl({ tagName: "DIV", id: "container", parentElement: body });
	body.children = [parent];

	const child1 = makeEl({ tagName: "SPAN", className: "item first", parentElement: parent });
	const child2 = makeEl({ tagName: "SPAN", className: "item", parentElement: parent });
	const child3 = makeEl({ tagName: "SPAN", className: "item last", parentElement: parent });
	parent.children = [child1, child2, child3];

	return { html, body, parent, child1, child2, child3 };
}

describe("generateCssSelector", () => {
	it("uses ID when available", () => {
		const el = makeEl({ tagName: "DIV", id: "main" });
		expect(generateCssSelector(el)).toBe("#main");
	});

	it("generates nth-child path for elements without unique identifiers", () => {
		const { child2 } = buildTree();
		const selector = generateCssSelector(child2);
		// Should reference the parent's ID and use nth-child
		expect(selector).toContain("#container");
		expect(selector).toContain("nth-child(2)");
	});

	it("uses unique class when available", () => {
		const { child1 } = buildTree();
		const selector = generateCssSelector(child1);
		// "first" is unique among siblings
		expect(selector).toContain(".first");
	});

	it("escapes special characters in IDs", () => {
		const el = makeEl({ tagName: "DIV", id: "my.element:1" });
		const selector = generateCssSelector(el);
		expect(selector).toContain("\\.");
		expect(selector).toContain("\\:");
	});
});

describe("generateXPath", () => {
	it("uses ID shortcut when available", () => {
		const el = makeEl({ tagName: "DIV", id: "main" });
		expect(generateXPath(el)).toBe('//*[@id="main"]');
	});

	it("generates indexed path for nested elements", () => {
		const { child2 } = buildTree();
		const xpath = generateXPath(child2);
		expect(xpath).toMatch(/\/html.*span\[2\]/);
	});
});

describe("extractBoundingBox", () => {
	it("rounds coordinates", () => {
		const box = extractBoundingBox({ x: 10.7, y: 20.3, width: 100.5, height: 40.9 });
		expect(box).toEqual({ x: 11, y: 20, width: 101, height: 41 });
	});

	it("handles zero dimensions", () => {
		const box = extractBoundingBox({ x: 0, y: 0, width: 0, height: 0 });
		expect(box).toEqual({ x: 0, y: 0, width: 0, height: 0 });
	});
});
