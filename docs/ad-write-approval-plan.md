# Ad-account writes only with the owner's hand on the key

Status: step one is built — ad-account keys are split into READ and WRITE env vars, and WRITE keys live only on the machine that runs approved writes. The Keychain prompt and the approver described below are still the later step.

## 1. The problem

The owner approves every ad-account change in chat (CLAUDE.md, "The owner approves ad-account changes in chat"). That
approval is a convention, not a lock:

- `META_ADS_TOKEN` has `ads_management`, so it can change the account. It sits in the local `.env` and in Devin's
  repo-scoped secrets (docs/meta-ads-plan.md, section 4). Any agent that can read `.env` or run in Devin's VM holds a
  key that can pause, activate, create ads and change ad sets.
- The Apple Ads sync uses a key whose API user can change campaigns. The read-only user planned in
  docs/apple-ads-plan.md (section 9) was never created.
- What keeps agents from writing today is the code allowlist (`assertNotDestructive`, the `--plan` journal) and
  agents following instructions. Both protect against mistakes; neither stops an agent that skips the ask.

## 2. The goal

An agent can find, analyse and propose a change anywhere (Devin, Grok via `/api/mcp`, Claude, Codex), but a change
reaches an ad account only after the owner does something an agent cannot: types the Mac login password into a
macOS prompt (later: a fingerprint). Losing a cloud secret then exposes numbers, never the ability to spend.

## 3. Design

### Two kinds of keys

| Key | Can | Lives in | Used by |
| --- | --- | --- | --- |
| Read key, Meta: system-user token with only `ads_read` | read | `META_ADS_TOKEN` in `.env` and Devin's secrets | `meta-ads sync/status/media/verify`, the daily review |
| Read key, Apple: API user with role **API Account Read Only** | read | `APPLE_ADS_DIR` / `APPLE_ADS_*` in `.env` and Devin's secrets | `apple-ads sync/research`, the daily review |
| Write key, Meta: the current `ads_management` token | read + write | macOS Keychain on the owner's Mac only | `meta-ads pause/activate/adset-update/adset-copy/create-ad/ad-text/launch` |
| Write key, Apple: the current API user's key | read + write | macOS Keychain on the owner's Mac only | future Apple write commands (none exist in this repo yet) |

`META_ADS_TOKEN` keeps its name and becomes the read token, so Devin's secret only changes value. No write key is
ever in an env var, a file in the repo, Devin, GitHub or Vercel.

### How a write command gets its key

1. A write command (anything that reaches `MetaAdsClient.post`) asks `src/lib/keychain.ts` for the write key before
   journaling or sending anything.
2. `keychain.ts` refuses outright under `CI` or on a non-macOS machine, then runs
   `security find-generic-password -s mad-factory -a META_ADS_WRITE_TOKEN -w`.
3. The Keychain item is created with an empty trusted-apps list (`-T ""`), so every read makes macOS show a prompt like
   *"security wants to use your confidential information stored in 'mad-factory'"* and ask for the login password.
   **Allow** → the command gets the key for this one run. **Deny** → the command stops with "write not approved"
   and nothing is journaled or sent.
4. The key is cached in memory for the rest of that process, so `meta-ads launch` (many calls) asks once.
5. Read paths (`get`) keep using `META_ADS_TOKEN` and never touch the Keychain, so sync and analysis never prompt.

The owner's rule: approve the prompt only right after saying yes to a specific plan in chat; never press
**Always Allow** (that adds `security` to the trusted list and removes the prompt for good).

### Code changes

- `src/lib/keychain.ts`: `readWriteKey(name)` as above, with an injectable runner for tests.
- `src/meta-ads/client.ts`: GETs use `META_ADS_TOKEN`; `post` (every write) uses the Keychain key, fetched lazily.
  Owner sign-off applies (`pnpm ready` flags this file).
- `src/apple-ads/client.ts`: when Apple write commands are added, the same split: `isWrite` calls take the Keychain
  key, reads take the env credentials.
- `scripts/pr-review.ts`: fail a diff that reads a write key from `process.env`/`optionalEnv`, so the Keychain stays
  the only path.
- Tests: GET sends the read token; a write fetches from the Keychain runner and sends that token; a denied prompt
  throws before any journal row or request; `CI=true` refuses without calling the runner.
