# AIUpdate

A one-page AI book discovery site built with React, TypeScript, Vite, and Hono. Search titles, authors and descriptions, filter topics and years, switch layouts, inspect book details, and save a browser-local reading list.

## Deploy manually to Vercel

The project is ready for Vercel. No deployment or external resources have been created for you.

1. Import this project into Vercel from your Git repository, or run `npx vercel` in this directory. Use the **Vite** framework preset, **Node.js 24.x**, build command **`npm run build`**, and output directory **`dist`**. Keep **Fluid Compute** enabled (the default for new projects); the discovery function is configured for up to 300 seconds. The included `vercel.json` supplies the build settings and API rewrite.
2. In the Vercel project's **Storage** tab, create or connect a **private Vercel Blob** store. Connect it to the **Production** environment. The connection must supply `BLOB_READ_WRITE_TOKEN`, or Vercel OIDC access with `BLOB_STORE_ID`. Private storage holds the cumulative book catalog and the discovery cursor between function invocations and deployments. A public Blob store will not work with this configuration.
3. Add **`CRON_SECRET`** in the project's environment variables for **Production**. Use a random secret of at least 32 characters. You can generate one locally with:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Keep this value secret. Vercel automatically sends it as the cron request's bearer token. Never add a `VITE_` prefix to a storage token or secret.
4. Optional: set **`ANNAS_ARCHIVE_BASE_URL`** to a currently available original Anna's Archive HTTPS domain. The default is `https://annas-archive.gl`. HTTP errors and anti-bot challenges are respected; Open Library provides complementary/fallback metadata.
5. Deploy to **Production**, or redeploy after connecting storage and setting environment variables. The site works with its bundled 35-book seed before the first discovery run. Check **`/api/health`**: `automaticUpdates.enabled` should be `true`. This checks configuration; the first successful job confirms storage and upstream access work.
6. In Vercel's **Cron Jobs** section, confirm `/api/cron/sync` is registered. Run it once to initialize the growing catalog, then inspect its logs. A successful response reports the number of books added, total books, and any source warnings. A `401` means `CRON_SECRET` is missing or does not match the deployed environment. A `503` requires checking the connected private Blob store or metadata source availability.

The included schedule is **daily at 01:00 UTC, around 9 AM in Manila**. Vercel Hobby schedules may run within the scheduled hour, so the exact minute is not guaranteed. Cron runs only for production deployments. Daily scheduling works with Hobby; on Pro you can change the cron expression to `0 * * * *` for hourly checks, then redeploy. The browser checks the saved catalog every five minutes and when the window regains focus, so existing visitors see new records without manually reloading.

For a CLI-only deployment, sign in, link the project, connect a private Blob store, add the cron secret to the project's production variables, and run `npx vercel --prod`. Secrets must be present in the deployment's environment before the cron can operate.

Preview deployments use a separate `aiupdate/preview-catalog.json` object if Blob credentials are connected to Preview. Production uses `aiupdate/catalog.json`, so preview refreshes do not change the live catalog. All previews share that preview-only object. Neither catalog is written to Vercel's temporary filesystem.

## How discovery works

Each daily check searches `Artificial Intelligence`, `AI`, and `Artificial-Intelligence`. It revisits recent archive additions and newer Open Library publication results, then checks the next historical results page for each query. Historical cursors are persisted and continue on later runs. Checks run independently of website traffic.

The catalog grows cumulatively. Previously discovered books remain even when they disappear from a search result or a source becomes unavailable. Repeated records are deduplicated by title and author; stable IDs keep reading-list bookmarks working. Coverless records are included. Missing descriptions stay explicitly marked instead of being invented. Description enrichment is bounded per run to fit serverless execution time. The API serves the catalog in revision-consistent pages of 200 records, which the browser combines as the library grows.

New discoveries appear first under **Recently added** and display **New arrival** for seven days. This label means new to AIUpdate, not necessarily newly published. Other sorting options remain available.

**Coverage is not exhaustive or instantaneous.** Discovery depends on source indexing, metadata quality, query results, and access. The search pages and detail requests checked in each run are bounded; unusually large batches of new records or description-only matches may take later passes to discover. Original Anna's Archive domains returned HTTP 403 during development. The included seed therefore uses real, clearly attributed Open Library records; it is not represented as a scrape from Anna's Archive.

The refresh button runs the same discovery process on demand. A persistent ten-minute cooldown limits repeated checks. Private Blob conditional writes and expiring worker leases prevent overlapping jobs from overwriting each other. Source failures keep all existing books and the last successful check timestamp. Failure/source notes appear in **About**. A failed job returns an error for Vercel logs, rather than reporting a false success. Partial source availability can still add books and is reported in the job's `sourceWarnings`.

The scraper reads bibliographic metadata only; it does not download book files or bypass access challenges. Topics are inferred from metadata. Publication dates are source-supplied first-publication years when available.

## Run locally

Requires Node.js **24.x**.

```sh
npm install
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` to the Hono server on port 3001. For a production build served locally:

```sh
npm run build
npm start
```

Open **http://localhost:3001**. The local server checks for due discovery jobs every minute and runs discovery once the last check is 24 hours old. Your computer and server must stay running for local automatic checks; a Vercel production deployment does not depend on them.

Locally, the cumulative catalog is stored in ignored **`.data/catalog.json`**. To run a check yourself:

```sh
npm run sync
```

Copy `.env.example` to `.env` for local options. Setting Blob credentials uses Blob instead of the local file, so keep those unset if you only want local changes. The bundled seed and its cached covers remain available when the API is unreachable. New records use their source cover URLs, with a designed fallback if unavailable. Browser-local bookmarks do not sync across devices.

## Verify

```sh
npm test
npm run build
npx playwright install chromium
npx playwright test
```

Browser tests start the development server automatically. To use installed Edge instead, set `PLAYWRIGHT_CHANNEL=msedge` in your shell. Tests cover discovery and deduplication, retention during failures, persistent worker locking and cooldowns, cron authentication, search and filters, sorting, dialogs, bookmark persistence, mobile layout, and automatic appearance of new books in an open page.

References: [Vercel Cron limits](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing), [securing cron jobs](https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs), [Vercel Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk), [Node functions](https://vercel.com/docs/functions/runtimes/node-js), [Open Library search API](https://openlibrary.org/dev/docs/api/search).
