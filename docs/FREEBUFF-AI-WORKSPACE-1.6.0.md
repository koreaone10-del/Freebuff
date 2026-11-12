# Freebuff AI Workspace 1.6.0

## New standalone UI
- `/ai.html` is a mobile-first Arabic RTL chat workspace powered by the existing AlphaCode headless runtime.
- Modes: general Q&A, coding, file/project analysis, and web research using AlphaCode's available tools.
- Multiple conversations are stored in the current browser's localStorage. They are not synchronized across devices and may be lost if browser data is cleared.
- The same `ALPHACODE_STUDIO_PASSWORD` authentication protects the workspace.
- File attachments reuse the existing AlphaCode job API (up to 5 files, 3 MB each, 8 MB total). Actual readability depends on the file format and installed AlphaCode build.
- Job output is polled from the existing job API; the UI does not invent streaming tokens or progress percentages.

## Important capability boundaries
AlphaCode is an agentic CLI, not a general multimodal foundation model. It can answer text prompts and perform coding/analysis/research tasks to the extent supported by its configured free provider and available tools. Image and video generation are explicitly marked as not connected in this release: they require separate image/video engines and adapters. No unlimited free inference is promised.

## Runtime and security
- Render Build Command: `npm install && npm run install:alphacode`.
- The agent process can execute commands as the Render service user. The job workspace is an application-level workspace, not an OS sandbox. Keep the workspace password private and do not expose the service publicly without additional isolation and access controls.
- Render free filesystem storage is ephemeral. Browser chat history is local to that browser; server jobs and workspaces are not guaranteed to persist across restarts/deploys.
