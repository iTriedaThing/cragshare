# Cragshare v1.0.1 — Split the trip, not the friendship

An account-free, mobile-friendly expense-sharing app for group climbing trips. The frontend runs as plain JavaScript on GitHub Pages; optional Supabase storage provides private-link access and shared, live trip updates.

**This release is a drop-in frontend/engine update for v0.1.2.** It does not require a database migration, re-created trip, changed invitation link, or changes to the saved trip JSON structure.

## What's new

1. **Delete unused categories.** Each category has a **Remove** button. If any expense uses that category, removal is blocked until those expenses are reassigned or deleted. No expenses are deleted implicitly. If the category is unused, its removal does not alter balances or clear payment checkmarks. Default categories may be deleted too.
2. **Visible version number.** `v1.0.1` appears beside **Shared live** (or **Local demo**) in the header. The footer also shows the version. Versioned JavaScript and CSS asset URLs help avoid stale browser caches after deployment.
3. **Trip days editor beside each person.** Click **Trip days** on a participant's row to open a small anchored panel. On mobile it appears as a bottom sheet. Choose days, **Save days**, **Use all trip days**, or **Cancel**. Escape or the close button dismisses the editor without saving.
4. **Readability pass.** Application views, UI controls, calculation logic, storage and styles have clearer sections and comments. Source is now organized for a human maintainer, without bundlers or a framework.

No financial allocation or settlement formulas have changed.

## Update an existing GitHub Pages deployment

**Your live friends' trips are stored in Supabase, not the code repository.** Even so, export a JSON backup of your trip before deploying changes.

From your existing local repository (for example, `E:\Projects\cragshare`):

1. Unzip this release and copy its files into the repository folder, replacing files with matching names.
2. **Do not replace or delete `config.mjs`.** It contains the working Supabase URL and publishable key. `config.mjs` is deliberately not included in this update package.
3. The release also deliberately does not include `supabase.sql` or `acadia-sample.json`; keep the versions already in your repository.
4. Test locally using `py -m http.server 8080` and `http://localhost:8080/`. Open **Categories & people**, try an unused category, and check the trip-days editor. If the port is in use, use the running local server instead of starting another.
5. Review and publish:

   ```powershell
   git status
   git add app.mjs engine.mjs engine.test.mjs storage.mjs styles.css index.html package.json README.md
   git commit -m "Release v1.0.1: category removal, trip day popover, code cleanup"
   git push
   ```

GitHub Pages redeploys from `main`. Friends can keep using their existing invitation links. They need to refresh or reopen the app to load the updated release. A previously open browser tab may keep running the older version until refreshed.

## Run / test

- Python local server: `py -m http.server 8080` (on Windows), then open `http://localhost:8080`.
- Financial regression tests: `npm test` (Node.js 20+; no npm install required).
- Check syntax: `node --check app.mjs`, `node --check engine.mjs`, and `node --check storage.mjs`.
- No executable or build step is required; `index.html` imports ES modules directly.

## Source map for maintainers

| File | Responsibility | Edit when... |
| --- | --- | --- |
| `app.mjs` | UI, rendering, form input and event handlers | Changing visible controls, labels, form flows or dialogs |
| `engine.mjs` | Pure trip-day eligibility, cent allocation, balances, settlement methods | Changing who owes what or adding validation rules |
| `storage.mjs` | Browser-local and Supabase storage, shared-trip subscriptions | Changing synchronization or persistence |
| `styles.css` | Visual design, responsiveness, attendance popover layout | Changing appearance or mobile behavior |
| `index.html` | App entry point, versioned asset references | Bumping versions or changing HTML head metadata |
| `engine.test.mjs` | Tests for money rules, exclusions, attendance and safe removals | Changing the calculation engine or its invariants |
| `package.json` | App version and scripts | Releasing new versions |
| `config.mjs` | Existing deployment's Supabase URL and public publishable key | Initial setup only; preserve during this upgrade |
| `supabase.sql` | Database tables, policies and shared-trip RPCs | A separately reviewed backend update; **not** modified here |

### Data model and rules worth knowing

- `trip.people` is a list of `{ id, name, days? }`. An **absent** `days` property means **all trip days**, `days: []` means **no days**, and a nonempty array lists selected days. `tripDaysPopover()` in `app.mjs` edits this without changing its meaning.
- A category may exclude people (`excludedIds`) and optionally use the trip day of each expense (`useAttendance`). Each expense can override the category rules via `participantIds`.
- The stored JSON key is `benefitDate` for compatibility; the user-facing label is **Day this was for**. It must be within trip dates if filled.
- `amountCents` and per-person shares are integer cents. `compute()` distributes remainder pennies deterministically and checks settlement reconciliation. Never compute financial values using floating-point dollars.
- **Paid by** is separate from **who shares**. Someone can be reimbursed for a purchase they were excluded from consuming.
- `removeCategory()` refuses any category referenced by an expense. Unlike participant removal, safe unused-category removal doesn't need to rewrite other trip records.
- `mutate()` enforces the trip lock, increments the revision, and saves the trip. The UI is rerendered after persistence. Do not mutate the shared trip outside that flow without understanding the effect on synchronization.
- `paidTransfers` reflects checked-off proposed payments, not actual transfers of money.

## Regression checks for v1.0.1

- An unused category can be deleted and previously checked payments remain checked.
- Removing a category attached to one or more expenses is refused.
- The anchored trip-days editor opens beside the selected person, and closing it without saving leaves the trip data unchanged.
- Saving a subset of trip days persists the correct array; **Use all trip days** removes the array property to restore the default.
- Original Acadia expenses still sum to **$545.75** in the supplied sample, and all financial allocations and settlements balance to zero.
- Expense editing, the balance view, and both settlement display modes still work.

## Security and known limitations

- Shared-trip links act as invitation credentials. Share only with trusted friends; members currently have equal editing rights.
- Supabase stores the shared trip, and the published JavaScript is public. Use only the *publishable* key in `config.mjs`, **never** a secret or service-role key.
- The frontend lock is not a database-level organizer permission. Full role management, edit history and payment approval are future improvements.
- Changes from multiple editors use version checks; a conflicting save can fail rather than silently overwrite remote changes. Reload the latest trip before retrying.
- The compact settlement reduces payment count but is not guaranteed to find the global mathematical minimum in every possible case.
