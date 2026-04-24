import type { ElementContext, PageContext } from "./types.js";

/**
 * In-memory state manager for the current browser session.
 * Tracks selected elements, current URL, and page metadata.
 */
export class StateManager {
	private selectedElements: Map<string, ElementContext> = new Map();
	private currentUrl = "";
	private currentTitle = "";

	/** Add an element to the selection. Deduplicates by CSS selector. */
	select(element: ElementContext): void {
		this.selectedElements.set(element.cssSelector, element);
	}

	/** Remove an element from the selection by its CSS selector. */
	deselect(cssSelector: string): boolean {
		return this.selectedElements.delete(cssSelector);
	}

	/** Clear all selections. */
	clearSelection(): void {
		this.selectedElements.clear();
	}

	/** Check if an element is selected. */
	isSelected(cssSelector: string): boolean {
		return this.selectedElements.has(cssSelector);
	}

	/** Get all selected elements. */
	getSelection(): ElementContext[] {
		return Array.from(this.selectedElements.values());
	}

	/** Get the count of selected elements. */
	get selectionCount(): number {
		return this.selectedElements.size;
	}

	/** Update the current page info. */
	setPage(url: string, title: string): void {
		this.currentUrl = url;
		this.currentTitle = title;
	}

	/** Build the full page context snapshot for agents. */
	getPageContext(): PageContext {
		return {
			url: this.currentUrl,
			title: this.currentTitle,
			selectedElements: this.getSelection(),
			timestamp: Date.now(),
		};
	}

	/** Reset all state. */
	reset(): void {
		this.clearSelection();
		this.currentUrl = "";
		this.currentTitle = "";
	}
}
