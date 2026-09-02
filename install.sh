#!/usr/bin/env bash
#
# Installs this setup into ~/.pi/agent.
#
# It copies content and asks Pi to install packages; it never deletes and never overwrites
# Pi's own state. settings.json in particular is Pi's registry, not this repo's: packages are
# added through `pi install` (idempotent), and the one key this setup needs is merged only if
# you have not already set it. Your provider, model, theme and trust choices survive re-runs.
#
# Anything about to be overwritten is first archived to ~/.pi/agent/.backups/<date>.tar.gz.
#
#   ./install.sh                     install into ~/.pi/agent
#   ./install.sh --claude            also set up Claude on a Pro/Max subscription
#   ./install.sh --no-packages      content only; skip every npm/pi install
#   PI_AGENT_DIR=/tmp/x ./install.sh install somewhere else

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target="${PI_AGENT_DIR:-${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}}"
stamp="$(date +%Y%m%d-%H%M%S)"
entries=(AGENTS.md presets.json skills prompts agents themes extensions)
# The Claude provider, installed only with --claude. See section 5.
CLAUDE_ADAPTER="npm:pi-claude-bridge@0.7.0"

skip_packages=0; want_claude=0
for arg in "$@"; do
  case "$arg" in
    --no-packages) skip_packages=1 ;;
    --claude) want_claude=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '  %s\n' "$*"; }

# --- 1. Pi must be present, at the version this setup was verified against ---------------------

if ! command -v pi >/dev/null 2>&1; then
  echo "pi is not on PATH. Install it first:" >&2
  echo "  npm install -g @earendil-works/pi-coding-agent@0.84.4" >&2
  exit 1
fi
want="0.84.4"
have="$(pi --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
if [ "$have" != "$want" ] && [ "${PI_AGENT_SKIP_VERSION_CHECK:-}" != "1" ]; then
  echo "This setup was verified against Pi $want; you have ${have:-an unreadable version}." >&2
  echo "Continue anyway with: PI_AGENT_SKIP_VERSION_CHECK=1 ./install.sh" >&2
  exit 1
fi

echo "Installing into $target"
mkdir -p "$target"

# --- 2. Archive whatever is about to be overwritten --------------------------------------------
# One tar per run, node_modules excluded: backups stay small and never pile up as directories.

existing=()
for entry in "${entries[@]}"; do [ -e "$target/$entry" ] && existing+=("$entry"); done
if [ "${#existing[@]}" -gt 0 ]; then
  mkdir -p "$target/.backups"
  tar czf "$target/.backups/$stamp.tar.gz" -C "$target" \
    --exclude "extensions/node_modules" "${existing[@]}"
  say "archived ${existing[*]} to .backups/$stamp.tar.gz"
fi

# --- 3. Copy the content -----------------------------------------------------------------------
# Copy merges and never deletes: a file you added in the target stays. A skill removed from the
# repo therefore also stays until you remove it by hand — the README says so.

for entry in "${entries[@]}"; do cp -R "$here/agent/$entry" "$target/"; done
say "copied: ${entries[*]}"

# --- 4. Pi packages, through Pi itself ---------------------------------------------------------
# Nothing under extensions/ has a dependency any more, so there is no npm install step here:
# the four files left are standalone, and everything with a runtime need is a package below.

if [ "$skip_packages" -eq 0 ]; then
  grep -Ev '^\s*(#|$)' "$here/packages.txt" | while IFS= read -r line; do
    package="${line%%#*}"; package="$(echo "$package" | xargs)"
    [ -z "$package" ] && continue
    PI_CODING_AGENT_DIR="$target" pi install "$package" >/dev/null
    say "pi install $package"
  done
fi

# --- 5. The one settings key this setup needs, merged and never overwritten --------------------
# pi-subagents' builtins do not inherit the global AGENTS.md unless told to; without this the
# working agreement reaches the main model but none of the subagents it dispatches.

