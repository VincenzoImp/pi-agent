# pi-agent

My [Pi](https://github.com/earendil-works/pi) setup. Not a tool that installs one — the folder
itself. Everything here is plain text you can read in this browser tab: fifteen skills, five
prompt chains, a working agreement, and the extensions that keep `bash` inside a boundary.

```bash
npm install -g @earendil-works/pi-coding-agent@0.84.4
git clone https://github.com/VincenzoImp/pi-agent && cd pi-agent && ./install.sh
pi
```

That copies `agent/` into `~/.pi/agent`, installs eight packages, and stops. It never touches
your sessions, credentials or trust decisions, and it backs up anything it overwrites.

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
| **Limits** | an effects guard, secret-path blocking, and an OS sandbox around `bash` |
| **Comfort** | a statusline, account usage, a theme |

## The limits are the point

Most setups are a pile of instructions. Instructions are advice the model can talk past. These
cannot be talked past:

```
     ┌─ asks before remote effects ─┐
bash ┤                              │  reads the command text: catches mistakes
     └─ blocks secret paths ────────┘
                ↓
     ┌──────────────────────────────┐
     │  SANDBOX (sandbox-exec/bwrap)│  contains the process: catches everything else
     └──────────────────────────────┘
```

Order matters, and it is not an accident. `user_bash` handlers are first-wins in Pi: the guard
runs first and returns nothing for a command it allows, so the sandbox still sees it. Reversed,
the sandbox would answer every command and the guard would silently stop running.

The sandbox applies with no configuration, and its defaults restrict more than files:

| | default |
|---|---|
| reads denied | `~/.ssh`, `~/.aws`, `~/.gnupg` |
| writes allowed | working directory and `/tmp` |
| writes denied | `.env`, `.env.*`, `*.pem`, `*.key` |
| network | **allowlist**: npm, PyPI, GitHub |

That last row surprises people: a private registry or internal API is unreachable until you add
it to `extensions/sandbox.json`. `pi --no-sandbox` disables it for one session.

On Linux it needs `bubblewrap`, `socat` and `ripgrep`. Without them it cannot contain anything,
and says so rather than pretending.

## The folder

```
agent/
├── AGENTS.md            the agreement, ~1000 words, always in context
├── settings.json        packages, compaction thresholds, subagent overrides
├── presets.json         six tool postures for /preset
├── skills/              15 × SKILL.md — only descriptions sit in context
├── prompts/             5 × .md → slash commands
├── agents/planner.md    the one subagent with no upstream equivalent
├── themes/              quiet-dark.json
└── extensions/
    ├── effects-guard.ts   confirms remote effects, blocks secret paths
    ├── worklog.ts         /worklog and /lesson; survives compaction
    ├── sandbox/           vendored from Pi's examples
    ├── plan-mode/ preset.ts questionnaire.ts todo.ts tools.ts
    └── lib/               helpers; not in extensions/*.ts, so not loaded as extensions
```

**No build step.** What you read is what runs. Change a skill, restart `pi`, it is different.

Eight packages come from npm and are listed in `settings.json`: LSP, a context sidecar, MCP,
redaction, subagents, goals, a statusline and usage. Each is pinned to an exact version.

## Making it yours

Everything is a file, so everything is editable:

- **a skill** — `agent/skills/<name>/SKILL.md`. The `description` decides *when* it loads, so
  front-load the trigger. Delete the ones you do not want
- **the agreement** — `agent/AGENTS.md`, plain prose
- **a prompt** — a markdown file in `agent/prompts/` is a slash command
- **the guard** — `extensions/effects-guard.json`, `{"effects": true, "secrets": true}`
- **the sandbox** — `extensions/sandbox.json`
- **a theme** — copy `themes/quiet-dark.json` and change the colours

Then `./install.sh` again, or edit `~/.pi/agent` directly and copy back what you like.

## Claude on a subscription

If you use a Claude Pro/Max plan, Pi talks to the API by default and **bills per token, not from
your plan**. Route it through the CLI instead:

```bash
pi install npm:pi-claude-cli@0.3.1
# then in ~/.pi/agent/settings.json:
#   "defaultProvider": "pi-claude-cli", "defaultModel": "claude-opus-4-5"
```

⚠️ At `0.3.1` that adapter passes a file path to `--append-system-prompt`, a flag that takes
literal text — so the agreement and every skill are silently replaced by a path string and never
reach the model. Until [rchern/pi-claude-cli#39](https://github.com/rchern/pi-claude-cli/pull/39)
lands, patch one word in
`~/.pi/agent/npm/node_modules/pi-claude-cli/src/process-manager.ts`:

```diff
- args.push("--append-system-prompt", tmpFile);
+ args.push("--append-system-prompt-file", tmpFile);
```

## Uninstalling

`install.sh` only ever adds. To undo it, delete what it wrote:

```bash
cd ~/.pi/agent && rm -rf AGENTS.md settings.json presets.json skills prompts agents themes extensions
```

Your sessions, credentials and installed packages are elsewhere and stay.

## Provenance

The skills, prompts, agreement and the two guard extensions are original, MIT. Everything under
`extensions/` named after a Pi example — `sandbox`, `plan-mode`, `preset`, `questionnaire`,
`todo`, `tools` — is redistributed verbatim from Pi's own examples, MIT, © 2025 Mario Zechner;
see `NOTICE`.

Installing any Pi package runs code with your permissions, including this one. Read it first —
it is short and it is all here.
