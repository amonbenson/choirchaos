# Choir Chaos

A web-based rehearsal platform for musical ensembles. Based loosely on [ChordChaos](https://chordchaos.com/) and other existing proprietary solutions. Directors can organize shows into songs, upload sheet music PDFs and MIDI/audio files, and run synchronized playback sessions with multi-track mixing, vamp loops, segue transitions, and real-time audio time-stretching. Access is role-based — shows can be private, unlisted, or public, with separate owner, editor, and viewer permissions.

## Current Limitations

A basic song editing interface is included, but it is not yet production-ready. Adding and synchronizing new media files (PDFs, MIDI, audio) currently requires direct access to the PocketBase admin dashboard.

## Technology Stack

[Vue 3](https://vuejs.org/) · [Vite](https://vitejs.dev/) · [TypeScript](https://www.typescriptlang.org/) · [Pinia](https://pinia.vuejs.org/) · [Tailwind CSS v4](https://tailwindcss.com/) · [PrimeVue](https://primevue.org/) · [PDF.js](https://mozilla.github.io/pdf.js/) · [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) · [Rubberband Web](https://www.npmjs.com/package/rubberband-web) · [PocketBase](https://pocketbase.io/) · [Dokku](https://dokku.com/)

## Project Structure

```
src/
├── views/          # Page components (AuthView, HomeView, WorkspaceView)
├── components/     # Reusable UI components (TransportBar, MixerPanel, PdfViewer, …)
├── composables/    # Reactive logic (pan/zoom, keyboard shortcuts, PDF pages)
├── core/
│   ├── midi/       # MIDI playback engine, audio player, warp mapping
│   ├── models/     # Data models (Show, Song, Track, Measure)
│   └── pdf/        # PDF rendering via Web Worker
├── stores/         # Pinia stores (auth, player, settings, PDF renderer)
├── pocketbase/     # PocketBase client, auth helpers, permissions model
└── router/         # Vue Router routes and navigation guards
```

## Development Setup

Node.js 20.19+ or 22.12+ is required. A running PocketBase instance is needed as the backend.

```bash
npm install
npm run dev       # dev server at http://localhost:5173
npm run typecheck # TypeScript validation
npm run lint:fix  # auto-fix linting issues
npm run build     # production build → dist/
npm run test      # unit tests
```

### Environment Variables

Create a `.env` file in the project root:

```env
VITE_BASE_URL="/"
VITE_PB_URL="https://your-pocketbase-instance.com"

# Optional: skip login during development
# VITE_PB_AUTOLOGIN_EMAIL="user@example.com"
# VITE_PB_AUTOLOGIN_PASS="yourpassword"
# VITE_PB_AUTOLOGIN_SHOW="<show-id>"
# VITE_PB_AUTOLOGIN_SONG="<song-id>"
```

`VITE_PB_URL` must point to a PocketBase instance with the correct collections and access rules configured. See `tmp/pocketbase_rules.md` for the expected filter rules.

## Deployment

The app is deployed to a Dokku server using the included `Dockerfile`. Pushing to `main` triggers the GitHub Actions CI pipeline, which runs lint and type checks and then deploys automatically via `git push dokku main`.

The following repository secrets and variables must be configured in GitHub:

| Name | Type | Description |
|---|---|---|
| `DOKKU_SSH_KEY_PRIVATE` | Secret | Private SSH key with push access to the Dokku server |
| `DOKKU_HOST` | Variable | Hostname of the Dokku server |
| `DOKKU_APP` | Variable | Name of the Dokku app to deploy to |

To test the Docker build locally:

```bash
docker compose up --build
# serves on http://localhost:8080
```
