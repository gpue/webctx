import { beforeEach, describe, expect, it } from "vitest";
import { StateManager } from "../../src/core/state.js";
import type { ElementContext } from "../../src/core/types.js";

function makeElement(overrides: Partial<ElementContext> = {}): ElementContext {
	return {
		cssSelector: "#test-element",
		xpath: '//*[@id="test-element"]',
		tagName: "button",
		textContent: "Click me",
		attributes: { id: "test-element", type: "button" },
		boundingBox: { x: 10, y: 20, width: 100, height: 40 },
		htmlSnippet: '<button id="test-element">Click me</button>',
		...overrides,
	};
}

describe("StateManager", () => {
	let state: StateManager;

	beforeEach(() => {
		state = new StateManager();
	});

	describe("select / deselect", () => {
		it("adds an element to the selection", () => {
			const el = makeElement();
			state.select(el);
			expect(state.selectionCount).toBe(1);
			expect(state.getSelection()).toEqual([el]);
		});

		it("deduplicates by CSS selector", () => {
			const el = makeElement();
			state.select(el);
			state.select(el);
			expect(state.selectionCount).toBe(1);
		});

		it("supports multiple distinct selections", () => {
			state.select(makeElement({ cssSelector: "#a" }));
			state.select(makeElement({ cssSelector: "#b" }));
			state.select(makeElement({ cssSelector: "#c" }));
			expect(state.selectionCount).toBe(3);
		});

		it("removes an element by CSS selector", () => {
			state.select(makeElement({ cssSelector: "#a" }));
			state.select(makeElement({ cssSelector: "#b" }));
			const removed = state.deselect("#a");
			expect(removed).toBe(true);
			expect(state.selectionCount).toBe(1);
		});

		it("returns false when deselecting a non-existent selector", () => {
			expect(state.deselect("#nonexistent")).toBe(false);
		});
	});

	describe("clearSelection", () => {
		it("removes all selections", () => {
			state.select(makeElement({ cssSelector: "#a" }));
			state.select(makeElement({ cssSelector: "#b" }));
			state.clearSelection();
			expect(state.selectionCount).toBe(0);
			expect(state.getSelection()).toEqual([]);
		});
	});

	describe("isSelected", () => {
		it("returns true for selected elements", () => {
			state.select(makeElement({ cssSelector: "#a" }));
			expect(state.isSelected("#a")).toBe(true);
		});

		it("returns false for non-selected elements", () => {
			expect(state.isSelected("#a")).toBe(false);
		});
	});

	describe("setPage / getPageContext", () => {
		it("returns full page context snapshot", () => {
			state.setPage("https://example.com", "Example");
			state.select(makeElement());

			const ctx = state.getPageContext();
			expect(ctx.url).toBe("https://example.com");
			expect(ctx.title).toBe("Example");
			expect(ctx.selectedElements).toHaveLength(1);
			expect(ctx.timestamp).toBeGreaterThan(0);
		});

		it("returns empty selection when nothing is selected", () => {
			state.setPage("https://example.com", "Example");
			const ctx = state.getPageContext();
			expect(ctx.selectedElements).toEqual([]);
		});
	});

	describe("reset", () => {
		it("clears all state", () => {
			state.setPage("https://example.com", "Example");
			state.select(makeElement());
			state.reset();

			const ctx = state.getPageContext();
			expect(ctx.url).toBe("");
			expect(ctx.title).toBe("");
			expect(ctx.selectedElements).toEqual([]);
		});
	});
});
