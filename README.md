# RedMix (AutoMix)

An installable, offline-first Progressive Web App (PWA) that transforms your local music collection into a continuous DJ-style mix. Beat-matched, bar-aligned, with equal-power bass swap transitions and harmonic Camelot wheel sequencing—running entirely client-side in the browser.

---

## Features

- **Professional DJ Transitions:**
  - **Bass-Swap Transitions:** Automatic 3-band EQ frequency automation. Low frequencies swap cleanly on a bar boundary over 1 beat, eliminating muddy clashing basslines.
  - **Beat & Bar Alignment:** Incoming tracks launch precisely on Beat 1 aligned to the active track's 4-beat bar grid.
  - **Tempo Matching:** Smooth tempo ramp ($\le \pm 6\%$) matching the active track during the blend, gently returning to the track's native BPM once soloed.
  - **Multiple Mix Styles & Durations:** Select between `bassSwap`, `longBlend`, and `simpleCrossfade`, with customizable mix lengths (8, 16, or 32 bars).
  - **Outro Detection:** Per-bar RMS energy detection identifies song wind-downs to initiate transitions automatically before the track finishes.
  - **Beat-Aligned Skip:** Jump to the next track instantly without jarring audio cuts.

- **Harmonic Playlist Sequencing:**
  - **Camelot Wheel Auto-Ordering:** Reorders your queue to follow harmonic mixing principles (same key, relative major/minor, adjacent keys on the circle of fifths) with minimal BPM deviation.

- **Client-Side DSP Analysis Worker:**
  - Runs in a background Web Worker without blocking the main UI thread.
  - Computes BPM, first downbeat offset, musical key (mapped to Camelot notation), per-bar energy structure, and loudness normalization gain.
  - Caches analysis results in IndexedDB by track hash and analysis version.

- **Interactive Track Editor:**
  - Fast downsampled waveform rendering with beat-grid overlay.
  - Nudge grid controls ($\pm 10\,\text{ms}$, $\pm 1\,\text{ms}$), BPM doubling/halving, and tap-to-set Beat 1.
  - Built-in audition player with beat-locked metronome clicks to preview grid edits before mixing.
  - Custom overrides persist locally and take priority in transition planning.

- **100% Offline & Private:**
  - Zero telemetry, zero external APIs, zero server dependencies, and no accounts required.
  - Audio files are stored locally via Origin Private File System (OPFS) and IndexedDB.

- **Installable PWA & Mobile Hardening:**
  - W3C Web App Manifest with standalone display.
  - Service Worker precaching app shell, icons, and worker assets for offline use.
  - Screen Wake Lock API integration to prevent display sleep during playback.
  - Media Session API integration for OS-level and lock-screen play/pause/skip controls.
  - Strict resource management: maximum 2 decoded `AudioBuffer`s retained in memory at any point.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Framework & UI** | React 18, Zustand, Tailwind CSS, Lucide Icons |
| **Audio Playback** | Web Audio API (`AudioContext`, `BiquadFilterNode`, `GainNode`, equal-power crossfader) |
| **Audio Planning** | Pure TypeScript mathematical planner (`src/audio/planner` isolated from DOM/UI) |
| **Storage** | IndexedDB via `idb`, Origin Private File System (OPFS) |
| **Tooling & Build** | Vite, TypeScript (strict mode), ESLint, Prettier |
| **Testing** | Vitest (117 unit tests), Playwright (7 end-to-end browser specs) |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- `npm`

### Installation

```bash
# Clone the repository
git clone https://github.com/vedantexists/redmix.git
cd redmix

# Install dependencies
npm install
```

### Running Locally

```bash
# Start Vite development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Building for Production

```bash
# Typecheck and build optimized bundle
npm run build

# Preview production build locally
npm run preview
```

---

## Running Verification & Tests

```bash
# Run unit tests
npm test

# Run end-to-end browser tests
npm run e2e

# Run strict TypeScript typecheck
npm run typecheck

# Run linter
npm run lint
```

---

## Project Structure

```
redmix/
├── src/
│   ├── app/                # React screens, components, stores, and hooks
│   │   ├── screens/        # Library, Playlist, NowMixing, TrackEditor, Settings
│   │   ├── store/          # Zustand state stores (library, playlist)
│   │   └── services/       # Wake lock, media session, playback coordinator
│   ├── audio/
│   │   ├── engine/         # Web Audio AudioContext, Decks, Mixer, AutoMix scheduler
│   │   ├── planner/        # Pure logic: transition planner, Camelot compatibility, auto-ordering
│   │   └── editor/         # Waveform canvas downsampling and audition player
│   ├── analysis/           # Web Worker: beat tracking, key detection, structure, loudness
│   ├── library/            # File importer, ID3 tag parser, OPFS and IndexedDB storage
│   └── shared/             # Common types and audio math utilities
├── tests/
│   ├── fixtures/           # Synthetic audio generators (deterministic click tracks)
│   ├── unit/               # Vitest unit suites (planner, engine, analysis, editor, pwa)
│   └── e2e/                # Playwright end-to-end browser test specifications
└── public/                 # Manifest, icons, service worker
```

---

## Platform & Browser Notes

- **Desktop (Chrome, Edge, Brave, Firefox):** Full support for File System Access API, OPFS storage, Screen Wake Lock, and background playback.
- **Mobile (Android Chrome):** Full support including PWA installation to home screen and Screen Wake Lock during active playback.
- **iOS Safari:**
  - Safari requires an explicit user tap before starting the Web Audio `AudioContext`.
  - iOS limits Web Audio when Safari is minimized or the screen is locked. Keep RedMix active in the foreground; the Screen Wake Lock prevents the screen from sleeping while audio is playing.
- **Supported Formats:** MP3, M4A/AAC, WAV, FLAC, and OGG (subject to browser decoder support).

---

## License

MIT
