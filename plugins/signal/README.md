# Signal

Connect a full signal-cli account to pi-web-ui. Incoming DMs and groups are
authorized per sender, mapped to dedicated pi-web-ui conversations, and answered
in the originating channel.

## Requirements

- linked signal-cli account with `signal-cli daemon --http 127.0.0.1:8080`
- the daemon account configured in the Signal plugin panel

The account setup and systemd daemon used by the existing pi-signal integration
are documented at <https://github.com/aalzubidy/pi-signal>.

## Security

- Unknown senders and unconfigured groups are ignored without a reply.
- An empty sender allowlist denies everyone.
- ACI/service IDs are preferred over phone numbers.
- Group channels must be explicitly enabled.
- The daemon URL is loopback-only by default.
- Each channel can use a separate workspace, preset, model, tool profile, and
  system prompt.

## Channels

Channel keys are stable:

```text
group:<signal group id>
dm:aci:<signal service id>
dm:e164:+14165551234
dm:self
```

The channel JSON supports:

```json
{
	"group:AbCd...": {
		"enabled": true,
		"name": "Family",
		"allowSenders": ["aci:..."],
		"systemPrompt": "You are responding in the family group.",
		"preset": "standard",
		"workspace": "/home/user/project",
		"model": "provider/model-id",
		"thinkingLevel": "low"
	}
}
```

Prompt composition is always additive:

1. pi-web-ui's normal system prompt, including its preamble, tool guidance, and
   project context
2. the global Signal prompt from the plugin panel
3. the selected channel's `systemPrompt`

Legacy `promptMode: "replace"` values are ignored so a channel cannot
accidentally drop the normal pi-web-ui prompt.

Commands arriving from an allowed sender:

- `/help`
- `/status`
- `/clear` or `/new`
- `/channels`
- `/join <signal.group URL>` (owner senders only)

After the first successful run, the plugin stores the Pi session file for each
channel. Restarting pi-web-ui reopens that transcript instead of creating a new
one.
