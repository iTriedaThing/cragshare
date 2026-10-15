# Cragshare v0.1.2 — group climbing trip expense sharing

Mobile-friendly vanilla JavaScript application. No build step, no npm install. GitHub Pages-compatible.

## What's implemented

- Create trips; change dates and names.
- Add and remove participants (a participant listed as a payer must have their expenses reassigned or deleted first); edit categories and category-specific exclusions.
- Optional trip days and categories that use them. **All trip days (automatic)** means a missing `days` value. These people count only for days between the trip start and end, never arbitrary dates. **No trip days selected** (`days: []`) excludes them from costs for particular days; it does not exclude them from costs with no day chosen. Named date selections count only on the chosen trip dates. The attendance editor has **Use all trip days (automatic)**.
- **Day this was for (optional)** is deliberately different from **Date bought**. When entered, it must fall within the trip's date range. The date picker restricts choices, the save action checks the date, and the calculation engine independently refuses invalid dates (including those imported from older JSON backups). This check applies to manual expense splits too.
- When a category uses trip days and a cost has no day chosen, the app warns that it will be shared by everyone included in the category, regardless of attendance. It still permits saving after confirmation; expenses with manual sharing selections are already explicit.
- Out-of-trip day errors block balance and payment displays rather than silently billing people or showing incomplete calculations. Fix the date on the flagged expense. Changing trip dates is blocked if that would push any existing expense's day outside the trip.
- Add, edit, delete and categorize expenses; override participants individually on any expense.
- Integer-cent per-expense allocations; deterministic allocation of leftover pennies in participant order.
- Per-person total paid, assigned share, per-category share and net balance.
- Pairwise reimbursements (expense-grounded) and compact settlement (balance-grounded).
- Payment-completed checkboxes, trip lock, CSV export and JSON export/import.
- Browser-local demo immediately; optional Supabase for share-by-link and live sync.
- Acadia reference dataset from the supplied workbook (`acadia-sample.json`).

## Updating an existing v0.1 or v0.1.1 installation

Before replacing files, **Export JSON** from the existing app as a backup. Extract this package over the existing app folder, replacing the original files, and reload with Ctrl+Shift+R. The browser storage key and JSON format are unchanged. If hosting on GitHub Pages, publish the updated files to the same repository and URL. Do not delete browser storage or change the site origin if you want to keep existing local data.

## Run locally

From this directory run `python3 -m http.server 8080` and open http://localhost:8080. Do not open `index.html` as a `file://` URL (browser modules need HTTP). This starts a LOCAL DEMO: edits are only in your browser. It is **not shared** until configured below.

Run tests: `npm test` (Node 20+). No npm dependencies. Tests include the out-of-trip-day bug reported against the October 16–20 sample trip.

## Enable shared trip links

1. Create a Supabase project: https://supabase.com/dashboard . Enable **Authentication → Providers → Anonymous Sign-ins**.
2. Open SQL Editor and run `supabase.sql`. It creates tables, member-access policies and three RPC functions.
3. Open `config.mjs` and paste your **Project URL** and **publishable/anon key**. Never expose the `service_role` key. Keys used by browsers are visible; SQL policies enforce access.
4. Serve the app via HTTP or GitHub Pages. It anonymously signs a visitor in when first opened.
5. Open the app and press **Create shared trip**. It creates a database copy of the current trip and gives a link containing `#trip=...&invite=...`. Anyone with that link can join and edit.
6. Share the link. Changes are saved remotely with optimistic version checks; all connected visitors receive updates via Supabase Realtime (if enabled by the SQL script).

**Security boundary:** possession of the invitation link is enough to join; the link is a secret. Invite is held in the URL fragment rather than query parameters to reduce incidental transmission. Members currently have equal edit powers (the `locked` flag is an interface safeguard, not a server-enforced organizer permission). There's no identity verification, audit ledger, server-side arithmetic validation, or granular permissions yet. Use among trusted friends only. Revocation UI isn't implemented in v0.1. Clear the fragment before sharing screenshots. An anonymous session can be lost when browser storage is cleared.

