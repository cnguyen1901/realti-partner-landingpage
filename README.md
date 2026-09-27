# RealtiPartner landing page

A static landing page with a two-step waitlist form, hosted on Vercel.

- `index.html`: the page (no build step, no npm packages)
- `privacy.html`: starter privacy policy (have it reviewed before launch)
- `api/waitlist.js`: saves signups to Upstash Redis
- `api/export.js`: downloads every signup as a CSV file
- `og.png`, `favicon.svg`: share image and browser icon
- `vercel.json`: clean URLs and basic security headers

## Deploy in 5 steps

1. **Create the project.** Push this folder to a GitHub repo and import it at vercel.com/new, or run `npx vercel` inside the folder. Framework preset: **Other**. No build command.
2. **Add the database.** In the project, open **Storage**, choose **Upstash for Redis** (free tier is plenty for a waitlist), create it and connect it to the project. Vercel adds the connection settings automatically. The code accepts either `KV_REST_API_URL` / `KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.
3. **Set your admin key.** In **Settings, Environment Variables**, add `ADMIN_KEY` with a long random value (for example, run `openssl rand -hex 24`). It protects the export link.
4. **Turn on analytics.** Open the **Analytics** tab and click **Enable**. If it shows a script path different from `/_vercel/insights/script.js`, paste that path into `index.html` and `privacy.html`.
5. **Redeploy** so the new settings take effect, then submit the form once yourself to check it works.

Before going live, replace `https://realtipartner.com/` in the `<head>` of `index.html` (canonical link and share tags) with your real domain, and update the email addresses in the footer and privacy page.

## Where to see things

- **Visitors, pages, referrers, countries, devices:** the Analytics tab. Works on every plan.
- **Button clicks and signups as events:** also the Analytics tab, under Events. Custom events require a Vercel **Pro** plan. On the free plan the page still works; the events are just not recorded.
- **Your signups:** go to `https://YOUR-DOMAIN/api/export` with your admin key.
  - Easiest: `curl -H "x-admin-key: YOUR_ADMIN_KEY" https://YOUR-DOMAIN/api/export -o waitlist.csv`
  - Quick but less safe: `https://YOUR-DOMAIN/api/export?key=YOUR_ADMIN_KEY` in a browser (the key ends up in browser history and logs).
  - JSON instead of CSV: add `?format=json`.

## What each signup records

| Field | Where it comes from |
|---|---|
| email, first_name | Step 1 of the form (first name is optional) |
| stage, role, market, interview | Step 2, all optional |
| utm_source, utm_medium, utm_campaign, utm_content, utm_term, ref | The link the visitor arrived on |
| referrer, landing_path | The site that sent them, and the page they landed on |
| form | Which form they used: `hero` or `footer` |
| country, region, city | Approximate location from Vercel (the IP address is never stored) |
| created_at, profile_at, updated_at | Timestamps |

Tag every link you share with UTM parameters so the export tells you which channels bring signups, for example:
`https://YOUR-DOMAIN/?utm_source=instagram&utm_medium=social&utm_campaign=launch`

## Optional: send each signup somewhere else

Set `WAITLIST_WEBHOOK_URL` to a Zapier, Make or Slack incoming-webhook URL, or a Google Apps Script web app, and every new signup and profile update is posted there as JSON. A failing webhook never blocks a signup.

## Built-in protections

- Hidden "honeypot" field that quietly drops most spam bots
- About 12 signup attempts per visitor per hour
- Email checked in the browser and again on the server
- Duplicate emails update the existing signup instead of creating a second one
- Step-2 answers need the one-time token returned by step 1
- The CSV export neutralises values that a spreadsheet would run as formulas

## Try it locally

Open `index.html` directly in a browser to click through the design; the form pretends to succeed so you can see every state. To run the real functions locally, use `npx vercel dev` after `npx vercel env pull`.