- `.env.example`, CLAUDE.md (Meta Ads and Apple Ads sections), playbooks/meta-ads.md, docs/meta-ads-plan.md
  section 4: say which key is which and where it lives.

### Owner setup (about 20 minutes, once)

1. **Meta read key:** Business settings → System users → add `mad-factory-read` (role Employee) → assign the ad
   account with view-only access → generate a token with only `ads_read`. Put it in `META_ADS_TOKEN` in `.env` and
   in Devin's repo-scoped secret.
2. **Apple read key:** the five steps in docs/apple-ads-plan.md section 9 (second Apple Account, role
   *API Account Read Only*). Put its credentials where the sync reads them (`.env`, Devin's secrets).
3. **Write keys into the Keychain**, from Terminal (`-w` last makes `security` ask for the value, so it never
   passes through an agent or the shell history):
   ```bash
   security add-generic-password -s mad-factory -a META_ADS_WRITE_TOKEN -T "" -w
   ```
   The Apple write key goes in the same way when Apple write commands exist.
4. Delete the old write-capable values from `.env` and from Devin's secrets.

### Verification

- With only the read token, `pnpm meta-ads sync --product <slug>` succeeds and a direct write with that token is
  refused by Meta (permissions error). Paste both outputs in the PR.
- `pnpm meta-ads pause --ad <id> --plan <file>` on a test ad: the macOS prompt appears; **Deny** → command exits,
  no `meta_ads_changes` row; **Allow** → the ad pauses and `meta-ads verify` confirms it.
- `CI=true pnpm meta-ads pause …` refuses without a prompt.

## 4. Day to day

```
Devin / Grok / Claude (any machine)        reads with the read keys, writes a plan document in product_docs,
                                           asks the owner (see section 6 for where)
Owner                                      reads the plan, says yes
Owner's Mac (Claude, Codex or a terminal)  runs the write command with --plan → macOS prompt → owner allows
                                           → change, journal row, `meta-ads verify`
Devin / daily review (next run)            sees the result through the read keys and logs it on the experiment
```

## 5. Later, separate PRs

- **Fingerprint instead of password:** a small signed helper that stores the write key with Touch ID access
  control (LocalAuthentication); same `readWriteKey` interface.
- **Approve from the phone:** an approvals inbox on the web app (Slack button or a passkey/Face ID page). The write
  key would then live on that server, so it may only act on a request the owner approved with a passkey or a
  Slack-signed button click from the owner's user id. Bigger, and the first time the web app could write to an ad
  account; only once Mac-only approval is the bottleneck.
- Stage and go-live as two approvals (`launch` creates PAUSED and activates in one run today), and writes limited
  to the object ids named in the `--plan` file.

## 6. Open question: how Devin takes part

Devin runs in its own cloud VM, so it can never trigger the prompt on the owner's Mac; it holds only read keys and
proposes. To decide:

1. **Where Devin puts a request.** Options: a plan document in `product_docs` (readable with `pnpm product docs show`,
   the plan is on GitHub when the owner's Mac pulls it); a GitHub issue with a new label such as `needs-approval`
   linking the plan; a Slack message. The request should carry the exact command to run.
2. **How the plan reaches the Mac.** Merge the plan PR and `git pull`, or check out Devin's branch. Merging a plan
   file changes no ad account (CLAUDE.md), so merging first is safe.
3. **Who runs the command.** The owner in a terminal, or the owner telling a local agent ("apply
   `product_docs`). Either way the Keychain prompt is the approval.
4. **Closing the loop.** After the write, the local agent comments on the issue/PR with the `meta-ads verify` table;
   Devin's next run reads the result with the read key and logs it in `experiment_log`.
5. **Does any Devin mode run commands on the owner's Mac** (for example through its desktop app)? If yes, that mode
   can trigger the prompt like any local agent and section 6.3 gets simpler; if not, the flow above stands.

## 7. Build order

1. Owner: Meta read token and Apple read-only user (section 3, steps 1–2). Swap Devin's secrets.
2. Code: `keychain.ts`, the Meta client split, the pr-review rule, tests and docs (one PR, owner sign-off for
   `src/meta-ads/client.ts`).
3. Owner: write keys into the Keychain, old values out of `.env` (steps 3–4). Run the verification in section 3.
4. Settle section 6, then update playbooks/daily-review.md and the Agent task template with the request format.
