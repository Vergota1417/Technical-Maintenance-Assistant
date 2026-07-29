# Technical Maintenance Assistant — Cloudflare Edition

This version removes **Render** and **OpenAI API billing**.

It uses:

- **Cloudflare Workers** to host the application and API
- **Cloudflare D1** to save approved maintenance records
- **Cloudflare Workers AI** with `@cf/zai-org/glm-4.7-flash`
- A built-in technical rules formatter if Workers AI is unavailable or the free daily AI allocation is reached
- **GitHub** to keep the project organized and version controlled

## What the application does

- Converts rough technician notes into four short technical fields:
  - Issue
  - Reason
  - Work performed
  - Results
- Corrects common spelling and wording problems
- Does not invent a cause, repair, or successful result
- Generates a Results statement only when machine operation is confirmed
- Blocks lot, batch, recall, patient, customer, product identifier, quantity, and quality-disposition information
- Saves only records the technician reviews and approves
- Suggests similar approved repairs while the user types
- Exports all approved records as JSON for backup

## Project organization

```text
technical-maintenance-assistant-cloudflare/
├── public/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   ├── service-worker.js
│   ├── manifest.webmanifest
│   └── icons/
├── src/
│   ├── index.js
│   └── lib.js
├── migrations/
│   └── 0001_initial.sql
├── test/
│   └── lib.test.js
├── schema.sql
├── wrangler.jsonc
├── package.json
└── README.md
```

Upload the **contents of this folder** to the root of the GitHub repository. Do not upload only the ZIP file, and do not add another folder level around these files.

---

# Recommended setup: GitHub + Cloudflare dashboard

## Step 1 — Upload the project to GitHub

1. Extract the ZIP on Windows.
2. Open the extracted `technical-maintenance-assistant-cloudflare` folder.
3. Confirm that you can immediately see `public`, `src`, `migrations`, `package.json`, and `wrangler.jsonc`.
4. Create a new empty GitHub repository.
5. In the repository, select **Add file → Upload files**.
6. Select everything inside the extracted folder and drag it into GitHub.
7. Commit the files.

The GitHub repository root must show:

```text
public
src
migrations
test
package.json
wrangler.jsonc
README.md
```

## Step 2 — Create the free D1 database

1. Sign in to Cloudflare.
2. Open **Storage & databases → D1 SQL database**.
3. Select **Create database**.
4. Name it exactly:

```text
maintenance-assistant-db
```

5. Open the new database and copy its database ID.
6. Open `wrangler.jsonc` in GitHub.
7. Replace this placeholder:

```text
00000000-0000-0000-0000-000000000000
```

with the real D1 database ID.
8. Commit the change.

## Step 3 — Create the database table

1. In the Cloudflare D1 database, open **Console**.
2. Open `schema.sql` from the GitHub repository.
3. Copy the complete SQL content.
4. Paste it into the D1 console and run it.

This creates the `maintenance_records` table and indexes.

## Step 4 — Import the GitHub repository into Cloudflare Workers

1. Open **Workers & Pages** in Cloudflare.
2. Select **Create application**.
3. Select **Import a repository**.
4. Connect GitHub and choose the repository.
5. Confirm that the Worker name is:

```text
technical-maintenance-assistant
```

6. The deploy command can remain:

```text
npx wrangler deploy
```

7. Select **Save and Deploy**.

Cloudflare reads `wrangler.jsonc`, serves the `public` folder, binds Workers AI as `AI`, and binds the D1 database as `DB`.

## Step 5 — Optional access key

Without an access key, anyone who knows the public `workers.dev` address can open the form.

To add a shared passphrase:

1. Open the Worker in Cloudflare.
2. Go to **Settings → Variables and Secrets**.
3. Add an encrypted secret named:

```text
ACCESS_KEY
```

4. Enter a private passphrase as the value.
5. Redeploy if Cloudflare requests it.

The application will then display an access-key field.

## Step 6 — Test it

Open the assigned address similar to:

```text
https://technical-maintenance-assistant.YOUR-SUBDOMAIN.workers.dev
```

Test with:

```text
Machine: Indexing machine
Issue: index machine losts on sleeving
Reason: jam on sleeving nest
Work performed: reset the clutch by moving it to correct location
Machine operation verified: checked
```

Expected wording should be similar to:

```text
Issue: Indexing machine lost position during the sleeving operation.
Reason: A jam was present at the sleeving nest.
Work performed: Reset the clutch to the correct indexed position.
Results: Machine is running as intended.
```

Review the wording and select **Approve and save**. That approved entry then becomes available in future suggestions.

---

# Command-line setup alternative

Use this method when you prefer PowerShell instead of configuring everything in the dashboard.

```powershell
npm install
npx wrangler login
npx wrangler d1 create maintenance-assistant-db
```

Copy the returned database ID into `wrangler.jsonc`, replacing the all-zero placeholder. Then run:

```powershell
npm run db:remote
npm run deploy
```

Optional access key:

```powershell
npx wrangler secret put ACCESS_KEY
```

Local development:

```powershell
npm run db:local
npm run dev
```

Workers AI still uses the Cloudflare account allocation during local development.

---

# Free-plan behavior

The application is designed to remain within Cloudflare's free limits for a small maintenance tool.

- Workers Free accounts receive a daily request allowance.
- D1 Free includes daily database reads and writes plus free storage.
- Workers AI includes a free daily AI allocation.
- When the AI allocation is unavailable, the application automatically uses its built-in technical formatter instead of failing.
- The application does not use R2, Render, or an OpenAI API key.

Cloudflare account verification can vary. Do not activate a paid Workers plan or another billable Cloudflare product unless you intentionally want it.

# Safety and recordkeeping

This application is a drafting assistant, not an authorized production, quality, compliance, recall, or patient-record system. Technicians must review every generated field. Information required by company procedures must remain in the approved system of record.

# Tests

Run:

```powershell
npm test
```

The included tests cover:

- Sample technical wording
- Result-confirmation enforcement
- Product and quality-information guardrails
- Similar-record ranking
- Workers AI response parsing
- Prevention of invented fields
