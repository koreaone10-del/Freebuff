# Freebuff AlphaCode Studio 1.5.0

- Replaced the unverified v1.1.3 runtime pin with the published upstream AlphaCode v1.1.0 release and matching x86_64 Linux asset names.
- Reworked responsive layout for tablet and phone widths, with a compact collapsible mobile navigation.
- Added a conversational task composer with Chat, Code, Analysis and Web Research modes.
- Added multi-file upload (up to 5 files, 3 MB each, 8 MB total) for text, documents, source files and common images.
- Uploaded files are saved into the job workspace and explicitly treated as untrusted data, not auto-executed.
- Agent output remains auditable in the execution log; no simulated token streaming or fake progress is shown.

The engine still requires a successful Render build. Provider/model availability is controlled by upstream AlphaCode and may vary; the free model lane is not guaranteed unlimited. Render free instances have ephemeral storage and execution limits.
