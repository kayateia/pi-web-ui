/**
 * host.conversations.ensure(): transport plugins may create visible background
 * conversations without switching the browser's active chat.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	PluginManager,
	type PluginConversationEnsureRequest,
	type PluginConversationEnsureResult,
	type PluginHost,
} from "../../server/plugins.js";

describe("host.conversations.ensure", () => {
	let dir: string;
	let mgr: PluginManager;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "plugin-conversation-ensure-"));
		mgr = new PluginManager(dir, dir);
	});

	afterEach(() => {
		mgr.dispose();
		rmSync(dir, { recursive: true, force: true });
		delete (globalThis as Record<string, unknown>).__ensureHost;
	});

	function installPlugin(id: string, permissions: string[]): void {
		const pluginDir = join(dir, "plugins", id);
		mkdirSync(pluginDir, { recursive: true });
		writeFileSync(join(pluginDir, "manifest.json"), JSON.stringify({ name: id, permissions }));
		writeFileSync(
			join(pluginDir, "index.mjs"),
			"export default { activate(host) { globalThis.__ensureHost = host; } };",
		);
	}

	async function host(): Promise<PluginHost> {
		await mgr.ensureLoaded();
		const value = (globalThis as Record<string, unknown>).__ensureHost as PluginHost | undefined;
		expect(value).toBeDefined();
		return value!;
	}

	it("passes the plugin identity and normalized channel profile to the host", async () => {
		installPlugin("signal", ["chat"]);
		let gotPlugin = "";
		let gotRequest: PluginConversationEnsureRequest | undefined;
		mgr.conversationEnsurer = async (pluginId, request) => {
			gotPlugin = pluginId;
			gotRequest = request;
			return { ok: true, conversationId: "c7", sessionFile: "/sessions/signal.jsonl" };
		};

		const result = await (
			await host()
		).conversations.ensure({
			key: "group:abc",
			title: "Signal · Family",
			cwd: "/workspace",
			preset: "standard",
			systemPrompt: "You are the family room bot.",
			systemPromptMode: "replace",
			enabledSkills: ["calendar"],
			enabledExtensions: ["npm:pi-calendar"],
			sessionFile: "/sessions/signal.jsonl",
			model: "openai/gpt-5",
			thinkingLevel: "low",
		});

		expect(result).toEqual({
			ok: true,
			conversationId: "c7",
			sessionFile: "/sessions/signal.jsonl",
		});
		expect(gotPlugin).toBe("signal");
		expect(gotRequest).toEqual({
			key: "group:abc",
			title: "Signal · Family",
			cwd: "/workspace",
			preset: "standard",
			systemPrompt: "You are the family room bot.",
			systemPromptMode: "replace",
			enabledSkills: ["calendar"],
			enabledExtensions: ["npm:pi-calendar"],
			sessionFile: "/sessions/signal.jsonl",
			model: "openai/gpt-5",
			thinkingLevel: "low",
		});
	});

	it("fails closed without chat capability or a host implementation", async () => {
		installPlugin("nochat", ["tools"]);
		let called = false;
		mgr.conversationEnsurer = async () => {
			called = true;
			return { ok: true, conversationId: "c1" };
		};
		const denied = await (await host()).conversations.ensure({ key: "dm:a" });
		expect(denied.ok).toBe(false);
		expect(denied.error).toMatch(/chat/);
		expect(called).toBe(false);

		installPlugin("signal2", ["chat"]);
		mgr.conversationEnsurer = undefined;
		const unconfigured: PluginConversationEnsureResult = await (await host()).conversations.ensure({ key: "dm:b" });
		expect(unconfigured.ok).toBe(false);
		expect(unconfigured.error).toMatch(/不支持|未接入/);
	});
});
