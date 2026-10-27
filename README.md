# Choir Chaos

A web-based rehearsal platform for musical ensembles, loosely based on [ChordChaos](https://chordchaos.com/) and similar proprietary tools. Editors organize shows into songs and upload sheet music PDFs with MIDI or audio files. They mark the measures on the score (with automatic measure detection), sync audio recordings on a timeline, describe the repeats the recording already contains, and arrange vamps, repeats and cuts directly on the score. Rehearsers play songs back with multi-track mixing, the arrangement, segues and real-time time-stretching. Shows can be private, unlisted or public, with owner, editor and viewer roles.

## Technology Stack

[Vue 3](https://vuejs.org/) · [Vite](https://vitejs.dev/) · [TypeScript](https://www.typescriptlang.org/) · [Pinia](https://pinia.vuejs.org/) · [Tailwind CSS v4](https://tailwindcss.com/) · [PrimeVue](https://primevue.org/) · [PDF.js](https://mozilla.github.io/pdf.js/) · [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) · [Rubberband Web](https://www.npmjs.com/package/rubberband-web) · [PocketBase](https://pocketbase.io/) · [Dokku](https://dokku.com/)

## Project Structure

```
src/
├── views/          # Routed pages
├── components/     # UI components grouped by area
├── composables/    # Reusable reactive logic
├── stores/         # Pinia stores
├── router/         # Routes and navigation guards
├── pocketbase/     # PocketBase client and DB access
└── core/           # Framework-free models, playback engine, MIDI, PDF rendering, utilities
e2e/                # Playwright end-to-end tests
```

[`AGENTS.md`](AGENTS.md) describes the architecture and conventions in detail.

## Development Setup

Node.js 20.19+ or 22.12+ and a running [choirchaos-pb](https://github.com/amonbenson/choirchaos-pb) backend are required. Create a `.env` file in the project root:

```env
VITE_BASE_URL="/"
VITE_PB_URL="https://your-pocketbase-instance.com"

# Optional: skip login during development
# VITE_PB_AUTOLOGIN_EMAIL="user@example.com"
# VITE_PB_AUTOLOGIN_PASS="yourpassword"
# VITE_PB_AUTOLOGIN_SHOW="<show-id>"
```

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm run lint:fix   # lint with autofix
npm run typecheck  # TypeScript validation
npx vitest run     # unit tests
npm run build      # production build into dist/
```

### End-to-End Tests

The e2e suite runs the production build in Chromium against a fresh PocketBase container and needs Docker. Test scores, MIDI and audio are generated from code, see [`e2e/AGENTS.md`](e2e/AGENTS.md).

```bash
npx playwright install chromium   # once
npm run test:e2e                  # run the suite
npm run e2e:serve                 # seeded backend + frontend for manual testing
```

## Deployment

The app is deployed to a Dokku server using the included `Dockerfile`. On every push to `main`, the GitHub Actions pipeline runs lint, typecheck, unit tests, build and e2e tests and then deploys via `git push dokku`. It needs these repository settings:

| Name | Type | Description |
|---|---|---|
| `DOKKU_SSH_KEY_PRIVATE` | Secret | Private SSH key with push access to the Dokku server |
| `DOKKU_HOST` | Variable | Hostname of the Dokku server |
| `DOKKU_APP` | Variable | Name of the Dokku app to deploy to |

To test the Docker build locally:

```bash
docker compose up --build   # serves on http://localhost:8080
```
