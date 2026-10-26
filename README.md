# MozzAI

A mobile care guide and LLM assistant for one pet, with private sitter access and built-in tester feedback. Runs on Cloudflare Workers AI and D1. Owner intake happens in Codex; the care guide is imported privately and never bundled into public source code.

## Included

- Random private share link plus sitter code; separate owner password. Owners can replace the link and immediately revoke existing sitter sessions.
- Visible draft/testing banner; unknowns and corrections remain explicit.
- Real Workers AI integration using `@cf/openai/gpt-oss-120b`, source references, and answer/suggestion/clarification labels.
- Readable care guide during AI outages or quota exhaustion.
- Answer ratings and a bug/suggestion form. Only feedback-associated question/answer exchanges are saved, never full conversations.
- Private feedback dashboard, QR code, CSV export, and owner deletion. Feedback is retained until an owner deletes it.
- Signed sessions and feedback receipts, origin checks, persistent rate limits, and model-output validation.

## Development

Use Node.js 24 or newer. Cloud tasks are already isolated: use the existing checkout rather than creating a Git worktree.

```sh
npm ci --cache /tmp/mozzai-npm-cache
npm run check
npm test
npm run build
npm run test:browser
```

The browser check uses Chromium at `/usr/bin/chromium`; set `CHROMIUM_PATH` if needed. Tests use fictional guides and explicit model stubs. They verify app behavior and local D1 persistence, **not live-model answer quality**.

Set `MOZZAI_GUIDE_PATH` to a Markdown export outside this checkout, then run `npm run dev`. Exports contain `## Confirmed care instructions`, `###` care sections, and optional `## Unanswered...` and `## Corrections...` sections. The local server binds only to loopback; its database is ephemeral. Local test access values are in `scripts/dev.mjs` and are never used for deployment.

Without provider credentials, chat shows an unavailable error rather than fake answers. For live local inference, supply Cloudflare credentials and launch with `NODE_USE_ENV_PROXY=1` in managed cloud environments to preserve inherited proxy authentication and CA trust.

## Deploy

Use a **Workers Free** account and a model available on its free tier. The app defaults to 30 model requests per day, in addition to Cloudflare's quotas. Actual capacity depends on guide length, history, reasoning, and output. Deployment does not upgrade account plans or configure paid model fallbacks.

Supply these through secure environment settings, not Git, shell history, or chat:

| Variable | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Account-scoped permissions for Worker deployment, D1 management, and Workers AI access. |
| `CLOUDFLARE_ACCOUNT_ID` | Hosting account ID. |
| `MOZZAI_SITTER_CODE` | At least 6 characters; share separately from the link. |
| `MOZZAI_ADMIN_PASSWORD` | A different password of at least 16 characters. |
| `MOZZAI_GUIDE_PATH` | Absolute path to the private guide export. |

Optional `MOZZAI_WORKER_NAME` defaults to `mozzai-family-pilot`. Use a distinct name for another environment to avoid updating the same deployment.

```sh
NODE_USE_ENV_PROXY=1 npm run deploy
```

The script creates or reuses the named D1 database, applies the idempotent schema, imports the guide privately, and deploys the Worker and assets. Runtime secrets are installed through standard input. Ordinary redeploys retain existing link/session secrets. New secret values are generated in memory and are never written to tracked files or printed.

Deployment verifies owner sign-in and retrieves the share link. Generated links are saved to ignored `.deploy/links.json`. This does **not** validate real-model quality. If the account lacks a workers.dev subdomain, enable it in the Cloudflare dashboard. Managed environments must permit `api.cloudflare.com` and the resulting Worker hostname for deployment and hosted checks.

Owners use `/admin`. Share the generated `/s/...` link or its QR code with testers, and send the sitter code separately. Importing the draft does not approve it or resolve missing medication/contact details.

## Live validation

After deployment, exercise the privately retained expected-answer scenarios against the actual model. Check known routines, unknown details, uncertain treatment names, contradictions, and questions requiring clarification. Verify sources and answer correctness. Test sign-in protection, quota/outage behavior, feedback submission, owner review, CSV, and deletion on the hosted app before calling the pilot ready.

Feedback includes model and guide version. Source validation checks section IDs, not whether the model's prose is correct. Changes to the guide, instructions, or model need renewed evaluation.

## Data boundaries

The guide and submitted feedback live in the account's D1 database. Cloudflare processes model input under its Workers AI terms. Do not enable request-body logging or put care information in logs. This app does not log chat bodies.

Chat messages stay in browser memory and are sent to the model as context; refreshing clears them. Signed, expiring client receipts attach only selected exchanges to feedback. Deletion removes application records; provider backups and service retention follow provider policies.

Keep private care files outside Git. Ignore rules exclude local secrets, generated deployment metadata, screenshots, and caches. Tests use fictional data. No production credentials or personal care details belong in pull requests.
