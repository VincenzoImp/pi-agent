# pi-agent

My [Pi](https://github.com/earendil-works/pi) setup — not a tool that installs one, the folder
itself. Everything is plain text you can read in this browser tab: fifteen skills, five prompt
chains, a working agreement, and the extensions that keep `bash` inside a boundary. No build
step: what you read is what runs.

```bash
npm install -g @earendil-works/pi-coding-agent@0.84.4
git clone https://github.com/VincenzoImp/pi-agent && cd pi-agent
./install.sh        # add --claude if you use a Claude Pro/Max subscription
pi
```

`install.sh` copies `agent/` into `~/.pi/agent`, installs the eight packages in
[`packages.txt`](packages.txt) through `pi install`, and stops. It never deletes, never touches
your sessions, credentials or trust decisions, never overwrites `settings.json` — your provider,
model and theme choices survive every re-run — and archives anything it replaces into
`.backups/`. Run **`./check.sh`** anytime to prove the whole thing still loads. `./uninstall.sh`
removes exactly what was installed. (The scripts are bash; on Windows use WSL or Git Bash.)

## What you get

```
grill → research → plan → implement → review → fix ─┐
  ↑         ↑                  ↑                    │
  └─────────┴──────────────────┴────────────────────┘
        skip, revisit, or repeat any leg
```

`/autonomous` walks the whole route. `/quick` exists because most changes are small. **The route
is a map, not rails**: every skill opens with the condition under which it does not apply, and
ceremony out of proportion to the work is treated as a defect of its own.

| | |
|---|---|
| **Agreement** | `AGENTS.md` — precedence, authorisation, evidence, code style, communication. Loaded every session, and inherited by the subagents that get dispatched |
| **Skills** | `scope-check` `grilling` `research` `planning` `tdd` `implementing` `code-review` `debug` `verification` `delegating` `domain-modeling` `handoff` `prototype` `version-control` `web` |
| **Prompts** | `/autonomous` `/quick` `/implement` `/implement-and-review` `/scout-and-plan` |
| **Subagents** | `planner` reads the scout's `context.md` and writes the `plan.md` the worker reads — the handoff is files, not prose |
| **Limits** | an effects guard, secret-path blocking, an OS sandbox around `bash` |
| **Comfort** | a statusline, `/usage` for account limits, a theme |

## The limits, honestly

Instructions are advice the model can talk past. These act on the tools instead:

- **the effects guard** (`extensions/effects-guard.ts`) inspects every `bash` call the model
  makes: remote effects (push, publish, deploy) need confirmation, and recognised secret paths
  and credential names are blocked from ever entering context. Headless, it fails closed.
- **the sandbox** (`extensions/sandbox/`) contains the `bash` *process* at the OS —
  `sandbox-exec` on macOS, `bubblewrap` on Linux. It applies with no configuration, and its
  defaults deny reads of `~/.ssh` `~/.aws` `~/.gnupg`, deny writes outside the project and
  `/tmp`, and hold **network to an allowlist** (npm, PyPI, GitHub). That last one surprises
  people: a private registry is unreachable until you add it to `extensions/sandbox.json`.
  `pi --no-sandbox` disables it for one session.

Two boundaries these do **not** draw, so you know exactly where you stand:

- the sandbox wraps `bash` only. The model's `read` tool is not sandboxed — a file the sandbox
  denies to `cat` can still be read as a file. The guard's secret-path blocking and the
  agreement's non-overridable rules are what cover that path.
- extension load order is filesystem-dependent and deliberately not relied upon: model commands
  are guarded via `tool_call`, which runs for every extension regardless of order, and the
  dangerous user-typed reads are covered by the sandbox's own defaults either way.

On Linux the sandbox needs `bubblewrap`, `socat` and `ripgrep` (`sudo apt install …`). Without
them it cannot contain anything — and says so rather than pretending.

## The folder

```
agent/
├── AGENTS.md            the agreement, ~1000 words, always in context
├── presets.json         six tool postures for /preset
├── skills/              15 × SKILL.md — only descriptions sit in context
├── prompts/             5 × .md → slash commands
├── agents/planner.md    the one subagent with no upstream equivalent
├── themes/              quiet-dark.json
└── extensions/
    ├── effects-guard.ts   the guard
    ├── worklog.ts         /worklog and /lesson; re-injected after compaction
    ├── sandbox/           vendored from Pi's examples
    ├── plan-mode/ preset.ts questionnaire.ts todo.ts tools.ts
    ├── lib/               shared helpers — not loaded as extensions
    └── package.json       the sandbox runtime, exact-pinned, lockfile committed
```

There is deliberately **no `settings.json` here**: that file is Pi's own registry, where your
provider, theme and trust choices live. Packages are registered through `pi install`, and the
single key this setup needs (subagents inheriting the agreement) is merged only if you have not
set it yourself.

## Making it yours

Everything is a file:

- **a skill** — `agent/skills/<name>/SKILL.md`; the `description` decides *when* it loads.
  Delete the ones you do not want
- **the agreement** — `agent/AGENTS.md`, plain prose
- **a prompt** — any markdown file in `agent/prompts/` is a slash command
- **a package** — a line in `packages.txt`
- **guard / sandbox** — `extensions/effects-guard.json`, `extensions/sandbox.json` in the
  installed folder; both work with no config at all

Edit here and `./install.sh` again, or edit `~/.pi/agent` directly and copy back what you keep.
One honest caveat: install copies and never deletes, so something you *remove* from the repo
stays installed until `./uninstall.sh && ./install.sh`.

## Providers

**Claude Pro/Max** — `./install.sh --claude` installs the CLI adapter, applies the one-word fix
for the bug that silently discards the whole system prompt
([rchern/pi-claude-cli#39](https://github.com/rchern/pi-claude-cli/pull/39)), and selects the
provider unless you already chose one. A `pi update` reverts the patch; re-run the flag after
updating.

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

**Web search** — the `web` skill needs `BRAVE_API_KEY` (or `PI_SEARX_URL` for a SearXNG
instance) in your environment; without one it reports which engines are unavailable.

## Provenance

Skills, prompts, agreement and the two guard/worklog extensions are original, MIT. Everything
under `extensions/` named after a Pi example — `sandbox`, `plan-mode`, `preset`,
`questionnaire`, `todo`, `tools` — is redistributed from Pi's own examples, MIT © 2025 Mario
Zechner; `NOTICE` records each file and the one deliberate modification. The sandbox runtime is
Anthropic's, Apache-2.0, exact-pinned.

Installing any Pi package runs code with your permissions — including this one. It is short,
and it is all here.
