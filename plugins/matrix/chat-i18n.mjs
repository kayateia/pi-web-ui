/**
 * Chat-facing Matrix gateway copy.
 *
 * These messages are sent into Matrix rooms, so they follow the persisted
 * pi-web-ui locale rather than the language of the incoming message.
 */

const CHAT_STRINGS = {
	en: {
		conversationChanged: "Conversation changed; retry the command.",
		messageCancelled: "Conversation changed; the previous message was not sent.",
		attachmentBusy: "An attachment is still downloading. Wait for it or use /stop.",
		unsupportedImage: "Unsupported image MIME type.",
		unsupportedMessage: "Unsupported Matrix message type: {type}",
		credentialsMissing: "Matrix credentials are not configured.",
		e2eeUnsupported: "End-to-end encrypted Matrix rooms are not supported. Use an unencrypted room.",
		settingsBusy: "Use /stop and wait for the current task to finish before changing channel settings.",
		newConversationBusy: "Use /stop and wait for the current task to finish before starting a new conversation.",
		stopBusy: "Use /stop and wait for the current task to finish before switching models.",
		attachmentDownloadCancelled: "Attachment download cancelled.",
		noActiveTask: "No task is currently running.",
		attachmentAborted: "New conversation started; attachment download cancelled.",
		stopRequested: "Stop requested for the current task.",
		hostCannotStop: "The host did not provide a run ID, so this task cannot be stopped safely.",
		hostStopUnsupported: "The host could not stop this task.",
		freshConversation: "✨ Started a fresh conversation for this Matrix channel (history retained).",
		invalidThinking: "Invalid thinking level.",
		modelUnavailable: "Unknown or unavailable model; use provider/id.",
		cwdAbsolute: "The workspace path must be an absolute directory.",
		cwdDirectory: "The workspace path must be a directory.",
		cwd: "cwd: {cwd}",
		unknownCommand: "Unknown command: {command}. Use /help to see supported commands.",
		help: [
			"🔮 Matrix bot help",
			"/help /new /clear (/reset) /status /stop (/abort)",
			"/model [provider/id|default] /thinking [off|minimal|low|medium|high|xhigh|default]",
			"/cwd [absolute path] (/workspace)",
			"Images are passed to vision-capable models. Files are referenced by local path; audio and video are not transcribed or decoded. E2EE is not supported.",
		].join("\n"),
		status: [
			"Matrix: {state}",
			"Conversation: {conversation}",
			"Running: {running}",
			"Model: {model}",
			"Thinking: {thinking}",
			"cwd: {cwd}",
			"Error: {error}",
		].join("\n"),
		notStarted: "not started",
		none: "none",
		model: "Model: {model}",
		thinking: "Thinking: {thinking}",
		stopped: "Task stopped.",
		failed: "Task failed: {detail}",
		modelError: "model run error",
		noOutput: "Task ended without text output.",
		errorPrefix: "❌ Matrix error: {detail}",
		e2eeAttachment: "End-to-end encrypted attachments are not supported. Use an unencrypted attachment.",
		invalidMediaUrl: "Matrix media has no valid mxc URL.",
		mediaPathOutside: "Matrix media must be stored inside the workspace.",
		mediaTooLarge: "Matrix media exceeds the {limit} MiB limit.",
		invalidMediaType: "Invalid Matrix media type.",
		uploadMissingUri: "Matrix upload returned no content URI.",
	},
	zh: {
		conversationChanged: "会话已切换，请重试命令。",
		messageCancelled: "会话已切换，上一条消息未发送。",
		attachmentBusy: "当前附件正在下载，请等待或使用 /stop。",
		unsupportedImage: "不支持的图片 MIME 类型。",
		unsupportedMessage: "不支持的 Matrix 消息类型：{type}",
		credentialsMissing: "尚未配置 Matrix 凭证。",
		e2eeUnsupported: "不支持端到端加密的 Matrix 房间，请使用未加密房间。",
		settingsBusy: "请先 /stop 并等待任务结束，再切换会话设置。",
		newConversationBusy: "请先 /stop 并等待任务结束，再开启新会话。",
		stopBusy: "请先 /stop 并等待任务结束，再切换模型。",
		attachmentDownloadCancelled: "附件下载已取消。",
		noActiveTask: "当前没有运行中的任务。",
		attachmentAborted: "已开启新会话，附件下载已取消。",
		stopRequested: "已请求停止当前任务。",
		hostCannotStop: "宿主未提供运行 ID，无法安全停止此任务。",
		hostStopUnsupported: "宿主无法停止此任务。",
		freshConversation: "✨ 已为此 Matrix 频道开启全新会话（保留历史）。",
		invalidThinking: "无效的思考强度。",
		modelUnavailable: "未知或不可用的模型，请使用 provider/id。",
		cwdAbsolute: "工作区路径必须是绝对目录。",
		cwdDirectory: "工作区路径必须指向目录。",
		cwd: "cwd: {cwd}",
		unknownCommand: "未知命令：{command}。使用 /help 查看支持的命令。",
		help: [
			"🔮 Matrix 机器人帮助",
			"/help /new /clear (/reset) /status /stop (/abort)",
			"/model [provider/id|default] /thinking [off|minimal|low|medium|high|xhigh|default]",
			"/cwd [绝对目录] (/workspace)",
			"图片会传给支持视觉的模型；文件使用本地路径引用，语音和视频不自动转录或解码。不支持 E2EE。",
		].join("\n"),
		status: [
			"Matrix: {state}",
			"会话: {conversation}",
			"运行: {running}",
			"模型: {model}",
			"思考: {thinking}",
			"cwd: {cwd}",
			"错误: {error}",
		].join("\n"),
		notStarted: "未开始",
		none: "无",
		model: "模型: {model}",
		thinking: "思考: {thinking}",
		stopped: "任务已停止。",
		failed: "任务失败：{detail}",
		modelError: "模型运行错误",
		noOutput: "任务结束（无文本输出）。",
		errorPrefix: "❌ Matrix 错误：{detail}",
		e2eeAttachment: "不支持端到端加密附件，请发送未加密附件。",
		invalidMediaUrl: "Matrix 媒体缺少有效的 mxc URL。",
		mediaPathOutside: "Matrix 媒体必须保存在工作区内。",
		mediaTooLarge: "Matrix 媒体超过 {limit} MiB 限制。",
		invalidMediaType: "无效的 Matrix 媒体类型。",
		uploadMissingUri: "Matrix 上传未返回内容 URI。",
	},
};

