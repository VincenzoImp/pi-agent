# pi-agent

A ready-made working environment for the [Pi](https://github.com/earendil-works/pi) coding
agent: a working agreement, fourteen skills, five prompt chains, and a set of guardrails around
what the agent is allowed to do to your machine.

It is a folder. Everything in it is plain text you can read here in the browser, and there is no
build step — what you read is what runs.

```bash
npm install -g @earendil-works/pi-coding-agent@0.84.4
git clone https://github.com/VincenzoImp/pi-agent && cd pi-agent
./install.sh        # add --claude if you use a Claude Pro/Max subscription
pi
```

`install.sh` copies `agent/` into `~/.pi/agent` and installs the thirteen packages listed in
[`packages.txt`](packages.txt). It only ever adds: your sessions, credentials, provider and
theme choices are Pi's own state and are left untouched, and anything it replaces is archived to
`.backups/` first. Re-run it as often as you like. `./check.sh` proves the result still loads,
and `./uninstall.sh` removes what was installed. (The scripts are bash; on Windows use WSL or
Git Bash.)

## How it works

```
grill → research → plan → implement → review → fix ─┐
  ↑         ↑                  ↑                    │
  └─────────┴──────────────────┴────────────────────┘
        skip, revisit, or repeat any leg
```

`/autonomous` walks the full route; `/quick` exists because most changes are small. Each skill
states the condition under which it does *not* apply, so the agent can skip ahead — ceremony out
of proportion to the work is treated as a defect in its own right.

| | |
|---|---|
| **Agreement** | `AGENTS.md` — precedence, authorisation, evidence, code style, communication. In context every session, and inherited by dispatched subagents |
| **Skills** | `scope-check` `grilling` `research` `planning` `tdd` `implementing` `code-review` `debug` `verification` `delegating` `domain-modeling` `handoff` `prototype` `version-control` |
| **Prompts** | `/autonomous` `/quick` `/implement` `/implement-and-review` `/scout-and-plan` |
| **Subagents** | `planner` reads the scout's `context.md` and writes the `plan.md` the worker reads — the handoff is files, not prose |
| **Guardrails** | destructive-command and secret-path blocking, an OS-level sandbox around `bash` |
| **Tools** | LSP diagnostics, web search and page fetching, MCP, output offloading, redaction |
| **Memory** | notes that survive compaction, and search across past sessions |
| **Comfort** | a statusline, `/usage` for account limits, a theme |

## Guardrails

Instructions are advice a model can talk past. These act on the tools instead, and both are
packages rather than files here — they are maintained by people who do only this:

- **`cc-safety-net`** inspects every command before it runs and blocks destructive ones and
  reads of recognised secret paths. Verified on a real machine: a `cat ~/.aws/notes.txt` came
  back refused by rule `secret.home.aws`, before execution and regardless of the command used.
  It stops what destroys local work but not what publishes, so [`rulebook.json`](rulebook.json)
  adds `git push`, `npm publish`, `docker push` and `gh release create` — those stay yours to
  run. A rulebook can only add blocks; it cannot weaken the built-in ones.
- **`pi-sandbox`** confines the `bash` *process* at the operating system — `sandbox-exec` on
  macOS, `bubblewrap` on Linux — and asks for permission interactively when something wants
  out. `/sandbox` shows the current policy, `/sandbox-allow` widens it for a session.

Two things worth knowing before you rely on them:

- The network allowlist is narrower than people expect. A private registry, or a documentation
  site you want `curl`ed, is unreachable until you allow it. (Web search is unaffected — it
  runs as a tool, not through `bash`.)
- The sandbox wraps `bash` only. A file it would deny to `cat` can still be opened with the
  agent's `read` tool; the command guard and the agreement's non-overridable rules are what
  cover that route.

On Linux the sandbox needs `bubblewrap`, `socat` and `ripgrep` installed — without them it
cannot contain anything, and says so rather than pretending.

## The folder

```
agent/
├── AGENTS.md            the agreement, ~1000 words, always in context
├── presets.json         six tool postures for /preset
├── skills/              14 × SKILL.md — only the descriptions sit in context
├── prompts/             5 × .md → slash commands
├── agents/planner.md    the one subagent with no upstream equivalent
├── themes/              quiet-dark.json
└── extensions/          4 standalone files, no dependencies, no build
    preset.ts  questionnaire.ts  todo.ts  tools.ts
```

Everything with a runtime need — the sandbox, the command guard, memory, plan mode, web
access — is a package in `packages.txt`. This folder used to carry vendored copies of Pi's
examples for the sandbox and plan mode; they were frozen snapshots of code maintained better
elsewhere, so they are installed rather than copied now.

`settings.json` is Pi's own registry — your provider, model, theme and trust decisions live
there, so this repo does not ship one. Packages register themselves through `pi install`, and
the single key this setup needs (subagents inheriting the agreement) is merged in only if you
have not set it yourself.

## Making it yours

Everything is a file:

- **a skill** — `agent/skills/<name>/SKILL.md`; its `description` decides when it loads. Delete
  the ones you do not want
- **the agreement** — `agent/AGENTS.md`, plain prose
- **a prompt** — any markdown file in `agent/prompts/` becomes a slash command
- **a package** — a line in `packages.txt`
- **guard and sandbox** — configured through their own packages (`/sandbox`, `/sandbox-allow`);
  both work with no configuration at all

Edit here and run `./install.sh` again, or edit `~/.pi/agent` directly and copy back what you
want to keep. Note that installing copies without deleting, so a skill you remove from the repo
stays installed until `./uninstall.sh && ./install.sh`.

## Providers

**Claude Pro/Max** — `./install.sh --claude` installs `pi-claude-bridge`, which runs Claude
through Anthropic's own Agent SDK and bills against your plan the way Claude Code does. Select
it with `/model` (`claude-bridge/claude-opus-5` and the rest). On a Max plan, set
`{"provider": {"plan": "max"}}` in `~/.pi/agent/claude-bridge.json` to unlock the 1M context
window on Opus.

**Local models** (Ollama, llama.cpp, vLLM) — write `~/.pi/agent/models.json` once:

```json
{
  "providers": {
    "local": {
      "baseUrl": "http://127.0.0.1:11434/v1",
      "api": "openai-completions",
      "apiKey": "local",
      "models": [{ "id": "qwen3-coder:30b", "contextWindow": 131072, "maxTokens": 32768 }]
    }
  }
}
```

**Web search** works with no API key and no configuration, on any provider — including local
models. Keys for Brave, Tavily, Exa and others are optional and only change which engine is
used.

## Credits

The skills, prompts and working agreement are original, MIT. The four files under
`extensions/` — `preset`, `questionnaire`, `todo`, `tools` — are redistributed from Pi's own
examples, MIT © 2025 Mario Zechner; `NOTICE` records each one. The thirteen installed packages
are third-party and MIT; `packages.txt` names each and what it is for.

Installing any Pi package runs code with your permissions, this one included.
