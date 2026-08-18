# Vercel Deployment Guide

## Project Settings

- Framework Preset: `Next.js`
- Root Directory: `./`
- Install Command: `npm install`
- Build Command: `NODE_OPTIONS=--max-old-space-size=4096 npm run build`
- Output Directory: leave blank
- Node.js Version: `22.x` or any Vercel option `>=20.9.0`

## Environment Variables

Add these in Vercel under Project Settings -> Environment Variables.
Select Production, Preview, and Development unless you intentionally want separate values.

| Key | Required | What to enter |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Neon pooled Postgres connection string, for example `postgresql://USER:PASSWORD@HOST-pooler.REGION.aws.neon.tech/DB?sslmode=require` |
| `OPENROUTER_API_KEY1` | Yes | First OpenRouter API key |
| `OPENROUTER_API_KEY2` | Optional | Second OpenRouter API key for fallback/load balancing |
| `SERPAPI_KEY` | Recommended | SerpAPI key for competitor discovery |
| `SEO_SCORE_API_KEY` | Recommended | SEOScoreAPI key for live SEO audits |
| `CRON_SECRET` | Yes | Random secret, at least 16 characters |
| `GOOGLE_CLIENT_ID` | Optional | Google OAuth client ID for Search Console/GA4 |
| `GOOGLE_CLIENT_SECRET` | Optional | Google OAuth client secret |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Optional | Google service account email for GA4 anomaly checks |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Optional | Google service account private key with `\n` line breaks |
| `STRIPE_SECRET_KEY` | Optional | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Optional | Stripe webhook signing secret |
| `RESEND_API_KEY` | Optional | Resend API key for alert emails |
| `NEXT_PUBLIC_CRON_SECRET` | Optional | Only set if you want the dashboard debug cron button to call cron routes from the browser |

## Database Setup

1. Create or open a Neon project.
2. Copy the pooled connection string from Neon Connect.
3. Add it to Vercel as `DATABASE_URL`.
4. Locally, set the same `DATABASE_URL` in `.env.local`.
5. Run `npm run db:push` once to apply the Drizzle schema to Neon.

## Deploy

1. Push the repo to GitHub.
2. In Vercel, click Add New -> Project.
3. Import `growthsaarthistartup-stack/GrowthSaarthi`.
4. Enter the project settings above.
5. Add the environment variables above.
6. Click Deploy.

After deployment, Vercel will register these cron jobs from `vercel.json`:

- `/api/cron/daily` at `0 2 * * *` UTC
- `/api/cron/weekly` at `0 3 * * 1` UTC

Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically when `CRON_SECRET` is configured.
