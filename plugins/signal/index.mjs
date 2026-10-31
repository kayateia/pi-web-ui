/**
 * Signal integration for pi-web-ui.
 *
 * signal-cli remains the Signal protocol client. This plugin is the policy and
 * routing layer: it authorizes senders, maps each DM/group to a dedicated
 * pi-web-ui conversation, and sends assistant output back to the originating
 * channel.
 */
import * as http from "node:http";
import * as https from "node:https";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const DEFAULT_DAEMON_URL = "http://127.0.0.1:8080";
const SSE_RETRY_INITIAL_MS = 2_000;
const SSE_RETRY_MAX_MS = 60_000;
const SIGNAL_CHUNK_CHARS = 7_800;
const MAX_SEEN_ENVELOPES = 2_000;
const RUN_TIMEOUT_MS = 20 * 60_000;
const MAX_SIGNAL_IMAGES = 6;
const MAX_SIGNAL_IMAGE_BYTES = 5 * 1024 * 1024;

/** Remove pi-web-ui internal side-effect markers before leaving the host. */
export function stripInternalMarkers(text) {
	return String(text ?? "")
		.replace(/\[\[[A-Za-z][A-Za-z0-9_-]*:[^\]]*\]\]/g, "")
		.replace(/\r\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** Sanitize a Signal profile name before it enters model context or the UI. */
export function sanitizeSignalName(value) {
	return String(value ?? "")
		.replace(/[\u0000-\u001F\u007F\u200B-\u200F\u2028\u2029]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 120);
}

/** Normalize phone numbers for allowlist comparisons. */
export function normalizePhone(value) {
	const compact = String(value ?? "").replace(/[\s\-().]/g, "");
	return /^\+[1-9]\d{1,14}$/.test(compact) ? compact : "";
}

/** Normalize an allowlist entry to `aci:` or `e164:` form. */
export function normalizeSenderId(value) {
	const raw = String(value ?? "").trim();
	if (!raw) return "";
	const lower = raw.toLowerCase();
	if (lower.startsWith("aci:")) {
		const id = raw.slice(4).trim();
		return id ? `aci:${id.toLowerCase()}` : "";
	}
	if (lower.startsWith("e164:")) {
		const phone = normalizePhone(raw.slice(5));
		return phone ? `e164:${phone}` : "";
	}
	const phone = normalizePhone(raw);
	if (phone) return `e164:${phone}`;
	if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(raw)) return `aci:${raw.toLowerCase()}`;
	return lower;
}

/** Stable, privacy-preserving conversation key material for an ACI/number. */
export function senderAccountId(identity) {
	const digest = createHash("sha256")
		.update(String(identity ?? "unknown"))
		.digest("hex")
		.slice(0, 16);
	return `sg_${digest}`;
}

/** Convert a normalized allowlist identity back to a signal-cli recipient. */
export function signalRecipient(identity) {
	const raw = String(identity ?? "").trim();
	if (raw.toLowerCase().startsWith("aci:")) return raw.slice(4);
	if (raw.toLowerCase().startsWith("e164:")) return raw.slice(5);
	return raw;
}

/** Split long Signal replies on paragraph/line boundaries. */
export function chunkSignalText(text, limit = SIGNAL_CHUNK_CHARS) {
	const normalized = String(text ?? "").trim();
	if (!normalized) return [];
	if (normalized.length <= limit) return [normalized];
	const chunks = [];
	let remaining = normalized;
	while (remaining.length > limit) {
		let cut = remaining.lastIndexOf("\n\n", limit);
		if (cut < Math.floor(limit * 0.55)) cut = remaining.lastIndexOf("\n", limit);
		if (cut < Math.floor(limit * 0.55)) cut = remaining.lastIndexOf(" ", limit);
		if (cut < Math.floor(limit * 0.55)) cut = limit;
		chunks.push(remaining.slice(0, cut).trimEnd());
		remaining = remaining.slice(cut).trimStart();
	}
	if (remaining) chunks.push(remaining);
	return chunks;
}

/** Return all stable sender identities present in a signal-cli envelope. */
export function envelopeSenderIds(envelope) {
	const values = [envelope?.sourceUuid, envelope?.sourceServiceId, envelope?.sourceNumber, envelope?.source].filter(
		(value) => typeof value === "string" && value.trim(),
	);
	return [...new Set(values.map(normalizeSenderId).filter(Boolean))];
}

/** Text, timestamp, and attachment metadata for direct or synced messages. */
function messagePayload(dataMessage) {
	const body =
		typeof dataMessage?.message === "string"
			? dataMessage.message
			: typeof dataMessage?.body === "string"
				? dataMessage.body
				: "";
	const timestamp =
		typeof dataMessage?.timestamp === "number" && Number.isFinite(dataMessage.timestamp) ? dataMessage.timestamp : 0;
	const attachments = Array.isArray(dataMessage?.attachments)
		? dataMessage.attachments
				.filter((attachment) => attachment && typeof attachment === "object")
				.map((attachment) => ({
					id: typeof attachment.id === "string" ? attachment.id.trim() : "",
					contentType: typeof attachment.contentType === "string" ? attachment.contentType.trim().toLowerCase() : "",
					filename: sanitizeSignalName(attachment.filename),
					size: Number.isFinite(attachment.size) ? Number(attachment.size) : 0,
					caption: String(attachment.caption ?? "")
						.trim()
						.slice(0, 2_000),
				}))
				.filter((attachment) => attachment.id && attachment.contentType)
		: [];
	const mentions = Array.isArray(dataMessage?.mentions)
		? dataMessage.mentions
				.filter((mention) => mention && typeof mention === "object")
				.map((mention) => ({
					name: sanitizeSignalName(mention.name),
					number: normalizePhone(mention.number),
					uuid: normalizeSenderId(mention.uuid),
					start: Number.isInteger(mention.start) ? mention.start : -1,
					length: Number.isInteger(mention.length) ? mention.length : 0,
				}))
				.filter((mention) => mention.start >= 0 && mention.length > 0)
		: [];
	return { body: body.trim(), timestamp, attachments, mentions };
}

/**
 * Replace signal-cli mention placeholder spans with readable `@handle` text.
 *
 * signal-cli exposes mention targets as metadata and leaves U+FFFC (object
 * replacement character) in the message body. Replacing from the end keeps
 * earlier UTF-16 offsets stable.
 */
