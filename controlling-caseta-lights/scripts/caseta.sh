#!/bin/bash
# Entry point for the caseta command. LEAP needs the LAN, and only Anima Sedes
# holds the bridge's client certificate (and isn't blocked by macOS Local
# Network privacy), so on any other machine this forwards over ssh to Sedes.
set -euo pipefail

BRIDGE="${CASETA_BRIDGE:-192.168.1.202}"
CERT_DIR="$HOME/.config/pylutron_caseta"
VENV_SITE="$HOME/lutron/venv/lib/python3.9/site-packages"
SEDES_HOST="${CASETA_SEDES_HOST:-anima-sedes}"
SEDES_SCRIPT="Projects/iamclaudia-ai/skills/controlling-caseta-lights/scripts/caseta.sh"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$CERT_DIR/$BRIDGE.key" ]]; then
  # Apple's /usr/bin/python3 with the venv's packages: the venv's own python
  # binary hangs on a never-answered Local Network prompt.
  export PYTHONPATH="$VENV_SITE"
  exec /usr/bin/python3 "$DIR/caseta.py" --bridge "$BRIDGE" --certs "$CERT_DIR" "$@"
fi

exec ssh -o ConnectTimeout=10 "$SEDES_HOST" "$SEDES_SCRIPT $(printf '%q ' "$@")"
