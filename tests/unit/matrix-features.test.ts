/**
 * tests/unit/matrix-features.test.ts
 * Tests for Matrix Bot plugin (experimental):
 * - Pure helpers (marker stripping, accountId hashing, mention stripping)
 * - MatrixBotBridge duplex flow (whitelist, slash commands, chat dispatch, and run_end reply)
 */

import { describe, expect, it, vi } from "vitest";
// @ts-expect-error jsdom does not ship declarations in this workspace
import { JSDOM } from "jsdom";
import {
	extractMatrixText,
	formatMatrixError,
	matrixApi,
	MatrixBotBridge,
	peerAccountId,
	stripInternalMarkers,
} from "../../plugins/matrix/index.mjs";
import activateMatrixPlugin from "../../plugins/matrix/index.mjs";
import matrixClient from "../../plugins/matrix/client/entry.mjs";

describe("Matrix 纯函数与辅助方法测试", () => {
	it("stripInternalMarkers 剥离内部标记与清理空行", () => {
		const raw = "这是回答[[plan:123]]中间内容[[conv:xyz]]结尾。\n\n\n新行";
		expect(stripInternalMarkers(raw)).toBe("这是回答中间内容结尾。\n\n新行");
	});

	it("peerAccountId 生成稳定的 mtx_ 前缀脱敏 ID", () => {
		const id1 = peerAccountId("@alice:matrix.org");
		const id2 = peerAccountId("@alice:matrix.org");
		expect(id1).toBe(id2);
		expect(id1.startsWith("mtx_")).toBe(true);
		expect(peerAccountId("")).toBe("mtx_default");
	});

	it("extractMatrixText 剥离机器人 @botId 标签", () => {
		const content = { body: "@bot:matrix.org 帮我写一个快速排序算法" };
		expect(extractMatrixText(content, "@bot:matrix.org")).toBe("帮我写一个快速排序算法");
	});
});

describe("MatrixBotBridge 双工逻辑测试", () => {
	it("白名单模式：不在白名单内的用户会被拒绝，不触发 host.chat", async () => {
		const chatSpy = vi.fn();
		const bridge = new MatrixBotBridge({
			host: { chat: chatSpy },
			getConfig: () => ({
				homeserverUrl: "https://matrix.org",
				accessToken: "mock_token",
				allowedUsers: ["@alice:matrix.org"],
			}),
		});

		await bridge.onInboundMessage("!room1:matrix.org", {
			event_id: "$ev1",
			sender: "@bob:matrix.org",
			content: { body: "你好" },
		});

		expect(chatSpy).not.toHaveBeenCalled();
	});

	it("斜杠命令 /help 应当直接回复帮助说明，不触发 host.chat", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ event_id: "$reply_1" }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const chatSpy = vi.fn();
		const bridge = new MatrixBotBridge({
			host: { chat: chatSpy },
			getConfig: () => ({
				homeserverUrl: "https://matrix.org",
				accessToken: "mock_token",
			}),
		});

		await bridge.onInboundMessage("!room1:matrix.org", {
			event_id: "$ev2",
			sender: "@alice:matrix.org",
			content: { body: "/help" },
		});

		expect(chatSpy).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining("/send/m.room.message/"),
			expect.objectContaining({
				method: "PUT",
				body: expect.stringContaining("Matrix 机器人帮助"),
			}),
		);

		vi.unstubAllGlobals();
	});

	it("正常入站消息派发到 host.chat，并在 run_end 时回复 Markdown", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ user_id: "@bot:matrix.org", event_id: "$reply_2" }),
		});
		vi.stubGlobal("fetch", fetchMock);

		let runHandler: ((ev: any) => void) | null = null;
		const chatSpy = vi.fn().mockResolvedValue({ conversationId: "conv_mtx_1", runId: "run_mtx_1" });

		const bridge = new MatrixBotBridge({
			host: {
				chat: chatSpy,
				onRunEvent: (fn: any) => {
					runHandler = fn;
					return () => {};
				},
			},
			getConfig: () => ({
				homeserverUrl: "https://matrix.org",
				accessToken: "mock_token",
			}),
		});

		await bridge.start();

		await bridge.onInboundMessage("!room1:matrix.org", {
			event_id: "$ev3",
			sender: "@alice:matrix.org",
			content: { body: "帮我写一个函数" },
		});

		expect(chatSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				text: "帮我写一个函数",
				accountId: expect.stringMatching(/^mtx_/),
			}),
		);

		const convId = "conv_mtx_1";

		runHandler!({
			conversationId: convId,
			runId: "run_mtx_1",
			type: "message",
			message: {
				role: "assistant",
				content: "```typescript\nfunction test() {}\n```[[plan:mtx]]",
			},
		});

		await runHandler!({
			conversationId: "renamed_mtx_1",
			runId: "run_mtx_1",
			type: "run_end",
		});

		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining("/send/m.room.message/"),
			expect.objectContaining({
				method: "PUT",
				body: expect.stringContaining("function test()"),
			}),
		);

		await bridge.stop();
		vi.unstubAllGlobals();
	});

	it("Matrix 门控与防重放：忽略 m.notice 机器人通知消息，且支持游标持久化", async () => {
		const chatSpy = vi.fn().mockResolvedValue({ conversationId: "conv_mtx_test" });
		const storageMap = new Map<string, string>();
		const host = {
			chat: chatSpy,
			storage: {
				get: vi.fn(async (key: string) => storageMap.get(key)),
				set: vi.fn(async (key: string, val: string) => {
					storageMap.set(key, val);
				}),
			},
		};

		const bridge = new MatrixBotBridge({
			host,
			getConfig: () => ({ homeserverUrl: "https://matrix.org", accessToken: "token" }),
		});

		// 1. 过滤 m.notice 消息
		await bridge.onInboundMessage("!room1:matrix.org", {
			event_id: "$ev_notice",
			sender: "@otherbot:matrix.org",
			content: { msgtype: "m.notice", body: "机器人系统通知" },
		});
		expect(chatSpy).not.toHaveBeenCalled();

		// 2. 正常 m.text 消息触发
		await bridge.onInboundMessage("!room1:matrix.org", {
			event_id: "$ev_normal",
			sender: "@alice:matrix.org",
			content: { msgtype: "m.text", body: "用户正常提问" },
		});
		expect(chatSpy).toHaveBeenCalledTimes(1);
	});
});