export function renderSignalMentions(body, mentions, resolveHandle) {
	let rendered = String(body ?? "");
	const ordered = (Array.isArray(mentions) ? mentions : [])
		.filter((mention) => mention.start >= 0 && mention.length > 0)
		.slice()
		.sort((left, right) => right.start - left.start);
	for (const mention of ordered) {
		if (mention.start + mention.length > rendered.length) continue;
		const resolved = sanitizeSignalName(resolveHandle?.(mention));
		const fallback = mention.name || signalRecipient(mention.uuid) || mention.number || "unknown";
		const handle = resolved || fallback;
		const replacement = handle.startsWith("@") ? handle : `@${handle}`;
		rendered = rendered.slice(0, mention.start) + replacement + rendered.slice(mention.start + mention.length);
	}
	return rendered;
}

/**
 * Parse one signal-cli envelope into the gateway's channel model.
 *
 * Incoming `dataMessage` values are accepted. Self-authored `syncMessage`
 * values are ignored to prevent reply loops; Note-to-Self remains supported
 * only when its destination resolves to this account.
 */
export function parseSignalEnvelope(raw, opts) {
	const envelope = raw?.envelope ?? raw;
	if (!envelope || typeof envelope !== "object") return null;
	const ownIds = new Set([opts?.account, opts?.accountUuid].filter(Boolean).map(normalizeSenderId).filter(Boolean));

	const dataMessage = envelope.dataMessage;
	if (dataMessage && typeof dataMessage === "object") {
		const payload = messagePayload(dataMessage);
		if (!payload.body && payload.attachments.length === 0) return null;
		const senderIds = envelopeSenderIds(envelope);
		if (senderIds.some((id) => ownIds.has(id))) return null;

		const groupInfo = dataMessage.groupInfo && typeof dataMessage.groupInfo === "object" ? dataMessage.groupInfo : null;
		const groupId = typeof groupInfo?.groupId === "string" && groupInfo.groupId.trim() ? groupInfo.groupId.trim() : "";
		const groupName = sanitizeSignalName(groupInfo?.groupName);
		const senderName = sanitizeSignalName(envelope.sourceName);
		const number = normalizePhone(envelope.sourceNumber);
		const aci = normalizeSenderId(envelope.sourceUuid || envelope.sourceServiceId || envelope.source);
		const senderIdsForChannel = [aci, number ? `e164:${number}` : ""].filter(Boolean);
		const channel = groupId
			? {
					kind: "group",
					key: `group:${groupId}`,
					title: groupName ? `Signal · ${groupName}` : `Signal group · ${groupId.slice(0, 12)}`,
					groupId,
				}
			: {
					kind: "dm",
					key: `dm:${aci || `e164:${number}` || "unknown"}`,
					title: `Signal · ${senderName || aci || number || "Direct message"}`,
					groupId: "",
				};
		return {
			...channel,
			body: payload.body,
			timestamp: payload.timestamp,
			attachments: payload.attachments,
			mentions: payload.mentions,
			sender: {
				name: senderName || aci || number || "Unknown sender",
				ids: senderIds,
				channelIds: senderIdsForChannel,
				number,
				aci,
			},
			envelope: {
				source: typeof envelope.source === "string" ? envelope.source : "",
				sourceUuid: typeof envelope.sourceUuid === "string" ? envelope.sourceUuid : "",
				sourceNumber: typeof envelope.sourceNumber === "string" ? envelope.sourceNumber : "",
				timestamp: payload.timestamp,
			},
		};
	}

	const sentMessage = envelope.syncMessage?.sentMessage;
	if (!sentMessage || typeof sentMessage !== "object") return null;
	const payload = messagePayload(sentMessage);
	if (!payload.body && payload.attachments.length === 0) return null;
	const destinationIds = [sentMessage.destinationNumber, sentMessage.destinationUuid, sentMessage.destination]
		.filter(Boolean)
		.map(normalizeSenderId)
		.filter(Boolean);
	if (!destinationIds.some((id) => ownIds.has(id))) return null;

	return {
		kind: "dm",
		key: "dm:self",
		title: "Signal · Note to Self",
		groupId: "",
		body: payload.body,
		timestamp: payload.timestamp,
		attachments: payload.attachments,
		mentions: payload.mentions,
		sender: {
			name: "Self",
			ids: [...ownIds],
			channelIds: [...ownIds],
			number: normalizePhone(opts?.account),
			aci: normalizeSenderId(opts?.accountUuid),
		},
		envelope: {
			source: "",
			sourceUuid: String(opts?.accountUuid ?? ""),
			sourceNumber: String(opts?.account ?? ""),
			timestamp: payload.timestamp,
		},
	};
}

/** Merge and normalize global/channel sender allowlists. */
export function effectiveSenderAllowlist(config, channelConfig) {
	const values = [
		...(Array.isArray(config?.allowedSenders) ? config.allowedSenders : []),
		...(Array.isArray(channelConfig?.allowSenders) ? channelConfig.allowSenders : []),
	];
	return new Set(values.map(normalizeSenderId).filter(Boolean));
}

/** Check whether a parsed sender is authorized for this channel. */
export function isSenderAllowed(parsed, config, channelConfig) {
	const allowed = effectiveSenderAllowlist(config, channelConfig);
	const owner = new Set(
		(Array.isArray(config?.ownerSenders) ? config.ownerSenders : []).map(normalizeSenderId).filter(Boolean),
	);
	return parsed.sender.ids.some((id) => allowed.has(id) || owner.has(id));
}

/** Check whether a sender may perform owner-only Signal commands. */
export function isOwnerSender(parsed, config) {
	const owners = new Set(
		(Array.isArray(config?.ownerSenders) ? config.ownerSenders : []).map(normalizeSenderId).filter(Boolean),
	);
	return parsed.sender.ids.some((id) => owners.has(id));
}

/**
 * Compose the plugin-wide and channel-specific prompt additions.
 *
 * The result is always appended to pi-web-ui's normal system prompt, so the
 * agent retains the regular coding preamble, tool guidance, project context,
 * and all other host-generated prompt sections.
 */
export function composeSignalSystemPrompt(globalPrompt, channelPrompt, channelTitle = "") {
	const sections = [];
	const globalText = String(globalPrompt ?? "").trim();
	const channelText = String(channelPrompt ?? "").trim();
	if (globalText) sections.push(`Signal gateway instructions:\n${globalText}`);
	if (channelText) {
		const title = sanitizeSignalName(channelTitle);
		sections.push(`Signal channel instructions${title ? ` for ${title}` : ""}:\n${channelText}`);
	}
	return sections.join("\n\n");
}

