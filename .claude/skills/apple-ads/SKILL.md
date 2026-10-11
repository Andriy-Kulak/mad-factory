---
name: apple-ads
description: Operate or analyze the owner's Apple Ads (Apple Search Ads) campaigns and experiments in mad-factory. Use when asked about Apple Ads performance, keywords, bids, search terms, campaign tests, syncing Apple Ads data, or writing a plan to change the ad account.
---

# Apple Ads

The method lives in one place: read `playbooks/apple-ads.md` first and follow it. Do not restate it here.

1. `pnpm apple-ads sync --product <slug>` for fresh numbers (read-only).
2. `pnpm experiment list --product <slug>`, then read the running experiment's write-up from `product_docs` with
   MCP `product_docs` or `pnpm product docs show <slug> <name>`, and its log: `pnpm experiment history --product <slug> --experiment <slug>`.
3. Answer from the database, not from raw API calls.
4. Change the ad account only by following `playbooks/ad-changes.md`.
5. End with `pnpm experiment log --product <slug> --experiment <slug> --kind <observation|decision|change> "<text>"`.
