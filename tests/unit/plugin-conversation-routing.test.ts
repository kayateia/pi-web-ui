/**
 * Channel conversation routing: a transport plugin's conversation must keep
 * one durable identity even when several clients hold the same session.
 */
import { describe, expect, it, vi } from "vitest";
import { AgentService } from "../../server/agent-service-daemon.js";

type FakeConv = { id: string; cwd: string; session: { sessionId: string; sessionFile?: string } };

function makeOwner(conv: FakeConv) {
	return {
		getConversation: vi.fn((id: string) => (id === conv.id ? conv : undefined)),
		findConversationBySessionId: vi.fn((sessionId: string) =>
			conv.session.sessionId === sessionId ? conv : undefined,
		),
		readConversationForPlugins: vi.fn(() => ({ conversationId: conv.id })),
		markPluginRun: vi.fn(() => conv.id),
		prompt: vi.fn().mockResolvedValue(undefined),
		switchModelOrThrow: vi.fn().mockResolvedValue(undefined),
		setThinking: vi.fn(),
		setConversationIndependent: vi.fn(),
		ensureConversationForPlugins: vi.fn(),
	};
}

function service(clients: Map<string, any>) {
	const svc = Object.create(AgentService.prototype) as any;
	svc.clients = clients;
	svc.attach = vi.fn(async (clientId: string) => clients.get(clientId));
	return svc;
}

describe("plugin conversation routing", () => {
	it("delivers through one owner when several clients hold the same durable session", async () => {
		const convA = { id: "c1", cwd: process.cwd(), session: { sessionId: "sdk-session-dup" } };
		const convB = { id: "c1", cwd: process.cwd(), session: { sessionId: "sdk-session-dup" } };
		const ownerA = makeOwner(convA);
		const ownerB = makeOwner(convB);
		const svc = service(
			new Map<string, any>([
				["browser-a", ownerA],
				["browser-b", ownerB],
			]),
		);

		const receipt = await svc.chatFromPlugin("signal", {
			accountId: "peer",
			text: "hi",
			conversationId: "c1",
			sessionId: "sdk-session-dup",
			strictConversationId: true,
		});

		expect(receipt).toMatchObject({ conversationId: "c1", sessionId: "sdk-session-dup", clientId: "browser-a" });
		expect(ownerA.prompt).toHaveBeenCalledWith("hi", undefined, false, convA);
		expect(ownerB.prompt).not.toHaveBeenCalled();
	});

	it("recovers a binding whose local conversation id was renamed", async () => {
		const conv = { id: "c9", cwd: process.cwd(), session: { sessionId: "sdk-session-moved" } };
		const owner = makeOwner(conv);
		const svc = service(new Map([["browser-a", owner]]));

		const receipt = await svc.chatFromPlugin("signal", {
			accountId: "peer",
			text: "hi",
			conversationId: "c1",
			sessionId: "sdk-session-moved",
			strictConversationId: true,
		});

		expect(receipt.conversationId).toBe("c9");
		expect(owner.prompt).toHaveBeenCalledWith("hi", undefined, false, conv);
	});

	it("still refuses to guess when two different sessions share a local id", async () => {
		const convA = { id: "c1", cwd: process.cwd(), session: { sessionId: "sdk-session-a" } };
		const convB = { id: "c1", cwd: process.cwd(), session: { sessionId: "sdk-session-b" } };
		const ownerA = makeOwner(convA);
		const ownerB = makeOwner(convB);
		const svc = service(
			new Map<string, any>([
				["browser-a", ownerA],
				["browser-b", ownerB],
			]),
		);

		await expect(
			svc.chatFromPlugin("signal", {
				accountId: "peer",
				text: "hi",
				conversationId: "c1",
				sessionId: "sdk-session-gone",
			}),
		).rejects.toThrow(/ambiguous/);
		expect(ownerA.prompt).not.toHaveBeenCalled();
		expect(ownerB.prompt).not.toHaveBeenCalled();
	});

	it("routes a reopen request to the client that already holds the session file", async () => {
		const ensure = vi.fn().mockResolvedValue({ ok: true, conversationId: "c3", sessionId: "sdk-session-3" });
		const owner = { ensureConversationForPlugins: ensure };
		const svc = Object.create(AgentService.prototype) as any;
		svc.clients = new Map([["browser-a", owner]]);
		svc.findSessionOwner = vi.fn(() => ({ clientId: "browser-a", convId: "c3" }));
		svc.attach = vi.fn();

		const result = await svc.ensurePluginConversation("signal", {
			key: "group:x",
			sessionFile: "/sessions/channel.jsonl",
		});

		expect(result).toEqual({ ok: true, conversationId: "c3", sessionId: "sdk-session-3" });
		expect(svc.attach).not.toHaveBeenCalled();
		expect(ensure).toHaveBeenCalledWith("signal", expect.objectContaining({ key: "group:x" }));
	});

	it("hosts a new channel conversation in a per-plugin pseudo client", async () => {
		const ensure = vi.fn().mockResolvedValue({ ok: true, conversationId: "c1", sessionId: "sdk-session-1" });
		const pseudo = { ensureConversationForPlugins: ensure };
		const svc = Object.create(AgentService.prototype) as any;
		svc.clients = new Map();
		svc.findSessionOwner = vi.fn(() => null);
		svc.attach = vi.fn(async () => pseudo);

		const result = await svc.ensurePluginConversation("signal", { key: "group:x" });

		expect(result).toEqual({ ok: true, conversationId: "c1", sessionId: "sdk-session-1" });
		expect(svc.attach).toHaveBeenCalledWith("plugin:signal:channels", expect.any(Function));
	});
});