/** Resolve a channel profile, inheriting defaults and enforcing group opt-in. */
export function resolveChannelProfile(parsed, config) {
	const channels =
		config?.channels && typeof config.channels === "object" && !Array.isArray(config.channels) ? config.channels : {};
	const configured = channels[parsed.key] ?? (parsed.key === "dm:self" ? channels["dm:self"] : undefined);
	if (configured?.enabled === false) return null;
	if (parsed.kind === "group" && !configured) return null;
	if (parsed.kind === "group" && configured?.enabled !== true) return null;
	const defaults = config?.defaults && typeof config.defaults === "object" ? config.defaults : {};
	const title = sanitizeSignalName(configured?.name) || parsed.title;
	return {
		...defaults,
		...configured,
		key: parsed.key,
		title,
		systemPrompt: composeSignalSystemPrompt(defaults.systemPrompt, configured?.systemPrompt, title),
		promptMode: "append",
		preset: String(configured?.preset || defaults.preset || "").trim(),
		workspace: String(configured?.workspace || defaults.workspace || "").trim(),
		model: String(configured?.model || defaults.model || "").trim(),
		thinkingLevel: String(configured?.thinkingLevel || defaults.thinkingLevel || "").trim(),
	};
}

/** Validate the daemon endpoint without allowing accidental public exposure. */
export function validateDaemonUrl(value, allowRemote = false) {
	let url;
	try {
		url = new URL(String(value || DEFAULT_DAEMON_URL));
	} catch {
		return { ok: false, error: "Signal daemon URL 无效" };
	}
	if (!["http:", "https:"].includes(url.protocol)) {
		return { ok: false, error: "Signal daemon 只支持 http/https" };
	}
	const host = url.hostname.toLowerCase();
	const loopback = host === "localhost" || host === "::1" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host);
	if (!loopback && !allowRemote) {
		return { ok: false, error: "默认只允许 loopback signal-cli daemon；如确有需要请显式开启远程 daemon" };
	}
	return { ok: true, url: url.toString().replace(/\/+$/, "") };
}

/**
 * Build the signal-cli command used when the plugin owns the daemon process.
 * Managed mode is intentionally loopback-only because the plugin must be able
 * to connect to and terminate the exact process it starts.
 */
export function managedDaemonCommand(config) {
	const account = normalizePhone(config?.account);
	if (!account) return { ok: false, error: "Signal account is required for managed daemon mode" };
	const daemon = validateDaemonUrl(config?.daemonUrl, false);
	if (!daemon.ok) return daemon;
	const url = new URL(daemon.url);
	if (url.protocol !== "http:") {
		return { ok: false, error: "Managed signal-cli daemon requires an http:// loopback URL" };
	}
	if (url.pathname && url.pathname !== "/") {
		return { ok: false, error: "Managed signal-cli daemon URL must not contain a path" };
	}
	const port = url.port || "8080";
	return {
		ok: true,
		command: String(config?.signalCliPath || "signal-cli").trim() || "signal-cli",
		args: ["-a", account, "daemon", "--http", `${url.hostname}:${port}`],
		url: daemon.url,
	};
}

/** Minimal JSON-RPC client for signal-cli's loopback daemon. */
async function daemonRpc(baseUrl, method, params, timeoutMs = 15_000) {
	let res;
	try {
		res = await fetch(`${baseUrl}/api/v1/rpc`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: Date.now(),
				method,
				params,
			}),
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (error) {
		throw new Error(`Cannot reach signal-cli at ${baseUrl}: ${formatSignalError(error)}`, {
			cause: error,
		});
	}
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		const detail = body.trim().slice(0, 500);
		throw new Error(`signal-cli HTTP ${res.status} for ${method} at ${baseUrl}${detail ? `: ${detail}` : ""}`);
	}
	let json;
	try {
		json = await res.json();
	} catch (error) {
		throw new Error(`signal-cli returned invalid JSON for ${method}: ${formatSignalError(error)}`, {
			cause: error,
		});
	}
	if (json?.error) throw new Error(json.error.message || JSON.stringify(json.error));
	return json?.result;
}

/** Produce a useful message for fetch/network failures without exposing payloads. */
export function formatSignalError(error) {
	if (!(error instanceof Error)) return String(error ?? "unknown error");
	const parts = [error.message || error.name || "unknown error"];
	let cause = error.cause;
	for (let depth = 0; cause && depth < 3; depth += 1) {
		if (cause instanceof Error) {
			const code =
				typeof cause.code === "string" && cause.code && !parts.join(" ").includes(cause.code) ? ` (${cause.code})` : "";
			if (cause.message && !parts.some((part) => part.includes(cause.message))) {
				parts.push(`${cause.message}${code}`);
			}
			cause = cause.cause;
		} else if (typeof cause === "object" && cause && "code" in cause) {
			const code = String(cause.code ?? "").trim();
			if (code && !parts.join(" ").includes(code)) parts.push(code);
			break;
		} else {
			break;
		}
	}
	return parts.join(": ");
}

/** Signal gateway: one SSE reader feeding many isolated pi conversations. */
export class SignalGateway {
	constructor({ host, getConfig, setConfig, getSessionMap, setSessionMap, log, spawnProcess } = {}) {
		this.host = host;
		this.getConfig = getConfig || (() => ({}));
		this.setConfig = setConfig || (async () => {});
		this.getSessionMap = getSessionMap || (() => ({}));
		this.setSessionMap = setSessionMap || (async () => {});
		this.log = log || ((level, message) => console.log(`[signal:${level}] ${message}`));
		this.spawnProcess = spawnProcess || spawn;

		this.running = false;
		this.connected = false;
		this.accountUuid = "";
		this.daemonUrl = DEFAULT_DAEMON_URL;
		this.sseRequest = null;
		this.daemonChild = null;
		this.stoppingDaemon = false;
		this.reconnectTimer = null;
		this.reconnectDelay = SSE_RETRY_INITIAL_MS;
		this.offRunEvent = null;
		this.seen = new Set();
		this.seenOrder = [];
		this.channelQueues = new Map();
		this.activeChannels = new Set();
		this.pendingRuns = new Map();
		this.sessionMap = { ...this.getSessionMap() };
		this.discovered = new Map();
		this.mentionContacts = new Map();
		this.mentionContactsAt = 0;
		this.status = {
			enabled: false,
			connected: false,
			state: "idle",
			account: "",
			accountUuid: "",
			messagesReceived: 0,
			messagesBlocked: 0,
			messagesReplied: 0,
			lastMessageAt: null,
			lastReplyAt: null,
			lastError: null,
		};
	}

