# Freebuff 1.3.0 — No-key media and live map

- Removed Pollinations image generation and its required secret key from the default deployment.
- Image generation now uses the anonymous AI Horde path only; errors are returned honestly when the volunteer queue has no suitable worker.
- Removed simulated numeric image-generation progress. The UI now shows an indeterminate queue/wait state.
- Replaced the schematic SVG flight graphic with a real Leaflet map using OpenStreetMap tiles.
- Added live aircraft markers, heading rotation, aircraft detail popups, airport marker, and marker reconciliation on refresh.
- Preserved ADS-B source fallback across adsb.lol, Airplanes.live, and OpenSky.
- Removed the Pollinations secret from Render blueprint and example environment file.
- Removed OVH AI Endpoints from the anonymous provider chain because its official access requires an API key and cloud project.
- Kept vision on the anonymous Kilo free VL model; disabled audio-file transcription rather than presenting a key-required endpoint as keyless.
- Updated README and deployment notes to document no-key behavior and resource limits.

## Known constraints

- AI Horde is volunteer-powered and anonymous requests have lower priority; no uptime or generation-time guarantee.
- This build does not contain native Text-to-Video inference. Its studio assembles a video from still images, narration, audio and motion in the browser.
- True open-model video generation requires real GPU compute; Render Free and standard GitHub Actions runners do not provide a persistent free GPU worker.
- ADS-B map updates are best-effort and depend on upstream coverage and API availability.
