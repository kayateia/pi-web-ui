/**
 * plugins/matrix/client/entry.mjs
 * Matrix workspace and bot control panel for pi-web-ui (experimental).
 */

import { matrixLocaleFromDocument, matrixTranslator } from "./i18n.mjs";

export default {
	async mount(el, ctx) {
		const locale = matrixLocaleFromDocument();
		const t = matrixTranslator(locale);
		let requestSeq = 0;
		const pending = new Map();
		const offData = ctx.onData?.((payload) => {
			const requestId = typeof payload?.reqId === "string" ? payload.reqId : "";
			const waiter = requestId ? pending.get(requestId) : undefined;
			if (!waiter) return;
			pending.delete(requestId);
			clearTimeout(waiter.timer);
			waiter.resolve(payload);
		});
		const sendHost = (type, payload = {}) =>
			new Promise((resolve, reject) => {
				const reqId = `matrix-${Date.now()}-${++requestSeq}`;
				const timer = setTimeout(() => {
					pending.delete(reqId);
					reject(new Error(t("requestTimedOut", { type })));
				}, 25_000);
				pending.set(reqId, { resolve, reject, timer });
				try {
					const sent = ctx.send({ type, reqId, ...payload });
					if (sent === false) {
						clearTimeout(timer);
						pending.delete(reqId);
						reject(new Error(t("requestNotSent", { type })));
					}
				} catch (error) {
					clearTimeout(timer);
					pending.delete(reqId);
					reject(error);
				}
			});

		el.innerHTML = `
			<div class="matrix-root" style="display: flex; flex-direction: column; height: 100%; box-sizing: border-box; background: var(--bg); color: var(--text); font-size: 13px;">
				<!-- Topbar Header -->
				<div style="padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; background: var(--bg-elev);">
					<div style="display: flex; align-items: center; gap: 8px;">
						<span style="font-size: 18px;">🔮</span>
						<span style="font-weight: 600; font-size: 14px;">${t("title")}</span>
						<span class="matrix-status-badge" style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: var(--bg); border: 1px solid var(--border);">${t("checking")}</span>
					</div>
					<div style="display: flex; gap: 8px;">
						<button class="matrix-btn-config" style="padding: 6px 12px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text); cursor: pointer;">${t("configure")}</button>
					</div>
				</div>

				<!-- Main Container -->
				<div style="flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 16px;">
					<!-- Bot Status Overview Card -->
					<div style="border: 1px solid var(--border); border-radius: 6px; padding: 16px; background: var(--bg-elev);">
						<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
							<div style="font-weight: 600; font-size: 14px;">${t("botStatusTitle")}</div>
							<div class="matrix-bot-toggle-wrap">
								<button class="matrix-btn-toggle-bot" style="padding: 4px 10px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text); cursor: pointer; font-size: 12px;">${t("toggleBot")}</button>
							</div>
						</div>
						<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
							<div style="border: 1px solid var(--border); padding: 10px; border-radius: 4px; background: var(--bg);">
								<div style="color: var(--text-dim); font-size: 11px; margin-bottom: 4px;">${t("duplexStatus")}</div>
								<div class="matrix-metric-state" style="font-size: 14px; font-weight: 600;">${t("notStarted")}</div>
							</div>
							<div style="border: 1px solid var(--border); padding: 10px; border-radius: 4px; background: var(--bg);">
								<div style="color: var(--text-dim); font-size: 11px; margin-bottom: 4px;">${t("botUserId")}</div>
								<div class="matrix-metric-userid" style="font-size: 14px; font-weight: 600;">--</div>
							</div>
							<div style="border: 1px solid var(--border); padding: 10px; border-radius: 4px; background: var(--bg);">
								<div style="color: var(--text-dim); font-size: 11px; margin-bottom: 4px;">${t("messagesReceived")}</div>
								<div class="matrix-metric-recv" style="font-size: 14px; font-weight: 600;">${t("messageCount", { count: 0 })}</div>
							</div>
							<div style="border: 1px solid var(--border); padding: 10px; border-radius: 4px; background: var(--bg);">
								<div style="color: var(--text-dim); font-size: 11px; margin-bottom: 4px;">${t("messagesReplied")}</div>
								<div class="matrix-metric-sent" style="font-size: 14px; font-weight: 600;">${t("messageCount", { count: 0 })}</div>
							</div>
						</div>
						<div style="margin-top: 10px; font-size: 12px; color: var(--text-dim); line-height: 1.5;">
							${t("featureSummary")}
						</div>
					</div>

					<!-- Send Message Card -->
					<div style="border: 1px solid var(--border); border-radius: 6px; padding: 16px; background: var(--bg-elev);">
						<div style="font-weight: 600; font-size: 14px; margin-bottom: 12px;">${t("sendTitle")}</div>
						<div style="display: flex; flex-direction: column; gap: 10px;">
							<div>
								<label style="display: block; margin-bottom: 4px; color: var(--text-dim);">${t("roomLabel")}</label>
								<input type="text" class="matrix-send-roomid" placeholder="${t("roomPlaceholder")}" style="width: 100%; box-sizing: border-box; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text);" />
							</div>
							<div>
								<label style="display: block; margin-bottom: 4px; color: var(--text-dim);">${t("messageLabel")}</label>
								<textarea class="matrix-send-text" rows="3" placeholder="${t("messagePlaceholder")}" style="width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text); resize: vertical; font-family: inherit;"></textarea>
							</div>
							<div style="display: flex; justify-content: flex-end; gap: 8px;">
								<button class="matrix-btn-send" style="padding: 6px 16px; border-radius: 4px; border: none; background: var(--accent); color: var(--accent-contrast, #fff); cursor: pointer; font-weight: 500;">${t("send")}</button>
							</div>
						</div>
					</div>
				</div>

				<!-- Settings Modal -->
				<div class="matrix-modal-settings" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center;">
					<div style="width: 520px; max-width: 90vw; max-height: 85vh; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.3);">
						<div style="padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: var(--bg-elev);">
							<span style="font-weight: 600;">${t("credentialsTitle")}</span>
							<button class="matrix-modal-close" style="background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 16px;">✕</button>
						</div>
						<div style="padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px;">
							<div>
								<label style="display: block; margin-bottom: 4px; color: var(--text-dim);">${t("homeserverLabel")}</label>
								<input type="text" class="matrix-cfg-homeserver" placeholder="https://matrix.org" style="width: 100%; box-sizing: border-box; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text);" />
							</div>

							<div>
								<label style="display: block; margin-bottom: 4px; color: var(--text-dim);">${t("tokenLabel")}</label>
								<input type="password" class="matrix-cfg-token" placeholder="${t("tokenPlaceholder")}" style="width: 100%; box-sizing: border-box; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text);" />
							</div>

							<div>
								<label style="display: block; margin-bottom: 4px; color: var(--text-dim);">${t("defaultRoomLabel")}</label>
								<input type="text" class="matrix-cfg-default-room" placeholder="${t("roomPlaceholder")}" style="width: 100%; box-sizing: border-box; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text);" />
							</div>

							<div style="border-top: 1px solid var(--border); padding-top: 12px;">
								<div style="font-weight: 600; margin-bottom: 8px;">${t("botControlsTitle")}</div>
								<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
									<input type="checkbox" id="matrix-cfg-bot-enabled" class="matrix-cfg-bot-enabled" style="cursor: pointer;" />
									<label for="matrix-cfg-bot-enabled" style="font-size: 12px; cursor: pointer; user-select: none;">${t("enableBotLabel")}</label>
								</div>
								<div style="margin-bottom: 8px;">
									<label style="display: block; margin-bottom: 4px; color: var(--text-dim);">${t("allowlistLabel")}</label>
									<input type="text" class="matrix-cfg-allowed-users" placeholder="${t("allowlistPlaceholder")}" style="width: 100%; box-sizing: border-box; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text);" />
								</div>
								<div>
									<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
										<label style="color: var(--text-dim);">${t("workspaceLabel")}</label>
									</div>
									<div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
										<input type="text" class="matrix-cfg-workspace" placeholder="${t("workspacePlaceholder")}" style="flex: 2; min-width: 180px; box-sizing: border-box; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 12px; outline: none;" />
										<select class="matrix-cfg-ws-select" style="min-width: 130px; box-sizing: border-box; padding: 6px 8px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 12px; outline: none;">
											<option value="">${t("quickProject")}</option>
										</select>
										<button type="button" class="matrix-cfg-ws-browse" style="padding: 6px 10px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-elev2); color: var(--text); cursor: pointer;">${t("browse")}</button>
										<button type="button" class="matrix-cfg-use-cwd" style="padding: 6px 10px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-elev2); color: var(--text); cursor: pointer;">${t("useCurrentProject")}</button>
									</div>
								</div>
								<div style="margin-top: 10px;">
									<label style="display: block; margin-bottom: 4px; color: var(--text-dim);">${t("systemPromptLabel")}</label>
									<textarea class="matrix-cfg-system-prompt" rows="6" placeholder="${t("systemPromptPlaceholder")}" style="width: 100%; box-sizing: border-box; padding: 7px 9px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text); font-family: ui-monospace, monospace; font-size: 12px;"></textarea>
									<div style="margin-top: 6px; color: var(--text-dim); font-size: 11px; line-height: 1.45;">${t("systemPromptHelp")}</div>
								</div>
								<div style="margin-top: 10px;">
									<label style="display: block; margin-bottom: 4px; color: var(--text-dim);">${t("modelLabel")}</label>
									<div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
										<input type="text" class="matrix-cfg-model" placeholder="${t("modelPlaceholder")}" style="flex: 2; min-width: 180px; box-sizing: border-box; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 12px; outline: none;" />
										<button type="button" class="matrix-cfg-model-browse" style="padding: 6px 10px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-elev2); color: var(--text); cursor: pointer;">${t("chooseModel")}</button>
										<select class="matrix-cfg-thinking" style="min-width: 130px; box-sizing: border-box; padding: 6px 8px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 12px; outline: none;">
											<option value="">${t("thinkingFollow")}</option>
											<option value="off">${t("thinkingOff")}</option>
											<option value="low">${t("thinkingLow")}</option>
											<option value="medium">${t("thinkingMedium")}</option>
											<option value="high">${t("thinkingHigh")}</option>
											<option value="max">${t("thinkingMax")}</option>
										</select>
									</div>
								</div>
							</div>
						</div>
						<div style="padding: 12px 16px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: var(--bg-elev);">
							<button class="matrix-btn-test-cfg" style="padding: 6px 12px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text); cursor: pointer;">${t("testConnection")}</button>
							<div style="display: flex; gap: 8px;">
								<button class="matrix-modal-cancel" style="padding: 6px 12px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text); cursor: pointer;">${t("cancel")}</button>
								<button class="matrix-btn-save-cfg" style="padding: 6px 16px; border-radius: 4px; border: none; background: var(--accent); color: var(--accent-contrast, #fff); cursor: pointer; font-weight: 500;">${t("save")}</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		`;

		const q = (sel) => el.querySelector(sel);
		const statusBadge = q(".matrix-status-badge");
		const metricState = q(".matrix-metric-state");
		const metricUserId = q(".matrix-metric-userid");
		const metricRecv = q(".matrix-metric-recv");
		const metricSent = q(".matrix-metric-sent");
		const modal = q(".matrix-modal-settings");

		const cfgHomeserver = q(".matrix-cfg-homeserver");
		const cfgToken = q(".matrix-cfg-token");
		const cfgDefaultRoom = q(".matrix-cfg-default-room");
		const cfgBotEnabled = q(".matrix-cfg-bot-enabled");
		const cfgAllowedUsers = q(".matrix-cfg-allowed-users");
		const cfgWorkspace = q(".matrix-cfg-workspace");
		const cfgWsSelect = q(".matrix-cfg-ws-select");
		const cfgWsBrowse = q(".matrix-cfg-ws-browse");
		const cfgSystemPrompt = q(".matrix-cfg-system-prompt");
		const cfgModel = q(".matrix-cfg-model");
		const cfgModelBrowse = q(".matrix-cfg-model-browse");
		const cfgThinking = q(".matrix-cfg-thinking");

		let currentState = {};

		async function refresh() {
			const res = await sendHost("get_state");
			if (!res) return;
			currentState = res;

			const b = res.botStatus || {};
			if (b.state === "connected") {
				statusBadge.textContent = t("online");
				statusBadge.style.color = "var(--green, #22c55e)";
				metricState.textContent = t("connectedStatus");
				metricState.style.color = "var(--green, #22c55e)";
			} else if (b.state === "connecting") {
				statusBadge.textContent = t("connecting");
				statusBadge.style.color = "var(--amber, #eab308)";
				metricState.textContent = t("connectingStatus");
				metricState.style.color = "var(--amber, #eab308)";
			} else if (b.state === "error") {
				statusBadge.textContent = t("error");
				statusBadge.style.color = "var(--red, #ef4444)";
				metricState.textContent = t("errorStatus");
				metricState.style.color = "var(--red, #ef4444)";
			} else {
				statusBadge.textContent = t("notStarted");
				statusBadge.style.color = "var(--text-dim)";
				metricState.textContent = t("notStarted");
				metricState.style.color = "var(--text-dim)";
			}

			metricUserId.textContent = b.botUserId ? b.botUserId : "--";
			metricRecv.textContent = t("messageCount", { count: b.messagesReceived || 0 });
			metricSent.textContent = t("messageCount", { count: b.messagesReplied || 0 });
		}

		q(".matrix-btn-config").addEventListener("click", () => {
			const cfg = currentState.config || {};
			cfgHomeserver.value = cfg.homeserverUrl || "https://matrix.org";
			cfgToken.value = "";
			cfgToken.placeholder = cfg.hasAccessToken ? t("tokenSavedPlaceholder") : t("tokenPlaceholder");
			cfgDefaultRoom.value = cfg.defaultRoomId || "";
			cfgBotEnabled.checked = Boolean(cfg.botEnabled);
			cfgAllowedUsers.value = Array.isArray(cfg.allowedUsers) ? cfg.allowedUsers.join(", ") : "";
			cfgWorkspace.value = cfg.workspace || "";
			cfgSystemPrompt.value = cfg.systemPrompt || "";
			cfgModel.value = cfg.model || "";
			cfgThinking.value = cfg.thinkingLevel || "";

			try {
				const hostProjects = globalThis.window?.__piWebUiHost?.listProjects?.() ?? [];
				cfgWsSelect.innerHTML = `<option value="">${t("quickProject")}</option>`;
				for (const p of hostProjects) {
					if (!p) continue;
					const name =
						p
							.replace(/[\\/]+$/, "")
							.split(/[\\/]/)
							.pop() || p;
					const opt = document.createElement("option");
					opt.value = p;
					opt.textContent = `${name} (${p})`;
					cfgWsSelect.appendChild(opt);
				}
			} catch {}

			modal.style.display = "flex";
		});

		q(".matrix-cfg-use-cwd")?.addEventListener("click", () => {
			if (currentState.hostCwd) cfgWorkspace.value = currentState.hostCwd;
		});
		cfgWsSelect?.addEventListener("change", () => {
			if (cfgWsSelect.value) cfgWorkspace.value = cfgWsSelect.value;
		});
		cfgWsBrowse?.addEventListener("click", async () => {
			const host = globalThis.window?.__piWebUiHost;
			if (typeof host?.pickDirectory !== "function") return;
			const res = await host.pickDirectory({
				title: t("pickWorkspaceTitle"),
				initialPath: cfgWorkspace.value.trim() || currentState.hostCwd || "",
			});
			if (res?.ok && res.path) {
				cfgWorkspace.value = res.path;
			}
		});
		cfgModelBrowse?.addEventListener("click", async () => {
			const host = globalThis.window?.__piWebUiHost;
			if (typeof host?.pickModel !== "function") return;
			const res = await host.pickModel({
				currentModelId: cfgModel.value.trim() || undefined,
			});
			if (res?.ok && res.modelId) {
				cfgModel.value = res.modelId;
			}
		});
		q(".matrix-modal-close").addEventListener("click", () => (modal.style.display = "none"));
		q(".matrix-modal-cancel").addEventListener("click", () => (modal.style.display = "none"));

		q(".matrix-btn-test-cfg").addEventListener("click", async () => {
			const btn = q(".matrix-btn-test-cfg");
			btn.disabled = true;
			btn.textContent = t("testing");
			const testCfg = {
				homeserverUrl: cfgHomeserver.value.trim() || "https://matrix.org",
				accessToken: cfgToken.value.trim(),
			};
			try {
				const res = await sendHost("test_config", { config: testCfg });
				const detail =
					(locale === "en" ? res?.messageEn || res?.message : res?.message || res?.messageEn) ||
					res?.error ||
					(res?.success ? t("testPassed") : t("testFailed", { detail: JSON.stringify(res) }));
				alert?.(detail);
			} catch (error) {
				alert?.(t("testFailed", { detail: error.message }));
			} finally {
				btn.disabled = false;
				btn.textContent = t("testConnection");
			}
		});

		q(".matrix-btn-save-cfg").addEventListener("click", async () => {
			const btn = q(".matrix-btn-save-cfg");
			btn.disabled = true;
			btn.textContent = t("saving");

			const newCfg = {
				homeserverUrl: cfgHomeserver.value.trim() || "https://matrix.org",
				accessToken: cfgToken.value.trim(),
				defaultRoomId: cfgDefaultRoom.value.trim(),
				botEnabled: Boolean(cfgBotEnabled.checked),
				allowedUsers: cfgAllowedUsers.value
					.split(/[,，\s]+/)
					.map((s) => s.trim())
					.filter(Boolean),
				workspace: cfgWorkspace.value.trim(),
				systemPrompt: cfgSystemPrompt.value,
				model: cfgModel.value.trim(),
				thinkingLevel: cfgThinking.value,
			};

			try {
				const res = await sendHost("save_config", { config: newCfg });
				if (res?.success) {
					modal.style.display = "none";
					refresh();
				} else {
					const detail =
						(locale === "en" ? res?.messageEn || res?.message : res?.message || res?.messageEn) ||
						res?.error ||
						t("serverFailure", { detail: JSON.stringify(res) });
					alert?.(t("saveFailed", { detail }));
				}
			} catch (error) {
				alert?.(t("saveFailed", { detail: error.message }));
			} finally {
				btn.disabled = false;
				btn.textContent = t("save");
			}
		});

		q(".matrix-btn-toggle-bot").addEventListener("click", async () => {
			const isRunning = currentState.botStatus?.state === "connected";
			const action = isRunning ? "stop_bot" : "start_bot";
			await sendHost(action);
			refresh();
		});

		q(".matrix-btn-send").addEventListener("click", async () => {
			const roomInput = q(".matrix-send-roomid");
			const textInput = q(".matrix-send-text");
			const text = textInput.value.trim();
			if (!text) {
				alert?.(t("enterMessage"));
				return;
			}

			const btn = q(".matrix-btn-send");
			btn.disabled = true;
			btn.textContent = t("sending");
			try {
				const res = await sendHost("send_message", {
					roomId: roomInput.value.trim(),
					text,
				});
				if (res?.success) {
					alert?.(t("sendSucceeded"));
					textInput.value = "";
				} else {
					const detail =
						(locale === "en" ? res?.messageEn || res?.message : res?.message || res?.messageEn) ||
						res?.error ||
						t("serverFailure", { detail: JSON.stringify(res) });
					alert?.(t("sendFailed", { detail }));
				}
			} catch (error) {
				alert?.(t("sendFailed", { detail: error.message }));
			} finally {
				btn.disabled = false;
				btn.textContent = t("send");
			}
		});

		await refresh();
		return () => {
			offData?.();
			for (const waiter of pending.values()) {
				clearTimeout(waiter.timer);
				waiter.reject(new Error("Matrix panel closed."));
			}
			pending.clear();
		};
	},
};
