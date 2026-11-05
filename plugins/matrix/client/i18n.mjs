/**
 * Bilingual copy for the Matrix plugin panel.
 *
 * Plugin views are plain DOM and do not import the host React i18n runtime.
 * They follow the host's document language instead, falling back to English.
 */

const STRINGS = {
	en: {
		title: "Matrix (decentralized) bot workspace",
		checking: "Checking...",
		configure: "⚙️ Configure credentials",
		botStatusTitle: "🤖 Matrix Bot Sync duplex status (experimental)",
		toggleBot: "Toggle bot service",
		duplexStatus: "Duplex status",
		botUserId: "Bot Matrix ID",
		messagesReceived: "Messages received",
		messagesReplied: "Messages replied",
		messageCount: "{count} messages",
		featureSummary:
			"Connect to a self-hosted Synapse or public Matrix homeserver. Outbound /sync long polling needs no public IP or reverse proxy. Rooms support isolated conversations and slash commands such as <code>/help</code>, <code>/clear</code>, and <code>/status</code>.",
		sendTitle: "📤 Send a message to a Matrix room",
		roomLabel: "Target Room ID (!xxx:server.org):",
		roomPlaceholder: "e.g. !abcdef:matrix.org (leave blank for the default room)",
		messageLabel: "Message text (Markdown supported):",
		messagePlaceholder: "Enter the message to send...",
		send: "🚀 Send message",
		credentialsTitle: "🔮 Matrix bot credentials",
		homeserverLabel: "Homeserver URL (for example https://matrix.org or a private server):",
		tokenLabel: "Access Token (stored encrypted):",
		tokenPlaceholder: "syt_... (copy it from Element or another client)",
		tokenSavedPlaceholder: "•••••• (saved encrypted; leave blank to keep)",
		defaultRoomLabel: "Default Room ID (optional):",
		botControlsTitle: "🤖 Bot duplex and allowlist controls",
		enableBotLabel: "Enable the Matrix bot duplex service (receive through /sync long polling and reply with AI)",
		allowlistLabel: "Allowed users (Matrix IDs such as @user:server, comma-separated; blank allows everyone):",
		allowlistPlaceholder: "@alice:matrix.org, @bob:example.com (blank allows all users)",
		workspaceLabel: "📂 Project root (Workspace Cwd; blank follows the active project, /cwd switches it from chat):",
		workspacePlaceholder: "e.g. /home/me/project (blank follows the active project)",
		quickProject: "Choose an existing project...",
		browse: "📂 Browse...",
		useCurrentProject: "Use current project",
		systemPromptLabel: "Global Matrix prompt",
		systemPromptPlaceholder: "Added after pi-web-ui's normal system prompt, tool guidance, and project context.",
		systemPromptHelp:
			"The normal pi-web-ui prompt is always retained. This text is appended for every Matrix room conversation.",
		modelLabel: "✨ AI model and thinking effort (blank follows global defaults):",
		modelPlaceholder: "Blank = follow the global default model",
		chooseModel: "✨ Choose model...",
		thinkingFollow: "Thinking effort: follow global",
		thinkingOff: "Thinking: off",
		thinkingLow: "Thinking: low",
		thinkingMedium: "Thinking: medium",
		thinkingHigh: "Thinking: high",
		thinkingMax: "Thinking: max",
		testConnection: "🔌 Test connection",
		cancel: "Cancel",
		save: "💾 Save configuration",
		online: "🟢 Online",
		connecting: "🟡 Connecting",
		error: "🔴 Error",
		notStarted: "⚪ Not started",
		connectedStatus: "🟢 Connected (online)",
		connectingStatus: "🟡 Connecting...",
		errorStatus: "🔴 Connection error",
		pickWorkspaceTitle: "Choose the Matrix bot project root",
		enterMessage: "Enter a message to send.",
		testing: "Testing...",
		testPassed: "Connection test passed.",
		testFailed: "Test failed: {detail}",
		saving: "Saving...",
		saveFailed: "Save failed: {detail}",
		sending: "Sending...",
		sendSucceeded: "✅ Matrix message sent.",
		sendFailed: "Send failed: {detail}",
		serverFailure: "The server returned a failure without an error field: {detail}",
		requestTimedOut: 'Matrix UI request timed out while waiting for "{type}".',
		requestNotSent: 'Matrix UI request "{type}" could not be sent.',
		invalidThinking: "Invalid thinking effort.",
	},
	zh: {
		title: "Matrix (去中心化) 机器人工作台",
		checking: "检测中...",
		configure: "⚙️ 配置凭证",
		botStatusTitle: "🤖 Matrix Bot Sync 双工状态 (实验功能)",
		toggleBot: "切换机器人服务",
		duplexStatus: "双工状态",
		botUserId: "机器人 Matrix ID",
		messagesReceived: "已接收消息",
		messagesReplied: "已回复消息",
		messageCount: "{count} 条",
		featureSummary:
			"支持连接自建 Synapse 或公共 Matrix Homeserver。基于 /sync 出站长轮询，零公网 IP、免反代。支持房间对话与会话隔离。支持 <code>/help</code>、<code>/clear</code>、<code>/status</code> 等斜杠指令。",
		sendTitle: "📤 快捷向 Matrix 房间发送消息",
		roomLabel: "目标 Room ID (!xxx:server.org):",
		roomPlaceholder: "如：!abcdef:matrix.org (留空使用默认房间)",
		messageLabel: "消息文本 (支持 Markdown):",
		messagePlaceholder: "输入要发送的消息内容...",
		send: "🚀 发送消息",
		credentialsTitle: "🔮 Matrix 机器人凭证配置",
		homeserverLabel: "Homeserver URL (例如 https://matrix.org 或私有服务器):",
		tokenLabel: "Access Token (加密存储):",
		tokenPlaceholder: "syt_... (从 Element 等客户端设置中获取)",
		tokenSavedPlaceholder: "•••••• (已加密保存，留空保持)",
		defaultRoomLabel: "默认发送 Room ID (可选):",
		botControlsTitle: "🤖 机器人双工与白名单控制",
		enableBotLabel: "启用 Matrix 机器人双向对话服务 (长轮询 Sync 接收并由 AI 回复)",
		allowlistLabel: "允许的用户白名单 (Matrix ID @user:server，逗号分隔，留空不限制):",
		allowlistPlaceholder: "@alice:matrix.org, @bob:example.com (留空允许所有用户)",
		workspaceLabel: "📂 项目根目录 (Workspace Cwd，留空跟随当前项目，支持聊天发 /cwd 切换):",
		workspacePlaceholder: "如：E:/my-project (留空跟随当前项目)",
		quickProject: "快速点选已有项目...",
		browse: "📂 浏览...",
		useCurrentProject: "设为当前项目",
		systemPromptLabel: "全局 Matrix 提示词",
		systemPromptPlaceholder: "在 pi-web-ui 的常规系统提示词、工具指南和项目上下文之后追加。",
		systemPromptHelp: "pi-web-ui 的常规提示词始终保留；此文本会追加到每个 Matrix 房间会话。",
		modelLabel: "✨ AI 模型与思考强度 (留空跟随全局默认):",
		modelPlaceholder: "留空 = 跟随全局默认模型（支持手输或点选）",
		chooseModel: "✨ 选择模型...",
		thinkingFollow: "思考强度：跟随全局",
		thinkingOff: "思考：关闭 (off)",
		thinkingLow: "思考：低 (low)",
		thinkingMedium: "思考：中 (medium)",
		thinkingHigh: "思考：高 (high)",
		thinkingMax: "思考：最大 (max)",
		testConnection: "🔌 测试连接",
		cancel: "取消",
		save: "💾 保存配置",
		online: "🟢 在线",
		connecting: "🟡 连接中",
		error: "🔴 错误",
		notStarted: "⚪ 未启动",
		connectedStatus: "🟢 已连接 (在线)",
		connectingStatus: "🟡 正在连接...",
		errorStatus: "🔴 连接出错",
		pickWorkspaceTitle: "选择 Matrix 机器人执行项目根目录",
		enterMessage: "请输入要发送的消息文本",
		testing: "测试中...",
		testPassed: "连接测试通过！",
		testFailed: "测试失败: {detail}",
		saving: "保存中...",
		saveFailed: "保存失败: {detail}",
		sending: "发送中...",
		sendSucceeded: "✅ Matrix 消息发送成功！",
		sendFailed: "发送失败: {detail}",
		serverFailure: "服务端返回失败但没有 error 字段: {detail}",
		requestTimedOut: 'Matrix UI 请求在等待 "{type}" 时超时。',
		requestNotSent: 'Matrix UI 请求 "{type}" 无法发送。',
		invalidThinking: "无效的思考强度。",
	},
};

/** Resolve the web UI language to one of the plugin's supported dictionaries. */
export function resolveMatrixLocale(rawLocale) {
	return String(rawLocale ?? "")
		.toLowerCase()
		.startsWith("zh")
		? "zh"
		: "en";
}

/** Detect the active host language without coupling the plugin to React internals. */
export function matrixLocaleFromDocument(doc = globalThis.document) {
	const documentLanguage = doc?.documentElement?.getAttribute?.("lang");
	const navigatorLanguage = globalThis.navigator?.language;
	return resolveMatrixLocale(documentLanguage || navigatorLanguage);
}

/** Return a translator for the selected Matrix panel language. */
export function matrixTranslator(locale) {
	const language = resolveMatrixLocale(locale);
	const strings = STRINGS[language];
	return (key, values = {}) => {
		const template = strings[key] ?? STRINGS.en[key] ?? key;
		return template.replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? `{${name}}`));
	};
}
