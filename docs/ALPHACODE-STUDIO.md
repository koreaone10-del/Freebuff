# AlphaCode Studio integration

Freebuff exposes AlphaCode as a separate web workspace at `/alphacode.html` while keeping the upstream Rust CLI as the actual agent engine.

## Upstream

- Project: https://github.com/dragonked2/alphacode
- Website/docs: https://alphacli.github.io/
- License: MIT (upstream `LICENSE` is retained in `third_party/alphacode-LICENSE.txt`).
- Pinned release: `v1.1.3`, Linux x86_64.

The Render build downloads the official release archive and verifies its published SHA-256 file before installing `.runtime/alphacode`. It does not reimplement or falsely claim ownership of AlphaCode.

## Runtime behavior

- The browser UI calls the local Node adapter under `/api/alphacode/*`.
- Tasks run using the upstream headless command `alphacode run "..."` in a per-job workspace.
- Only one task is run at a time on this single-instance adapter. The current run has a 20-minute process timeout.
- Public GitHub HTTPS repositories can be cloned into a fresh workspace. Private repository credentials are deliberately not accepted.
- Skills are saved as user-level Markdown skill files under the AlphaCode home directory.
- MCP status is read from user-level configuration. The web UI does not auto-execute project-supplied MCP definitions.
- The web UI shows stages and actual process output. It does not invent a percentage because the CLI does not expose a reliable numeric progress feed here.
- The built-in free model lane is upstream functionality. It requires internet connectivity and remains subject to the upstream provider's availability and limits; “no API key” does not mean unlimited inference.

## Render constraints

Render's free web service has an ephemeral filesystem and may spin down after inactivity. This means the default `/tmp/freebuff-alphacode` state, local AlphaCode sessions, and job workspaces are not durable on the free plan; a restart can interrupt a run and clear its state. For durable sessions, mount a persistent disk on a paid Render service and set `ALPHACODE_DATA_DIR` to that mount path. Long-running tasks are not guaranteed on the free web plan.

The Render container is headless. AlphaCode's native Firefox bridge and desktop-control tools require a separately configured local browser/desktop environment and are not available merely because the web panel is deployed. Some upstream tools may therefore report unavailable in Render.

## Security

- A Render-generated `ALPHACODE_STUDIO_PASSWORD` protects task execution; it is a workspace login password, not an AI API key.
- The adapter issues a short-lived in-memory session token after password verification.
- Only public GitHub HTTPS clone URLs are accepted by the UI.
- Child processes receive a filtered environment rather than the full Render environment, reducing accidental exposure of unrelated service secrets.
- AlphaCode can edit files and run shell commands inside the task workspace. Treat tasks and repositories as untrusted input, review the output, and do not store secrets in the workspace. This adapter is not a hardened OS-level container sandbox.

## License

AlphaCode remains an independent upstream project under MIT. Its upstream license is copied to `third_party/alphacode-LICENSE.txt`; the Freebuff adapter and UI are separate integration code.
