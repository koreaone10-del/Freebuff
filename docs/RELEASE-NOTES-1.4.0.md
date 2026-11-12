# Freebuff 1.4.0 — AlphaCode Studio

## Added
- Dedicated standalone AlphaCode Studio at `/alphacode.html`.
- Official AlphaCode v1.1.3 Linux x86_64 binary installation during Render build, with SHA-256 verification against the upstream release checksum.
- Password-protected adapter for headless `alphacode run` tasks.
- Public GitHub repository cloning into per-job workspaces.
- Task log polling, cancel requests, task history for the current runtime, and a one-active-job limit.
- User-level Markdown skill import and MCP configuration status view.
- Upstream MIT license and attribution notice.

## Important limitations
- Render free filesystem and running jobs are ephemeral; persistent AlphaCode sessions require persistent storage.
- The adapter does not expose a fabricated percentage. It reports actual process stages and logs.
- Native Firefox/desktop automation is not available in a headless Render service without a separately provisioned browser/desktop bridge.
- The upstream built-in free AI lane has provider-side availability and usage limits; no API key does not mean unlimited inference.
- This adapter is not an OS-level sandbox. Do not submit untrusted tasks or store secrets in agent workspaces; review generated changes.