node - "$target/settings.json" <<'MERGE'
const fs = require("node:fs");
const path = process.argv[2];
const settings = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : {};
settings.subagents ??= {};
settings.subagents.agentOverrides ??= {};
let changed = false;
for (const agent of ["planner", "reviewer", "scout", "worker"]) {
  const current = settings.subagents.agentOverrides[agent] ?? {};
  if (current.inheritGlobalContext === undefined) {
    settings.subagents.agentOverrides[agent] = { ...current, inheritGlobalContext: true };
    changed = true;
  }
}
if (changed) fs.writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
console.log(changed ? "  merged subagent overrides into settings.json"
                    : "  subagent overrides already present");
MERGE

# Plan mode ships with `read` as its only allowed tool, which leaves the agent unable to look
# at anything: observed on a real session, it reported "bash is blocked and there's no glob or
# grep tool available" and had to ask blind. These four let it explore. `bash` is included
# deliberately — with it in the policy the extension applies its own read-only shell limit, and
# pi-sandbox and cc-safety-net sit underneath either way. safeSubcommands is left unset on
# purpose: a match there bypasses both limited-shell policies completely.

node - "$target/pi-plan-mode.json" <<'PLAN'
const fs = require("node:fs");
const path = process.argv[2];
const settings = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : {};
if (settings.defaultPlanTools === undefined) {
  settings.defaultPlanTools = ["read", "bash", "grep", "find", "ls"];
  fs.writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
  console.log("  set defaultPlanTools so plan mode can explore");
} else {
  console.log("  defaultPlanTools already set; left alone");
}
PLAN

# cc-safety-net blocks what destroys local work; it does not stop what publishes. Verified on a
# real machine: `git push` ran with no confirmation at all. A rulebook adds those blocks back —
# rulebooks can only ADD, never weaken the built-in protection. This writes outside the agent
# directory, into the tool's own config, and never overwrites a rulebook you already have.

rulebook_dir="$HOME/.cc-safety-net/rules/pi-agent-remote-effects"
if [ "$skip_packages" -eq 0 ] && [ ! -f "$rulebook_dir/rulebook.json" ]; then
  mkdir -p "$rulebook_dir"
  cp "$here/rulebook.json" "$rulebook_dir/rulebook.json"
  if npx -y cc-safety-net rule add pi-agent-remote-effects --global >/dev/null 2>&1; then
    say "registered the remote-effects rulebook (push, publish, release need you)"
  else
    say "note: could not register the remote-effects rulebook; run"
    say "      npx -y cc-safety-net rule add pi-agent-remote-effects --global"
  fi
elif [ -f "$rulebook_dir/rulebook.json" ]; then
  say "remote-effects rulebook already present; left alone"
fi

# --- 6. Optional: Claude on a subscription -----------------------------------------------------
# pi-claude-bridge runs Claude through Anthropic's own Agent SDK, and bills against a Pro/Max
# plan the way Claude Code does. It replaces pi-claude-cli, which spawns the `claude` binary
# and had to be forked to be usable at all: 1.1k downloads a month against 19k, and nothing
# published since March.

if [ "$want_claude" -eq 1 ]; then
  PI_CODING_AGENT_DIR="$target" pi install "$CLAUDE_ADAPTER" >/dev/null
  say "pi install $CLAUDE_ADAPTER"
  node - "$target" <<'CLAUDE'
const fs = require("node:fs");
const path = require("node:path");
const target = process.argv[2];
const sp = path.join(target, "settings.json");
const settings = JSON.parse(fs.readFileSync(sp, "utf8"));
if (!settings.defaultProvider) {
  settings.defaultProvider = "claude-bridge";
  settings.defaultModel ??= "claude-opus-5";
  fs.writeFileSync(sp, JSON.stringify(settings, null, 2) + "\n");
  console.log("  defaultProvider set to claude-bridge");
} else {
  console.log(`  defaultProvider is already ${settings.defaultProvider}; left alone`);
}
CLAUDE
fi

# --- 7. What to do next ------------------------------------------------------------------------

cat <<'DONE'

Done. Next:

  pi                    start it
  /login                authenticate a provider
  /theme quiet-dark     the bundled theme
  /usage                what your account has left

Verify the install anytime:  ./check.sh

The sandbox contains bash at the OS. On Linux it needs:
  sudo apt install bubblewrap socat ripgrep
DONE
