# Cross-Cutting Constraints

Rules that span multiple components and do not belong to any single what/ file.

1. **Publication is public.** Everything published is readable by anyone who can reach the service. No component may imply confidentiality, per-viewer access control, or end-to-end encryption.
2. **No automatic secret redaction.** Neither the extension nor the service scans content for credentials. The only protection is the upload allowlist and the confirmation prompts.
3. **Keys are bearer secrets.** Treat the team upload key and each share's owner key as credentials. Never log them. Never publish them. Never send owner credentials to a different origin.
4. **HTTPS outside loopback.** The extension must refuse plain HTTP except on localhost. Deployment templates must terminate TLS at the reverse proxy.
5. **Single origin, single prefix.** Viewer links, API calls, assets, and SSE all live under `PUBLIC_URL`. Proxies must preserve the prefix and must not strip it.
6. **No third-party runtime assets.** Production must not need npm install, a browser build step, or a CDN. Browser libraries are pinned and committed under `web/vendor/` with their licenses.
7. **Node 22.18+.** The service depends on built-in `node:sqlite`. There is no other database driver.
8. **Readable log, not a mirror.** Truncation and allowlisting are intentional. Features must not promise exact session restoration or terminal fidelity.
9. **No durable upload queue.** Acknowledged writes survive a restart. Unacknowledged updates are lost. The publisher must re-publish them from persisted history.
10. **No publisher accounts or admin UI.** Access control is limited to keys, proxy/VPN placement, and manual revocation/deletion.
