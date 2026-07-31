---
name: setup-raindrop-feed
description: Configure, secure, deploy, and verify a cloned Raindrop Feed project on Vercel. Use when a user asks to set up this repository, make their own Raindrop Feed, connect Raindrop or Gemini credentials, provision permanent MCP agent links, or deploy the app for the first time.
---

# Set Up Raindrop Feed

Take the clone from fresh checkout to a verified private deployment. Treat a plain request such as "set it up" as an invocation of this skill; do not require the user to know a slash command. Keep the user involved only for account authentication, secret entry, and approval of third-party resources.

## Safety Rules

- Never print, commit, paste into a command, or include secret values in a summary.
- Prefer interactive hidden input or the Vercel dashboard for secrets. If the user supplies a value in chat, do not repeat it.
- Keep `.env.local` and `.vercel` untracked. Stop if either is tracked.
- Treat `APP_ACCESS_PASSWORD` as required for production even though the app permits an open local preview.
- Do not create an MCP agent link during setup. Its bearer URL is a separate secret and should be created by the signed-in user after deployment.
- Ask before selecting a paid plan. Prefer free tiers when available.
- Do not change product behavior or redesign the app during setup unless required to fix a failing build.

## Inputs

Collect only these user-specific values:

- Required: `RAINDROP_TOKEN`, created at https://app.raindrop.io/settings/integrations. In **For developers**, create an app, open its settings, and copy its **Test token**. Do not ask for the Client ID or Client Secret.
- Required: `APP_ACCESS_PASSWORD`, or offer to generate a long unique password.
- Optional: `GEMINI_API_KEY` for automatic bookmark labeling, created through https://ai.google.dev/gemini-api/docs/api-key.

Permanent MCP links also need Upstash Redis. Provision it through the Vercel Marketplace; do not ask the user to manually copy its REST credentials unless marketplace provisioning is unavailable.

## Workflow

1. Inspect `README.md`, `.env.example`, `.gitignore`, `package.json`, and `vercel.json`. Check `git status` and preserve unrelated work. When a required value is missing, direct the user to the **Get your keys** section in `README.md` rather than guessing where it comes from.
2. Run `node .agents/skills/setup-raindrop-feed/scripts/check-setup.mjs`. Resolve hygiene or runtime failures before handling credentials.
3. Install dependencies with the repository package manager and run the existing build command. For this template, use `npm ci` and `npm run build`.
4. Confirm Vercel CLI authentication with `npx vercel whoami`. If authentication is missing, start the normal login flow and pause for the user to approve it.
5. Link or create a Vercel project with `npx vercel link`. Use a new project owned by the user; never link their clone to the template author's project.
6. Add `RAINDROP_TOKEN` and `APP_ACCESS_PASSWORD` as sensitive Vercel environment variables for Production, Preview, and Development. Add `GEMINI_API_KEY` only when supplied. Use those key names exactly. Use hidden interactive input or the Vercel dashboard so values do not appear in command history.
7. Check for `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` by name only. If absent, install Upstash Redis from the Vercel Marketplace, choose a free plan, connect it to this project, and let Vercel inject both values. Pause for any browser authorization or plan approval.
8. Pull the Production environment to ignored `.env.local`, then run `node .agents/skills/setup-raindrop-feed/scripts/check-setup.mjs --env-file .env.local --full`. Never show the file contents.
9. Deploy with `npx vercel deploy --prod --yes`. Record the production URL without adding it to the public template repository.
10. Verify the deployment with `node .agents/skills/setup-raindrop-feed/scripts/verify-deployment.mjs <production-url> --env-file .env.local`. This confirms anonymous API access is blocked, password login succeeds, and authenticated Raindrop access works without printing credentials or bookmark data.
11. If Gemini was configured, confirm only that the key is present. Do not spend quota or modify bookmark labels unless the user asks for a live test.
12. Recheck `git status` and tracked files. Ensure `.env.local`, `.vercel`, API keys, passwords, Redis credentials, deployment URLs, and generated agent links are not staged.

## Recovery

- `401` after authenticated verification: replace `APP_ACCESS_PASSWORD`, redeploy, pull Production env again, and retry.
- Raindrop rejects the token: replace `RAINDROP_TOKEN` with a current test token and redeploy.
- Agent-link creation reports missing storage: reconnect Upstash to the same Vercel project, confirm both REST variable names, and redeploy.
- Gemini labeling is unavailable: verify `GEMINI_API_KEY` in Production and redeploy; the feed itself should still work.
- Vercel deployment protection intercepts the production site: disable Vercel Authentication for Production. The app's own password gate protects the feed, while MCP bearer links must remain reachable by external clients.

## Completion Report

Report the Vercel project name, production URL, build result, password-gate result, Raindrop connection result, Upstash readiness, and Gemini status. State that no secrets were committed. Never include secret values or a permanent MCP bearer URL.
