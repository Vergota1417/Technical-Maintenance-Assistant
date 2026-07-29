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
