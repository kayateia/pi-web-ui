import { randomUUID } from "node:crypto";
import { isAbsolute, resolve, relative, sep, basename } from "node:path";

export const MEDIA_LIMIT = 25 * 1024 * 1024;
export const mediaTypes = { "m.image": "image", "m.audio": "audio", "m.file": "file", "m.video": "video" };
/** Identity one Matrix room as one pi-web-ui channel across users and threads. */
export function channelKey(roomId) {
	return JSON.stringify([roomId]);
}
export function threadOf(content) {
	const relation = content?.["m.relates_to"];
	return relation?.rel_type === "m.thread" ? relation.event_id : "";
}
export function workspacePath(workspace, file) {
	if (!workspace || !isAbsolute(workspace)) throw new Error("Workspace must be an absolute directory");
	const target = resolve(workspace, file);
	const rel = relative(resolve(workspace), target);
	if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
		throw new Error("Media path must be inside workspace");
	return target;
}
export async function limitedBytes(response, limit = MEDIA_LIMIT) {
	if (!response.ok) throw new Error(`Matrix media HTTP ${response.status}`);
	if (Number(response.headers.get("content-length")) > limit) {
		await response.body?.cancel();
		throw new Error(`Media exceeds ${limit / 1024 / 1024} MiB limit`);
	}
	const reader = response.body.getReader();
	const parts = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) throw new Error(`Media exceeds ${limit / 1024 / 1024} MiB limit`);
			parts.push(Buffer.from(value));
		}
	} finally {
		await reader.cancel();
	}
	return Buffer.concat(parts);
}
export async function receiveMedia(bridge, content, workspace, signal) {
	if (content.file)
		throw new Error(
			"E2EE encrypted attachments are unsupported; send an unencrypted attachment in an unencrypted room",
		);
	const match = /^mxc:\/\/([^/]+)\/(.+)$/.exec(content.url || "");
	if (!match) throw new Error("Media has no valid mxc URL");
	const cfg = bridge.getConfig();
	const response = await fetch(
		`${cfg.homeserverUrl.replace(/\/+$/, "")}/_matrix/client/v1/media/download/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`,
		{
			headers: { Authorization: `Bearer ${cfg.accessToken}` },
			signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35000)]) : AbortSignal.timeout(35000),
		},
	);
	const bytes = await limitedBytes(response, content.msgtype === "m.image" ? 10 * 1024 * 1024 : MEDIA_LIMIT);
	const name =
		basename(String(content.filename || content.body || "attachment"))
			.replace(/[^a-zA-Z0-9._-]/g, "_")
			.slice(-100) || "attachment";
	const path = workspacePath(workspace, `.matrix-media/${randomUUID()}-${name}`);
	signal?.throwIfAborted();
	await bridge.host.fs.mkdirPath(resolve(workspace, ".matrix-media"));
	signal?.throwIfAborted();
	await bridge.host.fs.writePath(path, bytes);
	signal?.throwIfAborted();
	return { path, bytes };
}
export async function sendMedia(
	bridge,
	roomId,
	{ path, type = "file", mimetype = "application/octet-stream", text = "", workspace, threadId = "" },
) {
	if (!["image", "audio", "file", "video"].includes(type)) throw new Error("Invalid media type");
	const fullPath = workspacePath(workspace || bridge.host.cwd, path);
	const stat = await bridge.host.fs.statPath(fullPath);
	if (stat.size > MEDIA_LIMIT) throw new Error("Media exceeds 25 MiB limit");
	const bytes = await bridge.host.fs.readPath(fullPath);
	if (bytes.length > MEDIA_LIMIT) throw new Error("Media exceeds 25 MiB limit");
	const cfg = bridge.getConfig();
	const response = await fetch(
		`${cfg.homeserverUrl.replace(/\/+$/, "")}/_matrix/media/v3/upload?filename=${encodeURIComponent(basename(fullPath))}`,
		{
			method: "POST",
			headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": mimetype },
			body: bytes,
			signal: AbortSignal.timeout(35000),
		},
	);
	if (!response.ok) throw new Error(`Matrix upload HTTP ${response.status}`);
	const uploaded = await response.json();
	if (!uploaded.content_uri?.startsWith("mxc://")) throw new Error("Matrix upload returned no content_uri");
	await bridge.sendContent(
		roomId,
		{
			msgtype: `m.${type}`,
			body: text || basename(fullPath),
			filename: basename(fullPath),
			url: uploaded.content_uri,
			info: { mimetype, size: bytes.length },
		},
		threadId,
	);
}