	getStatus() {
		const config = this.getConfig() || {};
		return {
			...this.status,
			daemonUrl: this.daemonUrl,
			daemonMode: config.daemonMode || "managed",
			daemonManaged: Boolean(this.daemonChild),
			channelQueues: Object.fromEntries([...this.channelQueues].map(([key, queue]) => [key, queue.length])),
			activeChannels: [...this.activeChannels],
			channelSessions: { ...this.sessionMap },
			discoveredChannels: [...this.discovered.values()],
			configuredChannels: Object.keys(config.channels || {}).length,
		};
	}

	async start() {
		if (this.running) return this.getStatus();
		const config = this.getConfig() || {};
		const account = normalizePhone(config.account);
		if (!account) throw new Error("请先配置 Signal 账号（E.164）");
		const daemon = validateDaemonUrl(config.daemonUrl, config.allowRemoteDaemon === true);
		if (!daemon.ok) throw new Error(daemon.error);

		this.running = true;
		this.daemonUrl = daemon.url;
		this.status.enabled = true;
		this.status.state = "connecting";
		this.status.account = account;
		this.status.lastError = null;
		if ((config.daemonMode || "managed") === "managed") {
			try {
				await this.startManagedDaemon();
			} catch (error) {
				this.running = false;
				this.status.enabled = false;
				this.status.state = "error";
				this.status.connected = false;
				this.status.lastError = formatSignalError(error);
				await this.stopManagedDaemon().catch(() => {});
				throw error;
			}
		}
		this.accountUuid = await this.resolveAccountUuid(account).catch(() => "");
		this.status.accountUuid = this.accountUuid;

		if (typeof this.host?.onRunEvent === "function") {
			this.offRunEvent = this.host.onRunEvent((event) => this.handleRunEvent(event));
		}
		this.connectSse();
		return this.getStatus();
	}

	async stop() {
		this.running = false;
		this.connected = false;
		this.status.enabled = false;
		this.status.connected = false;
		this.status.state = "idle";
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
		if (this.sseRequest) {
			try {
				this.sseRequest.destroy();
			} catch {}
		}
		this.sseRequest = null;
		if (this.offRunEvent) {
			try {
				this.offRunEvent();
			} catch {}
		}
		this.offRunEvent = null;
		for (const pending of this.pendingRuns.values()) {
			if (pending.timeout) clearTimeout(pending.timeout);
		}
		this.pendingRuns.clear();
		await this.stopManagedDaemon();
	}

	async resolveAccountUuid(account) {
		const contacts = await daemonRpc(this.daemonUrl, "listContacts", { account, allRecipients: true });
		if (!Array.isArray(contacts)) return "";
		const match = contacts.find((entry) => normalizePhone(entry?.number) === account);
		return String(match?.uuid || match?.aci || "").trim();
	}

