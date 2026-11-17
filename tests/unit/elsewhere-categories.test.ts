/**
 * Elsewhere rows must carry the shared conversation category so channel
 * conversations hosted by headless pseudo clients can be categorized from a
 * browser tab (the only place a human can right-click them).
 */
import { describe, expect, it, vi } from "vitest";
import { AgentService } from "../../server/agent-service-daemon.js";

type Summary = {
	title: string;
	cwd: string;
	isStreaming: boolean;
	convId: string;
	independent: boolean;
	hasQuestion: boolean;
	sessionFile?: string;
	activity: number;
};

function listRows(clients: Map<string, unknown>, categoryId?: string) {
	const svc = Object.create(AgentService.prototype) as any;
	svc.clients = clients;
	svc.offlineSince = new Map();
	svc.stateStore = {
		getConversationCategoryId: vi.fn(() => categoryId),
	};
	return svc.listExternalRunning("browser") as Array<Record<string, unknown>>;
}

function owner(summary: Summary) {
	return {
		streamingSummariesAll: () => [summary],
		sinkCount: () => 1,
	};
}

const channelSummary: Summary = {
	title: "Aria-Feathers",
	cwd: "/home/node",
	isStreaming: false,
	convId: "c2",
	independent: true,
	hasQuestion: false,
	sessionFile: "/tmp/channel-session.jsonl",
	activity: 1_000,
};

describe("elsewhere conversation categories", () => {
	it("exposes the category assigned by session path for pseudo channel rows", () => {
		const rows = listRows(
			new Map<string, unknown>([
				["browser", { takeoverBriefs: () => [] }],
				["plugin:signal:channels", owner(channelSummary)],
			]),
			"cat-work",
		);

		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			title: "Aria-Feathers",
			owner: "plugin:signal:channels",
			pseudo: true,
			sessionFile: "/tmp/channel-session.jsonl",
			categoryId: "cat-work",
		});
	});

	it("looks the category up by durable path and omits it when unassigned", () => {
		const svcClients = new Map<string, unknown>([
			["browser", { takeoverBriefs: () => [] }],
			["plugin:matrix:channels", owner({ ...channelSummary, sessionFile: "/tmp/matrix.jsonl" })],
		]);
		const svc = Object.create(AgentService.prototype) as any;
		svc.clients = svcClients;
		svc.offlineSince = new Map();
		svc.stateStore = { getConversationCategoryId: vi.fn(() => undefined) };

		const [row] = svc.listExternalRunning("browser") as Array<Record<string, unknown>>;

		expect(svc.stateStore.getConversationCategoryId).toHaveBeenCalledWith(undefined, "/tmp/matrix.jsonl");
		expect(row).not.toHaveProperty("categoryId");
	});

	it("keeps categories on ordinary browser rows too", () => {
		const rows = listRows(
			new Map<string, unknown>([
				["browser", { takeoverBriefs: () => [] }],
				["browser-b", owner({ ...channelSummary, sessionFile: "/tmp/plain.jsonl" })],
			]),
			"cat-personal",
		);

		expect(rows[0]).toMatchObject({ categoryId: "cat-personal", owner: "browser-b" });
	});
});