/** Normalize any host locale to the Matrix chat copy supported here. */
export function normalizeMatrixLocale(value) {
	return String(value ?? "")
		.toLowerCase()
		.startsWith("zh")
		? "zh"
		: "en";
}

/** Translate one chat-facing Matrix message. */
export function matrixChatText(locale, key, values = {}) {
	const language = normalizeMatrixLocale(locale);
	const template = CHAT_STRINGS[language][key] ?? CHAT_STRINGS.en[key] ?? key;
	return String(template).replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? `{${name}}`));
}

/** Translate common Matrix transport errors while preserving technical HTTP details. */
export function matrixChatError(locale, error) {
	const detail = error instanceof Error ? error.message : String(error ?? "");
	if (/^E2EE encrypted attachments are unsupported/.test(detail)) return matrixChatText(locale, "e2eeAttachment");
	if (/^Media has no valid mxc URL$/.test(detail)) return matrixChatText(locale, "invalidMediaUrl");
	if (/^Workspace must be an absolute directory$/.test(detail) || /^Media path must be inside workspace$/.test(detail))
		return matrixChatText(locale, "mediaPathOutside");
	const limit = /^Media exceeds ([\d.]+) MiB limit$/.exec(detail);
	if (limit) return matrixChatText(locale, "mediaTooLarge", { limit: limit[1] });
	if (/^Invalid media type$/.test(detail)) return matrixChatText(locale, "invalidMediaType");
	if (/^Matrix upload returned no content_uri$/.test(detail)) return matrixChatText(locale, "uploadMissingUri");
	if (/^Matrix credentials are not configured$/.test(detail)) return matrixChatText(locale, "credentialsMissing");
	return detail;
}
