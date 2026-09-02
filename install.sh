#!/usr/bin/env bash
#
# Installs this setup into ~/.pi/agent.
#
# It copies; it never deletes. Sessions, credentials, trust decisions and downloaded packages
# belong to Pi and are not touched. Anything it is about to overwrite is backed up first, dated,
# so a second run is safe and so is a first run on a machine that already has a setup.
#
#   ./install.sh                 install into ~/.pi/agent
#   PI_AGENT_DIR=/tmp/x ./install.sh   install somewhere else
#   ./install.sh --no-packages   skip the npm installs, for a quick content-only update

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target="${PI_AGENT_DIR:-${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}}"
stamp="$(date +%Y%m%d-%H%M%S)"
backup="$target/.backup-$stamp"
skip_packages=0
[ "${1:-}" = "--no-packages" ] && skip_packages=1

# Everything Pi owns. Named here so the reader can see exactly what is out of bounds.
readonly PI_STATE="sessions auth.json trust.json models-store.json npm git context.db"

say() { printf '  %s\n' "$*"; }

# --- 1. Pi has to be there, and be the version this setup was verified against -----------------

if ! command -v pi >/dev/null 2>&1; then
  echo "pi is not on PATH. Install it first:" >&2
  echo "  npm install -g @earendil-works/pi-coding-agent@0.84.4" >&2
  exit 1
fi

want="0.84.4"
have="$(pi --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
if [ "$have" != "$want" ]; then
  echo "This setup was verified against Pi $want; you have ${have:-an unreadable version}." >&2
  echo "Continue anyway with: PI_AGENT_SKIP_VERSION_CHECK=1 ./install.sh" >&2
  [ "${PI_AGENT_SKIP_VERSION_CHECK:-}" = "1" ] || exit 1
fi

echo "Installing into $target"

# --- 2. Back up whatever would be overwritten --------------------------------------------------

mkdir -p "$target"
for entry in AGENTS.md settings.json presets.json skills prompts agents themes extensions; do
  if [ -e "$target/$entry" ]; then
    mkdir -p "$backup"
    cp -R "$target/$entry" "$backup/"
  fi
done
if [ -d "$backup" ]; then
  say "backed up existing files to $backup"
fi

# --- 3. Copy the content -----------------------------------------------------------------------

# -R over the directory contents, so nothing outside these names is considered, let alone removed.
for entry in AGENTS.md settings.json presets.json skills prompts agents themes extensions; do
  cp -R "$here/agent/$entry" "$target/"
done
chmod +x "$target"/skills/web/*.sh 2>/dev/null || true
say "copied skills, prompts, agents, extensions, themes, agreement, settings"

# Prove the promise rather than assert it: Pi's own state must still be there.
for entry in $PI_STATE; do
  [ -e "$target/$entry" ] && say "left untouched: $entry"
done || true

# --- 4. Extension dependencies -----------------------------------------------------------------

if [ "$skip_packages" -eq 0 ]; then
  ( cd "$target/extensions" && npm install --silent --no-audit --no-fund )
  say "installed extension dependencies (the sandbox runtime)"
fi

# --- 5. Pi packages ----------------------------------------------------------------------------
# settings.json already lists them, but user-scoped packages are not fetched until asked.

if [ "$skip_packages" -eq 0 ]; then
  packages="$(node -e 'const s=require(process.argv[1]);console.log((s.packages||[]).join("\n"))' "$here/agent/settings.json")"
  while IFS= read -r package; do
    [ -z "$package" ] && continue
    PI_CODING_AGENT_DIR="$target" pi install "$package" >/dev/null
    say "installed $package"
  done <<< "$packages"
fi

# --- 6. What to do next ------------------------------------------------------------------------

cat <<'DONE'

Done. Next:

  pi                          start it
  /login                      authenticate a provider
  /theme quiet-dark           if you want the theme
  /statusline                 configure the footer
  /usage                      what your account has left

The sandbox contains bash at the OS. On Linux it needs bwrap, socat and rg:
  sudo apt install bubblewrap socat ripgrep

Configure it in extensions/sandbox.json, and the effects guard in
extensions/effects-guard.json. Both work without any config at all.
DONE
