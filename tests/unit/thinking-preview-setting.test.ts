// @vitest-environment jsdom

/**
 * Quiet thinking mode: the collapsed block must not render reasoning text until
 * the user explicitly expands it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThinkingBlock } from "../../web/src/components/ThinkingBlock.js";
import { LanguageProvider } from "../../web/src/i18n.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function mount(thinking: string, previewEnabled: boolean, streaming = false): HTMLDivElement {
	const container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => {
		root!.render(
			createElement(
				LanguageProvider,
				null,
				createElement(ThinkingBlock, {
					thinking,
					streaming,
					wrap: false,
					previewEnabled,
				}),
			),
		);
	});
	return container;
}

function toggle(container: HTMLDivElement): void {
	const button = container.querySelector<HTMLButtonElement>(".thinking-toggle");
	if (!button) throw new Error("thinking toggle not found");
	act(() => {
		button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
}

afterEach(() => {
	if (root) act(() => root!.unmount());
	root = null;
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

describe("quiet collapsed thinking", () => {
	it("renders no reasoning text or marquee while collapsed", () => {
		const secret = "private chain of thought that must stay hidden";
		const container = mount(secret, false);

		expect(container.textContent).not.toContain(secret);
		expect(container.querySelector(".thinking-preview-track")).toBeNull();
		expect(container.querySelector(".thinking-summary-text")).toBeNull();
		expect(container.querySelector(".thinking-body")).toBeNull();
		expect(container.querySelector(".thinking-status")).not.toBeNull();
		expect(container.querySelector(".thinking-toggle")).not.toBeNull();
	});

	it("reveals the full reasoning after the user expands the block", () => {
		const thinking = "First inspect the files\nThen make the change";
		const container = mount(thinking, false);

		toggle(container);

		expect(container.querySelector(".thinking-body")?.textContent).toContain("First inspect the files");
		expect(container.querySelector(".thinking-body")?.textContent).toContain("Then make the change");
	});

	it("keeps the active-state indicator without a live preview", () => {
		const container = mount("Streaming reasoning", false, true);

		expect(container.querySelector(".thinking-live-label")).not.toBeNull();
		expect(container.querySelector(".thinking-preview-live")).toBeNull();
		expect(container.querySelector(".thinking-preview-track")).toBeNull();
	});

	it("preserves the summary preview when the option stays enabled", () => {
		const container = mount("Visible collapsed summary", true);

		expect(container.querySelector(".thinking-summary-text")?.textContent).toContain("Visible collapsed summary");
		expect(container.querySelector(".thinking-body")).toBeNull();
	});
});
