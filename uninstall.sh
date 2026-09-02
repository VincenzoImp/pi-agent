#!/usr/bin/env bash
#
# Removes exactly what install.sh writes, and asks Pi to remove the packages it installed.
# Sessions, credentials, trust decisions and anything you added yourself stay. Backups made by
# install.sh stay too, in ~/.pi/agent/.backups/.
#
#   ./uninstall.sh                remove content and packages
#   ./uninstall.sh --keep-packages    remove only the copied content

set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target="${PI_AGENT_DIR:-${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}}"

if [ "${1:-}" != "--keep-packages" ] && command -v pi >/dev/null 2>&1; then
  grep -Ev '^\s*(#|$)' "$here/packages.txt" | while IFS= read -r line; do
    package="${line%%#*}"; package="$(echo "$package" | xargs)"
    [ -z "$package" ] && continue
    PI_CODING_AGENT_DIR="$target" pi remove "$package" >/dev/null 2>&1 \
      && echo "  pi remove $package" || true
  done
fi

for entry in AGENTS.md presets.json skills prompts agents themes extensions; do
  rm -rf "${target:?}/$entry" && echo "  removed $entry"
done

echo
echo "Done. Left alone: sessions, auth, trust, models, installed npm/git package files,"
echo "the worklog/ directory, and .backups/. settings.json keeps everything except the"
echo "packages Pi itself deregistered."
