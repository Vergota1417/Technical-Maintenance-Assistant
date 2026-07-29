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

## v0.4 update verification

- [ ] Press Ctrl+F5 after Cloudflare finishes deploying
- [ ] Test `bad cables` and confirm it becomes one or two technical sentences
- [ ] Type part of a previously approved Issue and confirm a strong match refills Reason and Work performed
- [ ] Select a suggestion and confirm Step 1 is refilled
- [ ] Select a machine type under Approved Knowledge
- [ ] Select **Use in Step 1** and confirm Machine, Issue, Reason, and Work performed are refilled
- [ ] Confirm Results is not automatically marked as verified
