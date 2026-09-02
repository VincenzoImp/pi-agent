#!/usr/bin/env bash
# Verifies the installed setup loads completely. See check.mjs for what is asserted and why.
exec node "$(dirname "${BASH_SOURCE[0]}")/check.mjs" "$@"
