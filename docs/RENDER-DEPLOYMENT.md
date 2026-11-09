# Render deployment

## Deploy

This is a Node.js application. Render runs `npm install` and `npm start`. The server binds to `0.0.0.0:$PORT`; health check: `/api/health`. The included `render.yaml` defines the free web service. No API keys are required for the baseline application.

## Free/open services

- Image generation: AI Horde anonymous public request. The service is volunteer-powered, lower priority without an account, and may queue or fail when no compatible worker is online.
- Flight data: adsb.lol, Airplanes.live, then OpenSky fallback. Data availability and request limits are controlled by upstream services.
- Flight map: Leaflet with OpenStreetMap tiles. OSM attribution is shown on the map; the public tile service is best-effort and its usage policy applies.
- Chat/vision: LLM7 and Kilo public free endpoints; availability, anonymous quotas, and model catalogs can change without notice. OVH AI Endpoints was excluded because its official setup requires an API key and a cloud project. Audio-file transcription is disabled in the no-key release rather than routed through a key-required service.

## Render and long-running tasks

Render Free instances can sleep and their local filesystem is ephemeral. Do not store durable user uploads, generated media, or queues on the Render container. Browser sessions use IndexedDB/localStorage and can be cleared by browser cleanup. Export important conversations and download generated files.

## Video generation reality

The included video studio performs client-side editing/assembly from generated still images, narration, audio and animation. It does not run Wan, LTX or another native text-to-video model. These open models require GPU resources; standard GitHub Actions runners are CPU runners and Render Free is not a practical GPU host. The app must not show a fabricated percentage for a remote inference process.

## Live flight map

The map refreshes aircraft positions periodically from ADS-B APIs. The upstream feeds can be incomplete or unavailable. Flight labels (inbound/outbound/overflight) are estimates derived from a projected track and a coarse national boundary, not official flight plans, clearances, or guaranteed origin/destination.