describe("Matrix configuration diagnostics", () => {
	it("echoes the UI request id on server replies", async () => {
		let onClientMessage: ((message: unknown, reply: (payload: unknown) => void) => void | Promise<void>) | undefined;
		const host = {
			cwd: "/workspace",
			storage: { get: async () => undefined, set: async () => {} },
			secrets: { getAll: async () => ({}), set: async () => {}, delete: async () => {} },
			onClientMessage: (handler: typeof onClientMessage) => {
				onClientMessage = handler;
				return () => {};
			},
			log: () => {},
			notify: () => {},
		};
		const cleanup = await activateMatrixPlugin(host);
		let replyPayload: Record<string, unknown> | undefined;
		await onClientMessage?.({ type: "get_state", reqId: "matrix-state-1" }, (payload) => {
			replyPayload = payload as Record<string, unknown>;
		});
		expect(replyPayload).toMatchObject({
			type: "state",
			reqId: "matrix-state-1",
		});
		await cleanup();
	});

	it("includes HTTP status, Matrix errcode, and server error text", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ errcode: "M_FORBIDDEN", error: "Invalid access token" }), {
					status: 401,
					headers: { "content-type": "application/json" },
				}),
			),
		);
		await expect(
			matrixApi("https://matrix.example", "expired", "GET", "/_matrix/client/v3/account/whoami"),
		).rejects.toThrow(/HTTP 401.*M_FORBIDDEN.*Invalid access token/);
		vi.unstubAllGlobals();
	});

	it("includes the homeserver URL and nested network cause", async () => {
		const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8008"), {
			code: "ECONNREFUSED",
		});
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause })));
		await expect(
			matrixApi("http://127.0.0.1:8008", "token", "GET", "/_matrix/client/v3/account/whoami"),
		).rejects.toThrow(/http:\/\/127\.0\.0\.1:8008.*ECONNREFUSED/);
		const error = new TypeError("fetch failed", { cause });
		expect(formatMatrixError(error)).toContain("ECONNREFUSED");
		vi.unstubAllGlobals();
	});

	it("shows the actual save error returned through plugin_data", async () => {
		type ClientPayload = {
			type?: string;
			reqId?: string;
			config?: Record<string, unknown>;
			botStatus?: Record<string, unknown>;
			hostCwd?: string;
			success?: boolean;
			message?: string;
			[field: string]: unknown;
		};
		const dom = new JSDOM("<!doctype html><div id='root'></div>");
		const previousWindow = globalThis.window;
		const previousDocument = globalThis.document;
		const previousAlert = globalThis.alert;
		const alerts: string[] = [];
		Object.assign(globalThis, {
			window: dom.window,
			document: dom.window.document,
			alert: (message: unknown) => alerts.push(String(message)),
		});
		let dataHandler: ((payload: ClientPayload) => void) | undefined;
		const ctx = {
			send: (payload: ClientPayload) => {
				const response =
					payload.type === "get_state"
						? {
								type: "state",
								reqId: payload.reqId,
								config: { homeserverUrl: "https://matrix.example" },
								botStatus: { state: "idle" },
								hostCwd: "/workspace",
							}
						: {
								type: "save_config_done",
								reqId: payload.reqId,
								success: false,
								message: "Matrix POST /login failed: HTTP 403 [M_FORBIDDEN] - Invalid token",
							};
				queueMicrotask(() => dataHandler?.(response));
				return true;
			},
			onData: (handler: (payload: ClientPayload) => void) => {
				dataHandler = handler;
				return () => {};
			},
		};
		const root = dom.window.document.querySelector("#root");
		const cleanup = await matrixClient.mount(root, ctx);
		const deadline = Date.now() + 1000;
		while (!root.querySelector(".matrix-btn-save-cfg") && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		root.querySelector(".matrix-btn-save-cfg").dispatchEvent(new dom.window.Event("click"));
		while (alerts.length === 0 && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		expect(alerts[0]).toContain("HTTP 403");
		expect(alerts[0]).toContain("M_FORBIDDEN");
		expect(alerts[0]).toContain("Invalid token");
		cleanup();
		Object.assign(globalThis, {
			window: previousWindow,
			document: previousDocument,
			alert: previousAlert,
		});
	});
});
