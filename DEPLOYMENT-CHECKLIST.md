# Deployment checklist

- [ ] Extract the ZIP
- [ ] Upload the folder contents to the GitHub repository root
- [ ] Create Cloudflare D1 database `maintenance-assistant-db`
- [ ] Copy its database ID
- [ ] Replace the all-zero ID in `wrangler.jsonc`
- [ ] Run `schema.sql` in the D1 Console
- [ ] In Cloudflare Workers & Pages, select Create application → Import a repository
- [ ] Choose the GitHub repository
- [ ] Confirm Worker name `technical-maintenance-assistant`
- [ ] Deploy
- [ ] Optional: add encrypted secret `ACCESS_KEY`
- [ ] Open the workers.dev URL and test generation
- [ ] Approve one test entry
- [ ] Verify that it appears under Recent maintenance entries
- [ ] Use Export to create a backup

## v0.5 update verification

- [ ] Press Ctrl+F5 after Cloudflare finishes deploying
- [ ] Test `bad cables` and confirm it becomes one or two technical sentences
- [ ] Type part of a previously approved Issue and confirm a strong match refills Reason and Work performed
- [ ] Select a suggestion and confirm Step 1 is refilled
- [ ] Select a machine type under Approved Knowledge
- [ ] Select **Use in Step 1** and confirm Machine, Issue, Reason, and Work performed are refilled
- [ ] Confirm Results is not automatically marked as verified

## v0.5 AI and wording test

- [ ] Enter Machine: `Conveyor`
- [ ] Enter Issue: `bad motor on u connection`
- [ ] Enter Reason: `bad wire on blue cable`
- [ ] Enter Work performed: `replaced compplette motor`
- [ ] Leave machine verification unchecked
- [ ] Generate the record
- [ ] Confirm `compplette` is corrected to `complete`
- [ ] Confirm Issue, Reason, and Work performed are expanded into complete technical sentences
- [ ] Confirm Results remains blank
- [ ] Confirm the review message says Cloudflare Workers AI was used; if it still shows fallback, open Cloudflare Live Logs and inspect the `AI fallback:` message
