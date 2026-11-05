/**
 * Signal gateway settings and status panel.
 */
export default {
	async mount(el, ctx) {
		let state = {};
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
		const send = (type, payload = {}) =>
			new Promise((resolve, reject) => {
				const reqId = `signal-${Date.now()}-${++requestSeq}`;
				const timer = setTimeout(() => {
					pending.delete(reqId);
					reject(new Error(`Signal UI request timed out while waiting for "${type}".`));
				}, 25_000);
				pending.set(reqId, { resolve, reject, timer });
				try {
					const sent = ctx.send({ type, reqId, ...payload });
					if (sent === false) {
						clearTimeout(timer);
						pending.delete(reqId);
						reject(new Error(`Signal UI request "${type}" could not be sent.`));
					}
				} catch (error) {
					clearTimeout(timer);
					pending.delete(reqId);
					reject(error);
				}
			});

		el.innerHTML = `
			<div class="signal-panel" style="display:flex;flex-direction:column;height:100%;box-sizing:border-box;background:var(--bg);color:var(--text);font-size:13px;">
				<div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--bg-elev);">
					<div style="display:flex;align-items:center;gap:8px;min-width:0;">
						<span style="font-size:20px;">🔐</span>
						<strong>Signal gateway</strong>
						<span class="signal-badge" style="font-size:11px;padding:2px 7px;border-radius:999px;border:1px solid var(--border);">checking</span>
					</div>
					<div style="display:flex;gap:8px;">
						<button class="btn signal-toggle" type="button" style="padding:6px 12px;">Start</button>
						<button class="btn primary signal-save" type="button" style="padding:6px 12px;">Save</button>
					</div>
				</div>
				<div style="flex:1;overflow:auto;padding:16px;display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,0.65fr);gap:16px;align-content:start;">
					<section style="border:1px solid var(--border);border-radius:8px;background:var(--bg-elev);padding:16px;min-width:0;">
						<h3 style="margin:0 0 12px;font-size:14px;">Connection</h3>
						<div style="display:flex;flex-direction:column;gap:10px;">
							<label>Signal account (E.164)
								<input class="signal-account" type="text" placeholder="+14165551234" style="width:100%;box-sizing:border-box;margin-top:4px;padding:7px 9px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);" />
							</label>
							<label>signal-cli daemon URL
								<input class="signal-daemon" type="text" placeholder="http://127.0.0.1:8080" style="width:100%;box-sizing:border-box;margin-top:4px;padding:7px 9px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);" />
							</label>
							<label>Daemon lifecycle
								<select class="signal-daemon-mode" style="width:100%;box-sizing:border-box;margin-top:4px;padding:7px 9px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);">
									<option value="managed">Managed by this plugin</option>
									<option value="external">External / systemd</option>
								</select>
							</label>
							<label>signal-cli executable
								<input class="signal-cli-path" type="text" placeholder="signal-cli" style="width:100%;box-sizing:border-box;margin-top:4px;padding:7px 9px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);" />
							</label>
							<label style="display:flex;align-items:center;gap:8px;">
								<input class="signal-enabled" type="checkbox" />
								<span>Enable the Signal gateway</span>
							</label>
							<div style="display:flex;gap:8px;">
								<button class="btn signal-test" type="button" style="padding:6px 10px;">Test daemon</button>
							</div>
						</div>
					</section>

					<section style="border:1px solid var(--border);border-radius:8px;background:var(--bg-elev);padding:16px;min-width:0;">
						<h3 style="margin:0 0 12px;font-size:14px;">Live status</h3>
						<div class="signal-metrics" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;"></div>
					</section>

					<section style="border:1px solid var(--border);border-radius:8px;background:var(--bg-elev);padding:16px;min-width:0;">
						<h3 style="margin:0 0 12px;font-size:14px;">Access control</h3>
						<label>People allowed to talk to the agent
							<textarea class="signal-allowed" rows="5" placeholder="aci:2b...&#10;e164:+14165559876" style="width:100%;box-sizing:border-box;margin-top:4px;padding:7px 9px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);font-family:ui-monospace,monospace;"></textarea>
						</label>
						<div style="margin-top:6px;color:var(--text-dim);font-size:11px;line-height:1.45;">ACI/service IDs are preferred. An empty allowlist denies everyone.</div>
						<label style="display:block;margin-top:12px;">Owner senders (commands such as /join)
							<textarea class="signal-owners" rows="3" placeholder="aci:..." style="width:100%;box-sizing:border-box;margin-top:4px;padding:7px 9px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);font-family:ui-monospace,monospace;"></textarea>
						</label>
					</section>

					<section style="border:1px solid var(--border);border-radius:8px;background:var(--bg-elev);padding:16px;min-width:0;">
						<h3 style="margin:0 0 12px;font-size:14px;">Default channel profile</h3>
						<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
							<label>Preset
								<input class="signal-preset" type="text" placeholder="standard" style="width:100%;box-sizing:border-box;margin-top:4px;padding:7px 9px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);" />
							</label>
							<label>Thinking
								<select class="signal-thinking" style="width:100%;box-sizing:border-box;margin-top:4px;padding:7px 9px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);">
									<option value="">Follow global</option>
									<option value="off">off</option>
									<option value="minimal">minimal</option>
									<option value="low">low</option>
									<option value="medium">medium</option>
									<option value="high">high</option>
									<option value="xhigh">xhigh</option>
									<option value="max">max</option>
								</select>
							</label>
						</div>
						<label style="display:block;margin-top:10px;">Workspace (blank follows the active project)
							<input class="signal-workspace" type="text" style="width:100%;box-sizing:border-box;margin-top:4px;padding:7px 9px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);" />
						</label>
						<label style="display:block;margin-top:10px;">Model (provider/model-id)
							<input class="signal-model" type="text" style="width:100%;box-sizing:border-box;margin-top:4px;padding:7px 9px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);" />
						</label>
						<label style="display:block;margin-top:10px;">Global Signal prompt
							<textarea class="signal-prompt" rows="8" placeholder="Added after pi-web-ui's normal system prompt, tool guidance, and project context." style="width:100%;box-sizing:border-box;margin-top:4px;padding:7px 9px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);font-family:ui-monospace,monospace;"></textarea>
						</label>
						<div style="margin-top:6px;color:var(--text-dim);font-size:11px;line-height:1.45;">The normal pi-web-ui prompt is always retained. Channel prompts are added after this global Signal prompt.</div>
					</section>

					<section style="grid-column:1/-1;border:1px solid var(--border);border-radius:8px;background:var(--bg-elev);padding:16px;min-width:0;">
						<h3 style="margin:0 0 8px;font-size:14px;">Channels</h3>
						<div style="color:var(--text-dim);font-size:11px;line-height:1.5;margin-bottom:10px;">
							Groups require an explicit enabled entry. Dialogue is keyed by <code>group:&lt;groupId&gt;</code> or <code>dm:&lt;aci&gt;</code>. Each entry supports the same profile fields as the defaults, plus <code>allowSenders</code>. A channel's <code>systemPrompt</code> is appended after the global Signal prompt.
						</div>
						<textarea class="signal-channels" rows="14" spellcheck="false" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);font-family:ui-monospace,monospace;line-height:1.45;"></textarea>
						<div style="margin-top:12px;">
							<h4 style="margin:0 0 6px;font-size:12px;">Recently discovered but blocked</h4>
							<div class="signal-discovered" style="color:var(--text-dim);font-size:11px;line-height:1.6;">None</div>
						</div>
					</section>
				</div>
			</div>
		`;

		const q = (selector) => el.querySelector(selector);
		const account = q(".signal-account");
		const daemon = q(".signal-daemon");
		const daemonMode = q(".signal-daemon-mode");
		const signalCliPath = q(".signal-cli-path");
		const enabled = q(".signal-enabled");
		const allowed = q(".signal-allowed");
		const owners = q(".signal-owners");
		const preset = q(".signal-preset");
		const thinking = q(".signal-thinking");
		const workspace = q(".signal-workspace");
		const model = q(".signal-model");
		const prompt = q(".signal-prompt");
		const channels = q(".signal-channels");
		const badge = q(".signal-badge");
		const metrics = q(".signal-metrics");
		const discovered = q(".signal-discovered");
		const toggle = q(".signal-toggle");

		function fill(config = {}) {
			const defaults = config.defaults || {};
			account.value = config.account || "";
			daemon.value = config.daemonUrl || "http://127.0.0.1:8080";
			daemonMode.value = config.daemonMode === "external" ? "external" : "managed";
			signalCliPath.value = config.signalCliPath || "signal-cli";
			enabled.checked = config.enabled === true;
			allowed.value = Array.isArray(config.allowedSenders) ? config.allowedSenders.join("\n") : "";
			owners.value = Array.isArray(config.ownerSenders) ? config.ownerSenders.join("\n") : "";
			preset.value = defaults.preset || "";
			thinking.value = defaults.thinkingLevel || "";
			workspace.value = defaults.workspace || "";
			model.value = defaults.model || "";
			prompt.value = defaults.systemPrompt || "";
			channels.value = JSON.stringify(config.channels || {}, null, 2);
		}

		function readConfig() {
			let parsedChannels;
			try {
				parsedChannels = channels.value.trim() ? JSON.parse(channels.value) : {};
			} catch (error) {
				throw new Error(`Channels JSON: ${error.message}`);
			}
			return {
				enabled: enabled.checked,
				account: account.value.trim(),
				daemonUrl: daemon.value.trim(),
				daemonMode: daemonMode.value,
				signalCliPath: signalCliPath.value.trim() || "signal-cli",
				allowedSenders: allowed.value
					.split(/[\n,，]+/)
					.map((value) => value.trim())
					.filter(Boolean),
				ownerSenders: owners.value
					.split(/[\n,，]+/)
					.map((value) => value.trim())
					.filter(Boolean),
				defaults: {
					preset: preset.value.trim(),
					thinkingLevel: thinking.value,
					workspace: workspace.value.trim(),
					model: model.value.trim(),
					systemPrompt: prompt.value,
				},
				channels: parsedChannels,
			};
		}

		function renderStatus(status = {}) {
			const connected = status.connected === true;
			badge.textContent = connected ? "connected" : status.state || "idle";
			badge.style.color = connected ? "var(--green)" : "var(--text-dim)";
			toggle.textContent = connected ? "Stop" : "Start";
			metrics.innerHTML = "";
			const rows = [
				["Daemon", status.daemonUrl || daemon.value || "(not set)"],
				["Lifecycle", status.daemonMode || daemonMode.value],
				["Owned process", status.daemonManaged ? "yes" : "no"],
				["Account", status.account || "(not set)"],
				["Received", String(status.messagesReceived || 0)],
				["Replied", String(status.messagesReplied || 0)],
				["Blocked", String(status.messagesBlocked || 0)],
				["Active channel queues", String((status.activeChannels || []).length)],
				["Configured channels", String(status.configuredChannels || 0)],
				["Last error", status.lastError || "none"],
			];
			for (const [label, value] of rows) {
				const card = document.createElement("div");
				card.style.cssText =
					"border:1px solid var(--border);border-radius:5px;padding:8px;background:var(--bg);min-width:0;";
				const title = document.createElement("div");
				title.style.cssText = "color:var(--text-dim);font-size:10px;margin-bottom:3px;";
				title.textContent = label;
				const content = document.createElement("div");
				content.style.cssText = "font-size:12px;overflow-wrap:anywhere;";
				content.textContent = value;
				card.append(title, content);
				metrics.appendChild(card);
			}
			const items = Array.isArray(status.discoveredChannels) ? status.discoveredChannels : [];
			discovered.textContent = "";
			if (!items.length) {
				discovered.textContent = "None";
			} else {
				for (const item of items) {
					const row = document.createElement("div");
					row.textContent = `${item.title || item.key} · ${item.key} · last sender ${item.lastSender}`;
					discovered.appendChild(row);
				}
			}
		}

		async function refresh() {
			state = (await send("get_state")) || {};
			fill(state.config || {});
			renderStatus(state.status || {});
		}

		q(".signal-save").addEventListener("click", async () => {
			try {
				const result = await send("save_config", { config: readConfig() });
				if (!result?.success) throw new Error(result?.message || "Save failed");
				state.config = result.config || readConfig();
				renderStatus(result.status || {});
			} catch (error) {
				alert?.(error.message);
			}
		});

		q(".signal-test").addEventListener("click", async () => {
			try {
				const result = await send("test", { config: readConfig() });
				const detail =
					result?.message ||
					result?.error ||
					(result?.success ? "Daemon reachable." : `Test failed: ${JSON.stringify(result)}`);
				alert?.(detail);
			} catch (error) {
				alert?.(error.message);
			}
		});

		toggle.addEventListener("click", async () => {
			try {
				const starting = toggle.textContent !== "Stop";
				if (starting) {
					const config = readConfig();
					const saved = await send("save_config", { config: { ...config, enabled: false } });
					if (!saved?.success) throw new Error(saved?.message || "Save failed");
				}
				const result = await send(starting ? "start" : "stop");
				if (result?.error) throw new Error(result.error);
				enabled.checked = starting;
				renderStatus(result?.status || {});
			} catch (error) {
				alert?.(error.message);
			}
		});

		await refresh();
		return () => {
			offData?.();
			for (const waiter of pending.values()) {
				clearTimeout(waiter.timer);
				waiter.reject(new Error("Signal panel closed."));
			}
			pending.clear();
		};
	},
};
