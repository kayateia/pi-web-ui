import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClientStateStore } from "../../server/client-state.js";

const dirs: string[] = [];

function storeFile(): string {
	const dir = mkdtempSync(join(tmpdir(), "piweb-categories-"));
	dirs.push(dir);
	return join(dir, "client-state.json");
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("conversation category persistence", () => {
	it("creates normalized categories in stable order and rejects duplicate names", () => {
		const store = new ClientStateStore(storeFile());
		const work = store.createConversationCategory("  Work   notes ");
		const personal = store.createConversationCategory("Personal");

		expect(work).toMatchObject({ name: "Work notes", order: 0 });
		expect(personal).toMatchObject({ name: "Personal", order: 1 });
		expect(store.createConversationCategory("work NOTES")).toBeNull();
		expect(store.getConversationCategories()).toEqual([work, personal]);
	});

	it("renames without losing assignment and deletes back to Uncategorized", () => {
		const path = storeFile();
		const store = new ClientStateStore(path);
		const work = store.createConversationCategory("Work");
		if (!work) throw new Error("category was not created");
		expect(store.renameConversationCategory(work.id, "Projects")).toMatchObject({
			id: work.id,
			name: "Projects",
		});

		store.setConversationCategoryId("session-123", "/tmp/example.jsonl", work.id);
		expect(store.getConversationCategoryId("session-123")).toBe(work.id);
		expect(store.getConversationCategoryId(undefined, "/tmp/example.jsonl")).toBe(work.id);

		const restarted = new ClientStateStore(path);
		expect(restarted.getConversationCategoryId("session-123", "/tmp/example.jsonl")).toBe(work.id);
		expect(restarted.deleteConversationCategory(work.id)).toBe(true);
		expect(restarted.getConversationCategories()).toEqual([]);
		expect(restarted.getConversationCategoryId("session-123", "/tmp/example.jsonl")).toBeUndefined();
	});

	it("cleans assignments when their session disappears", () => {
		const store = new ClientStateStore(storeFile());
		const category = store.createConversationCategory("Research");
		if (!category) throw new Error("category was not created");
		store.setConversationCategoryId("session-clean", "/tmp/clean.jsonl", category.id);

		store.cleanConversationCategoryAssignment("session-clean", "/tmp/clean.jsonl");

		expect(store.getConversationCategoryId("session-clean", "/tmp/clean.jsonl")).toBeUndefined();
		expect(store.getConversationCategories()).toEqual([category]);
	});
});