**Conflict behavior:** if two people edit simultaneously, one save will fail rather than silently overwrite another. Reload, inspect the latest data and repeat the edit. This is not an offline-capable merge system.

## Publish to GitHub Pages

Create a repository, upload all project files (including the SQL and README as optional source documentation), then go to **Settings → Pages → Deploy from a branch → main → / (root)**. The live URL should be `https://YOURNAME.github.io/YOURREPO/`.

Because all links and asset URLs are relative, it supports a Pages repository subpath. Supabase uses HTTPS and the browser URL's fragment for trip invitations; no redirect/callback setup is needed for anonymous sign-ins.

## Known limitations and next steps

- This is a **working first prototype**, not a production-hardened financial service. Live Supabase sync and security have not been end-to-end tested against a real provisioned project.
- `create shared trip` makes a new shared copy of the current local trip. Existing local copies are not automatically migrated again.
- `New trip` leaves the current shared trip and starts a local draft; use `Create shared trip` on the draft to publish it.
- Participant removal is available, with payer-protection and settlement recalculation. Category deletion and approval workflows are not yet implemented. As before, trusted collaborators can edit trip data.
- The compact settlement is a deterministic greedy/cumulative-equivalent scheme with at most payers + recipients − 1 payments. It is **not guaranteed** to attain the mathematically absolute minimum transfer count.
- Payment checkboxes identify individual *proposed* transfers; editing expenses may invalidate completed markings. No money is transferred by this app.
- No automated deployment or rollback, receipt upload, robust audit history, or proper server-side settlement snapshots yet.
- Existing spreadsheet's itineraries, hiking suggestions and Airbnb planning are deliberately out of scope.
- Prior workbook contains formula caches with `#NAME?`; the source records and rules are imported and recomputed independently instead.

## Data model

A Trip JSON document holds `people`, `categories`, `expenses`, `paidTransfers`, dates, and lock state. Each expense has `amountCents`, `payerId`, `categoryId`, optional `benefitDate`, and optional `participantIds`. `null` participant IDs means category defaults plus opt-in attendance; an explicit array overrides them. The calculation engine is pure (`engine.mjs`) and independent from storage and UI. Attendance semantics are shared by the expense UI and calculation engine. Removing a participant clears their category exclusions and custom expense inclusions, resets paid flags and recomputes remaining shares. Always export a backup before significant edits. Existing v0.1 JSON backups remain compatible.

## What's new in v0.1.2

- Replaced confusing “benefit date” and “attendance default” wording with **Day this was for**, **Trip days**, **All trip days (automatic)**, and **No trip days selected**.
- Out-of-trip days cannot be selected or saved, and older imported expenses with outside dates display a clear fix-needed warning until corrected.
- Costs without a selected day show a warning when the category uses trip days.
- Existing JSON structure, browser-local storage key, and Supabase setup stay unchanged.

## Quick checks for this release

1. Export your trip as JSON before updating. Replace the old app files with this release, then refresh with Ctrl+Shift+R on the same local URL. Existing local trip data is compatible.
2. Import `cragshare-trip-test-2.json` if you want to reproduce the reported edge case. The cost **no folks** (Oct 23) should show **Fix date**, because the trip is Oct 16–20. Balances and payments remain unavailable until corrected.
3. Edit **no folks** and choose Oct 20 for **Day this was for**. The error should disappear and the full $239.87 should be allocated. Eight people should share **no folks**; the app does not change the real saved export automatically.
4. **Turkey meat sauce** has no day chosen while **Shared Dinner** uses trip days, so it should show a caution; it is still valid and allocated among category members.
5. In **Categories & people**, the **Trip days** control shows **All trip days (automatic)** when no days were explicitly selected, and **No trip days selected** if every box is unchecked and saved.
6. Try to choose a day outside the trip for a new expense; the date picker restricts the range and saving checks again. Shortening the trip dates is blocked if doing so would leave an existing cost’s selected day outside the trip.

The underlying JSON key remains `benefitDate` for compatibility, although the UI calls it **Day this was for**.
