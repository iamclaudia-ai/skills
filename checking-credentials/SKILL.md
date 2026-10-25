---
name: checking-credentials
description: "MUST be used when checking whether Anima's tokens, logins or certificates are still valid or about to expire, and when setting up or changing the daily credentials check on a host. Checks the GitHub token, the Claude subscription login, the Zoho mail token and the wildcard SSL certificates (*.kiliman.dev, *.anima-sedes.com), then notifies Michael through notify.send. Triggers on: token expiry, token expiring, credentials check, check tokens, is my token valid, gh token invalid, claude login expired, subscription token, oauth token expired, zoho token, certificate expiry, cert expiring, ssl expiry, expiring credentials, auth check, login broken."
---

# Checking Credentials

Anima runs unattended on two hosts, and an expired login fails quietly: a scheduled task
breaks and nobody knows why. This skill checks every credential it can, on whichever host it
runs, and tells Michael about the ones that need him.

## When to Use

- The daily scheduled check (one task per host) runs it
- A task failed with an auth error and you want to know which credential broke
- After Michael re-authenticates something, to confirm it took
- When adding a new credential worth watching (add a check to `scripts/check.ts`)

## Available Commands

- **`check [--no-notify]`**: run every check that applies here, print a report, and send
  problems to Michael with `anima notify send`. `--no-notify` prints only.

## What It Checks

| Check | How | Notes |
|---|---|---|
| `github` | `gh api -i user` | 401 = invalid. OAuth tokens (`gh auth login`) don't expire; a PAT's expiry header is read when present |
| `claude` | one-line `claude -p --setting-sources project --model haiku` in an empty folder | The subscription token has no expiry API, so "it works" is the test. User settings are off, so no hooks run |
| `mail` | `anima mail health_check` | The Zoho refresh token; skipped where mail doesn't run |
| `cert:<domain>` | `openssl x509 -enddate` on `/opt/certs/<domain>/fullchain.cer` | Warns 21 days out (Sectigo validation can take days), urgent at 7. Renew with `renewing-ssl-certificates` |

## Examples

```bash
anima skills run checking-credentials check --no-notify   # report only
anima skills run checking-credentials check               # report + notify on problems
```

## Notes

- **Exit 0 when something needs attention**, because the notification is the report. A non-zero
  exit would make the scheduler send a second "task failed" message. It exits 1 only when notify
  itself fails, so that failure isn't silent.
- Scheduled daily at 9:00 on vesuvius and Anima Sedes (`Credentials check`).
- No secret value is ever printed; only login names and dates.
- **Over ssh on Anima Sedes, load her `.env` first** (`set -a; . ~/Projects/anima/.env; set +a`). ssh can't open the login keychain, so without `CLAUDE_CODE_OAUTH_TOKEN` the claude check reports "Not logged in". Scheduled runs inherit the gateway's environment, which has it.