	/** Check signal-cli's health endpoint with a short timeout. */
	async daemonReachable() {
		try {
			const response = await fetch(`${this.daemonUrl}/api/v1/check`, {
				signal: AbortSignal.timeout(1_500),
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	/** Spawn the signal-cli daemon and wait until it can serve requests. */
	async startManagedDaemon() {
		const command = managedDaemonCommand(this.getConfig() || {});
		if (!command.ok) throw new Error(command.error);
		if (await this.daemonReachable()) {
			throw new Error(
				`A signal-cli daemon is already running at ${command.url}. Stop the external service, or set daemon mode to External.`,
			);
		}

		this.stoppingDaemon = false;
		const child = this.spawnProcess(command.command, command.args, {
			stdio: "ignore",
			env: { ...process.env },
			shell: false,
			windowsHide: true,
		});
		this.daemonChild = child;
		let launchError = null;
		child.once("error", (error) => {
			launchError = error;
		});

		const deadline = Date.now() + 60_000;
		while (Date.now() < deadline) {
			if (launchError) throw new Error(`Could not start signal-cli: ${formatSignalError(launchError)}`);
			if (child.exitCode !== null || child.signalCode !== null) {
				throw new Error(
					`signal-cli exited during startup (code ${child.exitCode ?? "none"}, signal ${child.signalCode ?? "none"})`,
				);
			}
			if (await this.daemonReachable()) {
				child.once("exit", (code, signal) => {
					if (this.daemonChild === child) this.daemonChild = null;
					if (this.stoppingDaemon || !this.running) return;
					this.connected = false;
					this.status.connected = false;
					this.status.state = "error";
					this.status.lastError = `signal-cli daemon exited (code ${code ?? "none"}, signal ${signal ?? "none"})`;
					this.log("warn", this.status.lastError);
				});
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		try {
			child.kill("SIGTERM");
		} catch {}
		if (this.daemonChild === child) this.daemonChild = null;
		throw new Error("signal-cli daemon did not become ready within 60 seconds");
	}

	/** Terminate only the child process owned by this gateway. */
	async stopManagedDaemon() {
		const child = this.daemonChild;
		if (!child) return;
		this.stoppingDaemon = true;
		const exited = new Promise((resolve) => child.once("exit", resolve));
		try {
			child.kill("SIGTERM");
		} catch {}
		await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
		if (child.exitCode === null && child.signalCode === null) {
			try {
				child.kill("SIGKILL");
			} catch {}
			await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
		}
		if (this.daemonChild === child) this.daemonChild = null;
		this.stoppingDaemon = false;
	}

	/** Load and cache contact labels used to render Signal @mentions. */
	async loadMentionContacts() {
		if (this.mentionContactsAt && Date.now() - this.mentionContactsAt < 5 * 60_000) {
			return this.mentionContacts;
		}
		const contacts = await daemonRpc(this.daemonUrl, "listContacts", {
			account: this.status.account,
			allRecipients: true,
		});
		const directory = new Map();
		if (Array.isArray(contacts)) {
			for (const contact of contacts) {
				const name = sanitizeSignalName(
					contact?.name ||
						contact?.profileName ||
						[contact?.givenName, contact?.familyName].filter(Boolean).join(" ") ||
						contact?.username,
				);
				if (!name) continue;
				for (const identity of [
					normalizeSenderId(contact?.uuid || contact?.aci),
					normalizePhone(contact?.number),
				].filter(Boolean)) {
					directory.set(identity, name);
				}
			}
		}
		this.mentionContacts = directory;
		this.mentionContactsAt = Date.now();
		return directory;
	}

	/** Resolve Signal mention metadata into readable @Display Name text. */
	async resolveInboundBody(parsed) {
		if (!Array.isArray(parsed.mentions) || parsed.mentions.length === 0) return parsed.body;
		const contacts = await this.loadMentionContacts().catch(() => new Map());
		return renderSignalMentions(parsed.body, parsed.mentions, (mention) => {
			return contacts.get(mention.uuid) || contacts.get(mention.number);
		});
	}

	connectSse() {
		if (!this.running) return;
		if (this.sseRequest) {
			try {
				this.sseRequest.destroy();
			} catch {}
			this.sseRequest = null;
		}
		const account = this.status.account;
		const url = new URL(this.daemonUrl);
		const path = `/api/v1/events?account=${encodeURIComponent(account)}`;
		const transport = url.protocol === "https:" ? https : http;
		const request = transport.get(
			{
				hostname: url.hostname,
				port: url.port || (url.protocol === "https:" ? 443 : 80),
				path,
				protocol: url.protocol,
				timeout: 0,
			},
			(response) => {
				if (response.statusCode !== 200) {
					response.resume();
					this.scheduleReconnect(`SSE HTTP ${response.statusCode}`);
					return;
				}
				this.connected = true;
				this.status.connected = true;
				this.status.state = "connected";
				this.reconnectDelay = SSE_RETRY_INITIAL_MS;
				let buffer = "";
				response.on("data", (chunk) => {
					buffer += chunk.toString("utf8");
					const lines = buffer.split("\n");
					buffer = lines.pop() || "";
					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) continue;
						const data = trimmed.slice(5).trim();
						if (!data) continue;
						let raw;
						try {
							raw = JSON.parse(data);
						} catch {
							continue;
						}
						const parsed = parseSignalEnvelope(raw, { account, accountUuid: this.accountUuid });
						if (parsed) void this.onInbound(parsed);
					}
				});
				response.on("end", () => this.scheduleReconnect("SSE stream ended"));
				response.on("error", (error) => this.scheduleReconnect(error.message));
			},
		);
		request.on("error", (error) => this.scheduleReconnect(error.message));
		request.setTimeout(0);
		this.sseRequest = request;
	}

	scheduleReconnect(reason) {
		this.connected = false;
		this.status.connected = false;
		if (!this.running || this.reconnectTimer) return;
		this.status.state = "connecting";
		this.status.lastError = reason;
		const delay = this.reconnectDelay;
		this.reconnectDelay = Math.min(this.reconnectDelay * 2, SSE_RETRY_MAX_MS);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connectSse();
		}, delay);
	}

	seenEnvelope(parsed) {
		const id = [
			parsed.key,
			parsed.timestamp,
			parsed.envelope.sourceUuid || parsed.envelope.sourceNumber || parsed.envelope.source,
			parsed.body.slice(0, 80),
		].join("|");
		if (this.seen.has(id)) return true;
		this.seen.add(id);
		this.seenOrder.push(id);
		while (this.seenOrder.length > MAX_SEEN_ENVELOPES) {
			const old = this.seenOrder.shift();
			if (old) this.seen.delete(old);
		}
		return false;
	}

	rememberDiscovered(parsed) {
		this.discovered.set(parsed.key, {
			key: parsed.key,
			kind: parsed.kind,
			title: parsed.title,
			lastSender: parsed.sender.name,
			lastAt: Date.now(),
		});
		while (this.discovered.size > 20) {
			const first = this.discovered.keys().next().value;
			if (!first) break;
			this.discovered.delete(first);
		}
	}

	async onInbound(parsed) {
		if (!this.running || this.seenEnvelope(parsed)) return;
		const config = this.getConfig() || {};
		const channelConfig = resolveChannelProfile(parsed, config);
		if (!isSenderAllowed(parsed, config, channelConfig)) {
			this.status.messagesBlocked++;
			this.rememberDiscovered(parsed);
			return;
		}
		if (!channelConfig) {
			this.status.messagesBlocked++;
			this.rememberDiscovered(parsed);
			return;
		}
		this.status.messagesReceived++;
		this.status.lastMessageAt = Date.now();

		if (parsed.body.startsWith("/") && (await this.handleCommand(parsed, channelConfig))) return;

		await this.react(parsed, "👀").catch(() => {});
		const queue = this.channelQueues.get(parsed.key) || [];
		queue.push({ parsed, channelConfig });
		this.channelQueues.set(parsed.key, queue);
		void this.drainChannel(parsed.key);
	}

	async drainChannel(channelKey) {
		if (this.activeChannels.has(channelKey)) return;
		this.activeChannels.add(channelKey);
		try {
			for (;;) {
				const queue = this.channelQueues.get(channelKey);
				const next = queue?.shift();
				if (!queue || queue.length === 0) this.channelQueues.delete(channelKey);
				if (!next) break;
				await this.processInbound(next.parsed, next.channelConfig);
			}
		} finally {
			this.activeChannels.delete(channelKey);
		}
	}

	async ensureConversation(parsed, channelConfig) {
		const existing = this.sessionMap[parsed.key] || {};
		const generation = Number.isFinite(existing.generation) && existing.generation > 0 ? existing.generation : 1;
		const result = await this.host.conversations.ensure({
			key: `${parsed.key}:g${generation}`,
			title: channelConfig.title || parsed.title,
			...(channelConfig.workspace ? { cwd: channelConfig.workspace } : {}),
			...(channelConfig.preset ? { preset: channelConfig.preset } : {}),
			systemPrompt: String(channelConfig.systemPrompt ?? ""),
			// Always retain pi-web-ui's main prompt. Gateway and channel text are
			// additive layers on top of the normal preamble and tool guidance.
			systemPromptMode: "append",
			...(Array.isArray(channelConfig.enabledSkills) ? { enabledSkills: channelConfig.enabledSkills } : {}),
			...(Array.isArray(channelConfig.enabledExtensions) ? { enabledExtensions: channelConfig.enabledExtensions } : {}),
			...(existing.sessionFile ? { sessionFile: existing.sessionFile } : {}),
			...(channelConfig.model ? { model: channelConfig.model } : {}),
			...(channelConfig.thinkingLevel ? { thinkingLevel: channelConfig.thinkingLevel } : {}),
		});
		if (!result?.ok || !result.conversationId) {
			throw new Error(result?.error || "无法创建 Signal 对话");
		}
		this.sessionMap[parsed.key] = {
			generation,
			conversationId: result.conversationId,
			...(result.sessionFile ? { sessionFile: result.sessionFile } : {}),
			updatedAt: Date.now(),
		};
		await this.setSessionMap(this.sessionMap);
		return result;
	}

	/**
	 * Download image attachments already received by signal-cli.
	 *
	 * signal-cli's `getAttachment` RPC returns `{data}` where data is base64.
	 * DM retrieval is scoped to the sender; group retrieval is scoped to the
	 * group ID, matching signal-cli's CLI/RPC contract.
	 */
	async resolveInboundImages(parsed) {
		const images = [];
		const errors = [];
		const attachments = Array.isArray(parsed.attachments)
			? parsed.attachments.filter((attachment) => String(attachment.contentType).startsWith("image/"))
			: [];
		for (const [index, attachment] of attachments.slice(0, MAX_SIGNAL_IMAGES).entries()) {
			const displayName =
				sanitizeSignalName(attachment.filename) ||
				`signal-image-${parsed.timestamp || Date.now()}-${index + 1}.${attachment.contentType.split("/")[1] || "img"}`;
			try {
				const params = {
					account: this.status.account,
					id: attachment.id,
				};
				if (parsed.kind === "group") params.groupId = parsed.groupId;
				else {
					params.recipient = signalRecipient(
						parsed.sender.aci || parsed.envelope.sourceUuid || parsed.sender.number || this.status.account,
					);
				}
				const result = await daemonRpc(this.daemonUrl, "getAttachment", params);
				const raw = typeof result === "string" ? result : String(result?.data ?? "");
				const imageData = raw.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
				if (!imageData) throw new Error("signal-cli returned an empty attachment");
				const bytes = Buffer.byteLength(imageData, "base64");
				if (bytes <= 0) throw new Error("decoded attachment is empty");
				if (bytes > MAX_SIGNAL_IMAGE_BYTES) {
					throw new Error(
						`image is too large (${Math.ceil(bytes / 1024 / 1024)} MiB; limit ${MAX_SIGNAL_IMAGE_BYTES / 1024 / 1024} MiB)`,
					);
				}
				images.push({
					name: displayName,
					mimeType: attachment.contentType,
					imageData,
					caption: attachment.caption,
				});
			} catch (error) {
				errors.push(`${displayName}: ${formatSignalError(error)}`);
			}
		}
		if (attachments.length > MAX_SIGNAL_IMAGES) {
			errors.push(`only the first ${MAX_SIGNAL_IMAGES} images were included`);
		}
		return { images, errors };
	}

	async processInbound(parsed, channelConfig) {
		let pending;
		try {
			const binding = await this.ensureConversation(parsed, channelConfig);
			const conversationId = binding.conversationId;
			const { images, errors: imageErrors } = await this.resolveInboundImages(parsed);
			if (
				parsed.attachments?.some((attachment) => attachment.contentType.startsWith("image/")) &&
				images.length === 0
			) {
				throw new Error(`could not load Signal image attachment: ${imageErrors.join("; ")}`);
			}
			const resolvedBody = await this.resolveInboundBody(parsed);
			const body = resolvedBody || (images.length > 0 ? "Sent an image." : "Empty message.");
			const captions = images
				.map((image) => image.caption?.trim())
				.filter(Boolean)
				.map((caption) => `Image caption: ${caption}`);
			const imageNotes = [
				...(images.length > 0 ? [`[${images.length} image attachment${images.length === 1 ? "" : "s"}]`] : []),
				...captions,
				...(imageErrors.length > 0 ? [`[Image attachment warnings: ${imageErrors.join("; ")}]`] : []),
			];
			const promptText = `[Signal ${parsed.kind === "group" ? "group" : "DM"} · ${parsed.sender.name}]: ${body}${
				imageNotes.length ? `\n${imageNotes.join("\n")}` : ""
			}`;
			pending = {
				conversationId,
				parsed,
				expectedTask: promptText,
				text: "",
				timeout: null,
			};
			this.pendingRuns.set(conversationId, pending);
			pending.timeout = setTimeout(() => {
				if (this.pendingRuns.get(conversationId) !== pending) return;
				this.pendingRuns.delete(conversationId);
				void this.unreact(parsed)
					.then(() => this.react(parsed, "❌"))
					.catch(() => {});
				this.log("warn", `Signal run timed out for ${parsed.key}`);
			}, RUN_TIMEOUT_MS);

			const result = await this.host.chat({
				text: promptText,
				accountId: senderAccountId(parsed.sender.channelIds[0] || parsed.key),
				conversationId,
				strictConversationId: true,
				...(images.length > 0
					? {
							attachments: images.map(({ name, mimeType, imageData }) => ({
								name,
								mimeType,
								imageData,
							})),
						}
					: {}),
				...(channelConfig.workspace ? { cwd: channelConfig.workspace } : {}),
				...(channelConfig.model ? { model: channelConfig.model } : {}),
				...(channelConfig.thinkingLevel ? { thinkingLevel: channelConfig.thinkingLevel } : {}),
			});
			if (!result?.conversationId) throw new Error("Signal prompt 未被 pi-web-ui 接收");
		} catch (error) {
			if (pending?.timeout) clearTimeout(pending.timeout);
			if (pending) this.pendingRuns.delete(pending.conversationId);
			await this.unreact(parsed)
				.then(() => this.react(parsed, "❌"))
				.catch(() => {});
			await this.sendText(parsed, `Signal gateway error: ${error.message}`).catch(() => {});
		}
	}

	handleRunEvent(event) {
		const conversationId = String(event?.conversationId ?? "");
		if (!conversationId) return;
		const pending = this.pendingRuns.get(conversationId);
		if (!pending) return;

		if (event.type === "run_start") {
			if (event.task && event.task !== pending.expectedTask) {
				if (pending.timeout) clearTimeout(pending.timeout);
				this.pendingRuns.delete(conversationId);
			}
			return;
		}
		if (event.type === "message" && event.message) {
			const message = event.message;
			if (message.role !== "assistant" && message.author !== "assistant") return;
			let content = "";
			if (typeof message.content === "string") content = message.content;
			else if (Array.isArray(message.content)) {
				content = message.content
					.map((part) => (typeof part === "string" ? part : part?.text || ""))
					.filter(Boolean)
					.join("\n");
			}
			if (content.trim()) {
				pending.text += `${pending.text ? "\n" : ""}${content.trim()}`;
			}
			return;
		}
		if (event.type !== "run_end") return;

		if (pending.timeout) clearTimeout(pending.timeout);
		this.pendingRuns.delete(conversationId);
		void this.finishRun(pending, event.stopReason);
	}

	async finishRun(pending, stopReason) {
		const text = stripInternalMarkers(pending.text);
		const finalText =
			stopReason === "aborted"
				? "Response aborted."
				: text || (stopReason === "error" ? "The agent run failed." : "Done.");
		try {
			const chunks = chunkSignalText(finalText);
			for (const chunk of chunks) await this.sendText(pending.parsed, chunk);
			this.status.messagesReplied++;
			this.status.lastReplyAt = Date.now();
			await this.unreact(pending.parsed).catch(() => {});
			await this.react(pending.parsed, stopReason === "error" ? "❌" : "✅").catch(() => {});
		} catch (error) {
			this.status.lastError = error.message;
			await this.unreact(pending.parsed)
				.then(() => this.react(pending.parsed, "❌"))
				.catch(() => {});
			this.log("warn", `Signal reply delivery failed: ${error.message}`);
		}
	}

	async sendText(parsed, text) {
		const params = {
			account: this.status.account,
			message: String(text ?? ""),
		};
		if (parsed.kind === "group") {
			params.groupId = parsed.groupId;
		} else {
			const target = parsed.sender.aci || (parsed.sender.number ? `+${parsed.sender.number.replace(/^\+/, "")}` : "");
			params.recipient = [signalRecipient(target) || this.status.account];
		}
		await daemonRpc(this.daemonUrl, "send", params);
	}

	async react(parsed, emoji) {
		if (!parsed.timestamp || !this.status.account) return;
		const params = {
			account: this.status.account,
			targetAuthor: signalRecipient(
				parsed.sender.aci || parsed.envelope.sourceUuid || parsed.sender.number || this.status.account,
			),
			targetTimestamp: parsed.timestamp,
			emoji,
		};
		if (parsed.kind === "group") params.groupId = parsed.groupId;
		else {
			const target = parsed.sender.aci || parsed.sender.number || this.status.account;
			params.recipient = [signalRecipient(target)];
		}
		await daemonRpc(this.daemonUrl, "sendReaction", params).catch(() => undefined);
	}

	async unreact(parsed) {
		if (!parsed.timestamp || !this.status.account) return;
		const params = {
			account: this.status.account,
			targetAuthor: signalRecipient(
				parsed.sender.aci || parsed.envelope.sourceUuid || parsed.sender.number || this.status.account,
			),
			targetTimestamp: parsed.timestamp,
			emoji: "👀",
			remove: true,
		};
		if (parsed.kind === "group") params.groupId = parsed.groupId;
		else {
			const target = parsed.sender.aci || parsed.sender.number || this.status.account;
			params.recipient = [signalRecipient(target)];
		}
		await daemonRpc(this.daemonUrl, "sendReaction", params).catch(() => undefined);
	}

	async handleCommand(parsed, channelConfig) {
		const parts = parsed.body.trim().split(/\s+/);
		const command = parts[0].toLowerCase();
		const owner = isOwnerSender(parsed, this.getConfig() || {});
		if (command === "/help") {
			await this.sendText(
				parsed,
				[
					"Signal ↔ pi-web-ui",
					"/status — gateway status",
					"/clear or /new — start a fresh Pi conversation for this channel",
					"/channels — list configured channels",
					...(!owner ? [] : ["/join <signal.group invite> — join a group"]),
				].join("\n"),
			);
			return true;
		}
		if (command === "/status") {
			const status = this.getStatus();
			await this.sendText(
				parsed,
				[
					`Signal gateway: ${status.connected ? "connected" : "disconnected"}`,
					`Account: ${status.account || "(not configured)"}`,
					`Received: ${status.messagesReceived}`,
					`Replied: ${status.messagesReplied}`,
					`Blocked: ${status.messagesBlocked}`,
					`Channel: ${parsed.title}`,
					`Pi conversation: ${this.sessionMap[parsed.key]?.conversationId || "(not created yet)"}`,
				].join("\n"),
			);
			return true;
		}
		if (command === "/clear" || command === "/new") {
			const previous = this.sessionMap[parsed.key] || {};
			this.sessionMap[parsed.key] = {
				generation: (Number(previous.generation) || 1) + 1,
				updatedAt: Date.now(),
			};
			await this.setSessionMap(this.sessionMap);
			await this.sendText(parsed, "Started a fresh Pi conversation for this Signal channel.");
			return true;
		}
		if (command === "/channels") {
			const config = this.getConfig() || {};
			const lines = Object.entries(config.channels || {})
				.filter(([, channel]) => channel && typeof channel === "object")
				.slice(0, 80)
				.map(([key, channel]) => `${channel.enabled === true ? "✓" : "·"} ${channel.name || key}`);
			await this.sendText(parsed, lines.length ? lines.join("\n") : "No Signal channels are configured.");
			return true;
		}
		if (command === "/join") {
			if (!owner) {
				await this.sendText(parsed, "Only an owner sender can join Signal groups.");
				return true;
			}
			const uri = parsed.body.trim().slice(parts[0].length).trim();
			if (!uri) {
				await this.sendText(parsed, "Usage: /join <signal.group invite URL>");
				return true;
			}
			try {
				const result = await daemonRpc(this.daemonUrl, "joinGroup", {
					account: this.status.account,
					uri,
				});
				const groupId = String(result?.groupId ?? result?.id ?? "").trim();
				if (groupId) {
					const config = this.getConfig() || {};
					const channels = { ...config.channels };
					channels[`group:${groupId}`] = {
						enabled: true,
						name: sanitizeSignalName(result?.name) || `Signal group ${groupId.slice(0, 12)}`,
					};
					await this.setConfig({ ...config, channels });
					await this.sendText(
						parsed,
						`Joined Signal group ${groupId}. The new channel is enabled with default settings.`,
					);
				} else {
					await this.sendText(parsed, "Join request accepted. Add the group under Signal → Channels to enable it.");
				}
			} catch (error) {
				await this.sendText(parsed, `Signal group join failed: ${error.message}`);
			}
			return true;
		}
		// Unknown slash text is model input rather than a hidden command.
		void channelConfig;
		return false;
	}
}

/** Strip values that should never be mirrored into plugin UI state. */
export function publicConfig(config) {
	const value = { ...config };
	delete value.allowRemoteDaemon;
	return value;
}

/** Normalize persisted configuration so malformed fields fail closed. */
export function normalizeConfig(value) {
	const raw = value && typeof value === "object" ? value : {};
	const channels = raw.channels && typeof raw.channels === "object" && !Array.isArray(raw.channels) ? raw.channels : {};
	const allowedSenders = Array.isArray(raw.allowedSenders)
		? raw.allowedSenders.map(normalizeSenderId).filter(Boolean).slice(0, 256)
		: [];
	const ownerSenders = Array.isArray(raw.ownerSenders)
		? raw.ownerSenders.map(normalizeSenderId).filter(Boolean).slice(0, 64)
		: [];
	return {
		enabled: raw.enabled === true,
		account: normalizePhone(raw.account),
		daemonUrl: String(raw.daemonUrl || DEFAULT_DAEMON_URL).trim(),
		daemonMode: raw.daemonMode === "external" ? "external" : "managed",
		signalCliPath: String(raw.signalCliPath || "signal-cli").trim() || "signal-cli",
		allowRemoteDaemon: false,
		allowedSenders,
		ownerSenders,
		defaults:
			raw.defaults && typeof raw.defaults === "object" && !Array.isArray(raw.defaults)
				? {
						systemPrompt: String(raw.defaults.systemPrompt || "").slice(0, 32_768),
						promptMode: "append",
						preset: String(raw.defaults.preset || "").trim(),
						workspace: String(raw.defaults.workspace || "").trim(),
						model: String(raw.defaults.model || "").trim(),
						thinkingLevel: String(raw.defaults.thinkingLevel || "").trim(),
					}
				: {},
		channels: Object.fromEntries(
			Object.entries(channels)
				.filter(([key, _channel]) => key.startsWith("dm:") || key.startsWith("group:"))
				.filter(([, channel]) => channel && typeof channel === "object" && !Array.isArray(channel))
				.slice(0, 256)
				.map(([key, channel]) => [
					key,
					{
						enabled: channel.enabled === true,
						name: sanitizeSignalName(channel.name),
						allowSenders: Array.isArray(channel.allowSenders ?? channel.allowedSenders)
							? (channel.allowSenders ?? channel.allowedSenders).map(normalizeSenderId).filter(Boolean).slice(0, 256)
							: [],
						systemPrompt: String(channel.systemPrompt || "").slice(0, 32_768),
						promptMode: "append",
						preset: String(channel.preset || "").trim(),
						workspace: String(channel.workspace || "").trim(),
						model: String(channel.model || "").trim(),
						thinkingLevel: String(channel.thinkingLevel || "").trim(),
						enabledSkills: Array.isArray(channel.enabledSkills) ? channel.enabledSkills.map(String).slice(0, 64) : [],
						enabledExtensions: Array.isArray(channel.enabledExtensions)
							? channel.enabledExtensions.map(String).slice(0, 64)
							: [],
					},
				]),
		),
	};
}

/** Persist config through the host storage adapter. */
async function saveConfig(host, config) {
	await host.storage.set("config", normalizeConfig(config));
}

export default async function activate(host) {
	let config = normalizeConfig((await host.storage.get("config")) || {});
	let sessionMap = (await host.storage.get("channelSessions")) || {};
	if (!sessionMap || typeof sessionMap !== "object" || Array.isArray(sessionMap)) sessionMap = {};

	const gateway = new SignalGateway({
		host,
		getConfig: () => config,
		setConfig: async (next) => {
			config = normalizeConfig(next);
			await saveConfig(host, config);
		},
		getSessionMap: () => sessionMap,
		setSessionMap: async (next) => {
			sessionMap = next && typeof next === "object" ? next : {};
			await host.storage.set("channelSessions", sessionMap);
		},
		log: (level, message) => host.log?.(level, message),
	});

	if (config.enabled && config.account) {
		gateway.start().catch((error) => {
			host.notify?.("error", `Signal gateway failed to start: ${error.message}`);
			host.log?.("error", error.message);
		});
	}

	host.onClientMessage?.(async (message, reply) => {
		const requestId = typeof message?.reqId === "string" ? message.reqId : "";
		const respond = (payload) =>
			reply({
				...payload,
				...(requestId ? { reqId: requestId } : {}),
			});
		try {
			switch (message?.type) {
				case "get_state":
					respond({
						type: "state",
						config: publicConfig(config),
						status: gateway.getStatus(),
						hostCwd: host.cwd,
					});
					break;
				case "save_config": {
					const next = normalizeConfig(message.config || {});
					config = next;
					await saveConfig(host, config);
					await gateway.stop();
					if (config.enabled && config.account) await gateway.start();
					respond({ type: "save_config_done", success: true, status: gateway.getStatus() });
					break;
				}
				case "start":
					config.enabled = true;
					await saveConfig(host, config);
					await gateway.start();
					respond({ type: "gateway_status", success: true, status: gateway.getStatus() });
					break;
				case "stop":
					config.enabled = false;
					await saveConfig(host, config);
					await gateway.stop();
					respond({ type: "gateway_status", success: true, status: gateway.getStatus() });
					break;
				case "test": {
					const next = normalizeConfig(message.config || config);
					const daemon = validateDaemonUrl(next.daemonUrl, false);
					if (!daemon.ok) {
						respond({ type: "test_done", success: false, message: daemon.error });
						break;
					}
					try {
						await daemonRpc(daemon.url, "version", {});
						if (!next.account) {
							respond({
								type: "test_done",
								success: false,
								message: `signal-cli is reachable at ${daemon.url}, but the Signal account is missing or not a valid E.164 number.`,
							});
							break;
						}
						await daemonRpc(daemon.url, "listContacts", {
							account: next.account,
							allRecipients: true,
						});
						respond({
							type: "test_done",
							success: true,
							message: `signal-cli is reachable at ${daemon.url} and account ${next.account} is available.`,
						});
					} catch (error) {
						respond({
							type: "test_done",
							success: false,
							message: `Signal connection test failed for ${daemon.url}${next.account ? ` (account ${next.account})` : ""}: ${formatSignalError(error)}`,
						});
					}
					break;
				}
				default:
					respond({ type: "error", message: `Unknown Signal plugin message: ${message?.type}` });
					break;
			}
		} catch (error) {
			respond({ type: "error", message: formatSignalError(error) });
		}
	});

	return async () => {
		await gateway.stop();
	};
}
