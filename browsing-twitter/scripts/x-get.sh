#!/usr/bin/env bash
# PAID: raw GET against the X API v2 with the bearer token. Prints the JSON.
# Usage: x-get.sh '<path?query>'   e.g. x-get.sh 'users/by/username/thekitze?user.fields=description'
set -euo pipefail
source "$(dirname "$0")/_common.sh"
load_x_token
x_get "$1"
