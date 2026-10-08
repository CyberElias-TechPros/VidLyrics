# BUILD PROMPT — Lyrics Video Studio

## Current speech-model packaging (2026-10-08)

The production `npm run build` creates a same-origin, versioned model pack alongside the app. It includes Whisper Tiny/Base and every Piper voice offered in the editor. The packer downloads the weights during the release build, verifies Piper files against upstream checksums, includes each voice's upstream `MODEL_CARD` plus the Whisper MIT notice, and splits files into 20 MiB chunks for static hosting. Large model binaries are generated under `apps/web/public/models/` and are intentionally ignored by Git.

- `npm run bundle-models:dry-run` lists the model pack without downloading it.
- `npm run build` downloads and packages the full model set; the build environment must be able to reach the upstream model hosts.
- `npm run build:app-only` builds the UI without weights for fast local verification. It is not a deployable speech-model release; generation will report that the model pack is missing.
- Expect roughly **0.85 GB** of weights before compression. The hosting provider must support the total static deployment and individual 20 MiB model chunks. Only the selected model is fetched from the app's own origin into local browser storage when used; inference remains in the browser.
- If a later app release changes a model's checksum, VidLyrics asks before fetching that model's replacement. Declining keeps the prior cached copy when it is still available.

Piper voice licences are individual. The pack includes each upstream model card; review those terms before redistribution or commercial use. Do not commit generated weights to Git.

You are the principal engineer, product owner, and art director for a greenfield web application. Build it, verify it, and report honestly on what you verified.

1. The product
A browser application that turns an audio file plus lyrics into a timed lyrics video. The user supplies both. The app solves timing, renders the video, and exports it.

Non-negotiable architectural constraint: audio never leaves the user's device. All decoding, analysis, alignment, rendering, and encoding happen client-side. This is a privacy guarantee, a cost strategy, and a legal posture simultaneously. Any design that uploads user audio is rejected regardless of how well it performs.

This constraint is not negotiable for convenience. If a feature seems to require a server, either find the client-side path or cut the feature.

2. Architecture
Frontend: React + TypeScript + Vite, deployed to Vercel or Cloudflare Pages as a static site.

Backend: none for v1. Do not create a database, an object store, or an API. There is no user data on a server because there is no server.

You may add exactly one Cloudflare Worker, and only for these, and only if you reach Phase 5:

serving the ONNX model files with correct CORS and long-lived cache headers
an anonymous, aggregate-only metrics endpoint (counts, no content, no identifiers)
No D1. No R2. No KV. No Durable Objects. No Queues. If you believe one is required, stop and state the argument rather than building it.

Required hosting headers (set these in vercel.json / _headers on day one — they are load-bearing for threaded WASM and ffmpeg.wasm):

Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Every cross-origin asset must then be CORP/CORS-clean. Verify this before writing feature code; discovering it in Phase 4 means reworking asset loading.

3. Two surfaces, two design languages
Do not apply one visual system to the whole app. They have opposite goals.

Surface A — Marketing / landing page
Here, go all in. Cinematic, immersive, art-directed. Full-bleed composition, large-scale typography, layered depth, scroll-driven reveals, purposeful ambient motion, a memorable signature moment. It should look like a creative studio built it, not like a component library got assembled.

Rules that still bind: LCP under 2.5s, no layout shift, prefers-reduced-motion fully honored, keyboard-complete, all content present in the DOM for crawlers. Effects are GPU-friendly transforms and opacity only. Every effect must earn its place through hierarchy, feedback, storytelling, depth, atmosphere, or delight — if it does none of those, delete it.

Do not build: generic hero → three cards → stats → testimonials → CTA. Derive the composition from what this product actually is — audio, waveforms, time, type on screen. Let the waveform, the timeline, and kinetic typography be the visual language. The landing page should demo the product's own aesthetic.

Surface B — The editor
This is a professional tool. Density over drama. Restraint is the design.

Scrub-to-frame latency under 16 ms. Nothing may animate on the critical input path.
No scroll-jacking, no parallax, no entrance animations on panels the user opens fifty times an hour.
Motion is limited to state feedback: 120–180 ms transitions on hover/focus/selection, and easing on timeline zoom.
Craft shows up as: precise alignment, a real type scale, meaningful use of color (confidence, selection, playhead), pixel-accurate waveform rendering, clear focus rings, and a keyboard shortcut for everything.
Dark theme first — people edit video in dark rooms. Light theme supported.
The editor should feel like Ableton or Figma, not like a landing page. Judge it by how it feels after two hours of use, not two seconds.

4. Build order with verification gates
Do not proceed to the next phase until the current gate passes. Do not build all phases before testing any.

Phase 1 — The whole loop, no ML
Ingest audio → decode in a worker → waveform → paste lyrics → manual tap-sync (user taps a key per line during playback, timestamped from AudioContext.currentTime, not Date.now()) → one clean theme → WebCodecs export to MP4 → .lrc export.

Gate: a real 3-minute song produces a downloadable MP4 with correct audio sync, verified against a click-track test file, not by ear. This phase alone is a shippable product. Treat it as such.

Phase 2 — Editor depth
Zoomable timeline, draggable line blocks with edge-trim, word-level handles, loop-region playback, split/merge/insert/delete, inline text edit, full keyboard control, undo/redo via a command stack, autosave to IndexedDB, crash recovery, import/export of .lrc / enhanced .lrc / .srt / .vtt / .ass with karaoke tags.

Gate: kill the tab mid-edit; reload restores state. Complete a full sync using only the keyboard.

Phase 3 — Automation
CTC forced alignment (wav2vec2-class model via onnxruntime-web, WebGPU with WASM SIMD fallback) against user-supplied lyrics. Then Whisper ASR via transformers.js as a fallback mode for users without lyrics. Then hybrid reconciliation: align the ASR word sequence to the true lyric sequence with Needleman–Wunsch and transplant the timings.

Emit per-word confidence and surface it in the editor as visual heat. Never present machine output as certain.

Timing post-processing: gap fill, minimum display duration (~600 ms), lead-in (~300 ms), optional beat-grid snap, instrumental-region detection, and a global offset slider applied at render time only — never baked into stored timings.

Gate: median word-level timing error under 100 ms on a hand-labeled set of at least 15 songs spanning genres and at least 3 languages. Report the actual measured number. If you did not measure it, say so.

Phase 4 — Creative
Theme library, karaoke fill modes, backgrounds (gradient, image with Ken Burns, looping video, FFT-driven visualizer, beat-reactive pulse), album-art palette extraction, aspect presets (16:9, 9:16, 1:1, 4:5) with platform safe-area overlays, intro/outro cards, brand presets.

Gate: export the same project to all four aspect ratios; text is legible and inside safe areas in every one.

Phase 5 — Edge and polish
Vocal isolation (mid/side subtraction as the always-available cheap tier; an MDX-class ONNX model as the good tier), syllable-level karaoke, romanization and translation tracks, duet speaker tracks, PWA offline, accessibility audit, i18n of the UI.

5. Unhappy paths are first-class requirements
Do not build only the happy path. Every one of these must have designed, tested behavior — a clear explanation and a route forward, never a dead end or a bare error toast:

Unsupported or corrupt audio file → format guidance, list of what works
Audio over the length limit → offer to export a range
Model download fails or is cancelled midway → resumable, with a "use the small model" and a "sync manually instead" escape
WebGPU unavailable → silent fallback to WASM SIMD, with a slower-ETA notice
Alignment returns broadly low confidence → offer ASR-assist, then manual tap-sync. Never leave the user stuck
WebCodecs unavailable (older Safari/Firefox) → ffmpeg.wasm path with an honest time warning
Out of memory during export → suggest lower resolution or a shorter range; do not just crash
Mobile background-tab throttling killing a long render → detect, warn before starting, and recover
iOS AudioContext requiring a user gesture
Storage quota exceeded → clear guidance on which projects to remove
Two tabs open on the same project → detect and warn rather than silently clobbering
The recovery path from any failure is manual tap-sync. It requires no model, no GPU, no download, and works in every browser and every language. It is the floor beneath everything else. Build it first, keep it reachable from everywhere.

6. Correctness details that are easy to miss
Preview and export must call one renderFrame(scene, timeMs) function. Two renderers will diverge and the export will not match what the user saw.
Export must render offline frame-by-frame at constant frame rate. Never capture realtime playback — it drops frames on slow machines and produces VFR output.
Respect encoder.encodeQueueSize backpressure or memory will blow on long songs.
AAC encoder priming delay shifts audio ~20 ms early if unhandled during muxing.
await document.fonts.ready before rendering frame 0, or frame 0 uses a fallback font.
Iterate text by grapheme cluster (Intl.Segmenter), not code unit, or emoji and combining marks break per-character karaoke fill.
CJK/Thai line breaking and RTL shaping need real handling; Canvas2D does RTL poorly.
Content-hash asset references so duplicate audio/images aren't stored twice.
Schema-version every project with forward migrations; refuse to silently load a newer schema.
7. Legal requirements
Never bundle, fetch, or scrape a lyrics database. Genius, Musixmatch, AZLyrics — all licensed data. Lyrics come from the user, always, with no exceptions and no "convenience" integration.
Ship a Terms of Service placing responsibility for rights in the user's hands, and a takedown policy.
Only include fonts whose license permits embedding in exported video and redistribution. OFL is safe. "Free for personal use" is not.
Verify the license of every model you ship. Whisper is MIT; check separation models individually.
Because processing is local, "your audio never leaves your device" is literally true. State it prominently — it is your strongest differentiator and your cheapest one.
8. Honesty rules
Never mark something complete while it is mocked, stubbed, or untested. Use explicit states: Implemented, Verified, Not verified, Blocked.
Never report a metric you did not measure. If you did not run the timing-accuracy benchmark, write "not measured," not an estimate.
Never weaken a test to make it pass, swallow an exception, or comment out broken functionality.
Fix root causes, not symptoms.
When you think you are done, assume you are wrong and try to break it: empty project, 20-minute audio, lyrics with no matching audio, malformed .lrc import, mid-export tab switch, keyboard-only traversal, 320px viewport.
9. Definition of done
✓ 3-min song → MP4 in under 90s at 1080p30 on a mid-range laptop
✓ A/V sync verified against a click track, frame-accurate
✓ Same project exported twice produces identical frames
✓ Every failure in section 5 has tested, designed behavior
✓ Manual tap-sync reachable from every failure state
✓ Full sync completable with keyboard only
✓ Crash mid-edit recovers on reload
✓ Editor scrub latency under 16 ms
✓ Landing page: LCP < 2.5s, no CLS, reduced-motion honored
✓ Timing accuracy measured and reported with the real number
✓ Works on mobile Safari, or degrades with a clear explanation
✓ No user audio transmitted anywhere — verified in the network tab
✓ ToS, takedown policy, and font/model licenses in place
✓ README describes the system that actually exists
10. Final report
State: what was built per phase; what was verified versus merely implemented; the measured timing-accuracy number; every known limitation; every unhappy path and its tested behavior; browser support matrix with what degrades where; and exact deploy steps.

Do not claim verification that did not happen.

I reviewed the complete `Pasted markdown(4).md`, including its autonomous engineering system, repository-reconstruction methodology, evidence hierarchy, product/UX audits, visual-design system, motion principles, Vercel + Cloudflare architecture, security, SEO, testing, adversarial verification, documentation, production gates, and final directives.   

I have **not simply appended the lyric-video requirements to the old prompt**. I consolidated the system so that the lyric-video application's unusual characteristics—browser-side media processing, transcription, timing, rendering, GPU acceleration, large local files, memory pressure, offline capability, deterministic video generation, and free-tier economics—are treated as first-class architectural requirements.

The result below is designed to be the **master prompt I would actually use for this project**.

# ULTIMATE LYRIC VIDEO STUDIO

# AUTONOMOUS PRODUCT ENGINEERING, MEDIA ENGINEERING, AI TRANSCRIPTION, VIDEO RENDERING & WORLD-CLASS DIGITAL EXPERIENCE MASTER PROMPT

## AUTONOMOUS PRINCIPAL ENGINEERING + PRODUCT + MEDIA + AI + DESIGN + MOTION + SECURITY + PERFORMANCE + PRODUCTION OPERATING SYSTEM

---

# 0. PRIMARY MISSION

You are being given an existing software repository for a **Lyric Video Studio**.

You are not merely being asked to:

* inspect the repository
* explain the code
* fix obvious bugs
* make the build pass
* create a few UI screens
* connect an API
* add a transcription button
* produce a basic video
* or preserve the application's current implementation.

You are taking **full autonomous ownership of the product**.

Act simultaneously as:

* Principal Software Architect
* Senior Full-Stack Engineer
* Product Engineer
* Product Manager
* UX/UI Designer
* Creative Director
* Art Director
* Motion Designer
* Interaction Designer
* Design Systems Engineer
* Media Application Engineer
* Audio Engineer
* Video Pipeline Engineer
* Browser Runtime Engineer
* AI/ML Integration Engineer
* Transcription/Alignment Engineer
* Rendering Engineer
* Graphics Engineer
* Web Audio Engineer
* WebCodecs Engineer
* WebAssembly Engineer
* WebGPU/WebGL Engineer
* Database Architect
* Cloud Architect
* DevOps Engineer
* Security Engineer
* QA Engineer
* Performance Engineer
* Reliability Engineer
* Accessibility Engineer
* SEO Engineer
* Content Architecture Engineer
* Technical Writer
* Product Analyst
* Codebase Archaeologist
* Production Readiness Engineer

Your mission is:

> **Understand what this application is, reconstruct what it is intended to accomplish, determine what an excellent production-grade lyric-video creation platform should be, identify everything broken, incomplete, weak, missing, contradictory, insecure, inefficient, poorly designed, poorly optimized, poorly documented, or otherwise holding the product back, then intelligently repair, complete, redesign, harden, optimize, test, document, and productionize it.**

Do not merely improve the codebase.

> **Improve the product itself.**

The final product must aim to be:

* genuinely useful
* fully functional
* browser-first
* local-first where practical
* privacy-conscious
* cost-aware
* AI-assisted
* media-capable
* visually exceptional
* modern
* distinctive
* immersive
* interactive
* responsive
* accessible
* secure
* performant
* maintainable
* scalable
* observable
* reliable
* SEO-ready for its public-facing surfaces
* production-capable
* deployable on a free/low-cost architecture
* capable of generating real lyric videos end-to-end

The target is not:

> “A website that can upload an audio file.”

The target is:

> **“A complete browser-based lyric-video production studio that can take a song from raw audio to accurately synchronized, beautifully designed, rendered and exportable lyric video.”**

---

# 1. CORE PRODUCT CONCEPT

The application is fundamentally a:

> **Browser-first lyric-video production studio.**

Its conceptual pipeline is:

```text
AUDIO
  ↓
MEDIA INGESTION
  ↓
AUDIO ANALYSIS
  ↓
TRANSCRIPTION
  ↓
WORD-LEVEL ALIGNMENT
  ↓
LYRIC CLEANUP
  ↓
LYRIC SEGMENTATION
  ↓
TIMING EDITOR
  ↓
VISUAL DESIGN
  ↓
SCENE COMPOSITION
  ↓
ANIMATION
  ↓
AUDIO-REACTIVE EFFECTS
  ↓
REAL-TIME PREVIEW
  ↓
DETERMINISTIC RENDER
  ↓
VIDEO ENCODING
  ↓
AUDIO + VIDEO MUXING
  ↓
VALIDATION
  ↓
EXPORT
```

The application must be architected around a **structured lyric-video project**, not around an already-rendered video.

The video is the output.

The project is the source of truth.

---

# 2. THE MOST IMPORTANT ARCHITECTURAL PRINCIPLE

## PROJECT ≠ VIDEO

The canonical representation of the user's work must be a structured project.

Conceptually:

```text
LyricVideoProject
├── project metadata
├── audio
├── lyrics
├── word timings
├── sections
├── scenes
├── backgrounds
├── media assets
├── typography
├── styles
├── animations
├── effects
├── visualizers
├── keyframes
├── transitions
├── audio-reactive mappings
├── canvas/output configuration
├── export configuration
└── project history
```

The final video is generated from that representation.

Never make the exported MP4 the only source of truth.

This enables:

* editing
* undo/redo
* re-rendering
* multiple export resolutions
* aspect-ratio conversion
* template switching
* timing correction
* scene editing
* style changes
* future collaboration
* project import/export
* deterministic rendering
* autosave
* crash recovery

---

# 3. THE REPOSITORY IS EVIDENCE, NOT ABSOLUTE TRUTH

Never assume the existing repository represents the ideal state.

It may contain:

* incomplete development
* abandoned code
* outdated architecture
* obsolete documentation
* unfinished features
* placeholder UI
* mock implementations
* hardcoded data
* inconsistent business rules
* insecure shortcuts
* broken integrations
* unused dependencies
* dead code
* partial migrations
* contradictory assumptions
* poor UX
* weak SEO
* incomplete deployment configuration
* fake media processing
* fake transcription
* fake rendering
* client/server contract mismatches

Therefore:

> **Understand the repository before trusting it.**

Preserve what is correct.

Repair what is broken.

Replace what is fundamentally inadequate.

Remove what is obsolete.

Complete what is clearly intended.

Infer what is missing only when evidence supports the inference.

---

# 4. AUTONOMOUS ENGINEERING CONSTITUTION

You have broad authority to improve the project.

However:

> **Autonomy does not mean unrestricted invention.**

Ground major decisions in:

1. Explicit requirements
2. Existing product behavior
3. Repository evidence
4. User workflows
5. Data/business rules
6. Media requirements
7. Browser capabilities
8. Security requirements
9. Reliability requirements
10. Performance requirements
11. Operational requirements
12. Accessibility requirements
13. Industry standards
14. Sound engineering principles
15. Reasonable product inference

Never add complexity merely because it is technically interesting.

Never preserve bad architecture merely because it already exists.

Never invent elaborate functionality without justification.

---

# 5. PRIMARY AUTONOMOUS LOOP

Continuously operate using:

```text
DISCOVER
    ↓
UNDERSTAND
    ↓
RECONSTRUCT
    ↓
CLASSIFY
    ↓
BASELINE
    ↓
AUDIT
    ↓
PRIORITIZE
    ↓
PLAN
    ↓
IMPLEMENT
    ↓
TYPECHECK
    ↓
TEST
    ↓
REVIEW
    ↓
ATTACK YOUR OWN ASSUMPTIONS
    ↓
FIX
    ↓
RE-AUDIT
    ↓
OPTIMIZE
    ↓
VALIDATE
```

Do not assume the first audit is sufficient.

---

# 6. CONTEXT AVAILABILITY ASSESSMENT

First determine how much reliable project context exists.

Classify it as:

### CONTEXT-RICH

Substantial:

* PRD
* README
* architecture documentation
* API documentation
* database documentation
* user stories
* design specifications
* product requirements

### CONTEXT-LIMITED

Some documentation exists but important gaps remain.

### CONTEXT-POOR

Little meaningful product documentation exists.

### CONTEXT-FREE

Almost no explicit requirements exist.

---

# 7. LOW-CONTEXT RECOVERY MODE

If documentation is weak or absent:

> **DO NOT STOP.**

Enter:

# AUTONOMOUS CONTEXT RECOVERY MODE

Extract intent from:

* repository structure
* filenames
* directories
* package names
* dependencies
* routes
* pages
* components
* navigation
* forms
* labels
* copy
* API endpoints
* request payloads
* response structures
* database schemas
* migrations
* models
* types
* interfaces
* enums
* permissions
* role definitions
* validation rules
* error messages
* business logic
* seed data
* mock data
* tests
* fixtures
* comments
* TODOs
* environment variables
* configuration
* integrations
* webhooks
* analytics events
* assets
* branding
* icons
* URL structures
* feature flags
* Git history where available
* deployment files
* CI/CD configuration
* Vercel configuration
* Wrangler configuration
* Cloudflare bindings

For this application additionally inspect:

* media-processing libraries
* transcription libraries
* WebAssembly modules
* audio workers
* render workers
* codecs
* canvas/WebGL/WebGPU code
* WebCodecs usage
* FFmpeg usage
* IndexedDB usage
* File System Access API usage
* waveform logic
* timing models
* lyric schemas
* subtitle parsers
* project serialization
* export logic
* worker communication
* memory-management code
* browser capability detection

Treat all of these as evidence.

---

# 8. PRODUCT RECONSTRUCTION

Determine:

### What is this application?

A lyric-video production studio.

### What problem does it solve?

It should allow users to transform songs/audio into professionally synchronized lyric videos without requiring conventional desktop video-editing software.

### Who uses it?

Potential users include:

* musicians
* singers
* worship leaders
* churches
* gospel artists
* independent artists
* producers
* content creators
* YouTubers
* social-media creators
* karaoke creators
* lyric-video designers
* music marketers
* small media teams
* agencies
* hobbyists
* beginners
* professional editors

Do not assume every persona requires the same workflow.

### What are users trying to accomplish?

Examples:

* create a lyric video automatically
* transcribe a song
* import existing lyrics
* synchronize lyrics
* manually correct timing
* create karaoke-style highlighting
* design scenes
* add animated backgrounds
* add visualizers
* add images/video
* add branding
* create vertical social content
* export subtitles
* export the finished video
* save/edit projects later
* work offline
* reuse templates
* create multiple versions of one song

---

# 9. USER EXPERIENCE PRINCIPLE

The core experience should be:

```text
UPLOAD
↓
UNDERSTAND
↓
TRANSCRIBE
↓
CORRECT
↓
SYNC
↓
DESIGN
↓
PREVIEW
↓
RENDER
↓
EXPORT
```

The user should never be forced to understand media-engineering complexity unless they want advanced control.

Provide:

### SIMPLE MODE

For beginners.

### ADVANCED MODE

For experienced editors.

The same underlying project model should power both.

---

# 10. PRIMARY USER STORIES

Implement complete flows for at least:

## USER STORY 1 — First-time automatic lyric video

```text
Open application
↓
Create project
↓
Upload audio
↓
Analyze audio
↓
Transcribe
↓
Review lyrics
↓
Generate timing
↓
Choose visual style
↓
Preview
↓
Render
↓
Validate output
↓
Export
```

Every stage must have:

* loading state
* progress
* cancellation where appropriate
* errors
* retry
* recovery
* useful feedback

---

## USER STORY 2 — Existing lyrics

```text
Create project
↓
Upload audio
↓
Import lyrics
↓
Parse lyrics
↓
Normalize lyrics
↓
Align lyrics to audio
↓
Edit timing
↓
Design
↓
Preview
↓
Render
↓
Export
```

Support importing where appropriate:

* TXT
* SRT
* VTT
* ASS
* LRC
* JSON
* project files

---

## USER STORY 3 — Manual synchronization

```text
Upload audio
↓
Enter/paste lyrics
↓
Split lyrics
↓
Play audio
↓
Tap/mark start
↓
Advance lyric
↓
Generate timestamps
↓
Fine tune
↓
Preview
↓
Render
```

Provide:

* tap-to-sync
* keyboard shortcuts
* play/pause
* seek
* nudge
* snap
* timing offsets
* line splitting
* merging
* waveform-assisted editing

---

## USER STORY 4 — Karaoke mode

Support:

```text
Song
↓
Lyrics
↓
Word timing
↓
Progressive highlighting
↓
Optional syllable-level future support
↓
Animated karaoke rendering
```

---

## USER STORY 5 — Social-media version

User chooses:

* 9:16
* 1:1
* 4:5
* 16:9
* 4:3
* custom

The project should intelligently recompose content rather than simply crop it.

---

## USER STORY 6 — Existing project

```text
Open project
↓
Load project JSON
↓
Restore assets
↓
Restore timeline
↓
Restore lyrics
↓
Restore styles
↓
Restore scenes
↓
Continue editing
```

---

## USER STORY 7 — Offline user

Where browser capability permits:

```text
Open PWA
↓
Load local project
↓
Process local audio
↓
Transcribe locally
↓
Edit
↓
Render locally
↓
Export locally
```

No account should be mandatory for the core workflow.

---

# 11. COMPLETE PRODUCT PIPELINE

The application must implement the entire process:

```text
MEDIA INGESTION
↓
FILE VALIDATION
↓
AUDIO DECODING
↓
AUDIO NORMALIZATION
↓
AUDIO ANALYSIS
↓
TRANSCRIPTION
↓
TIMESTAMP EXTRACTION
↓
LYRIC NORMALIZATION
↓
SEGMENTATION
↓
ALIGNMENT
↓
TIMING EDITING
↓
SCENE GENERATION
↓
STYLE APPLICATION
↓
ANIMATION
↓
AUDIO REACTIVITY
↓
PREVIEW
↓
RENDER PLANNING
↓
FRAME GENERATION
↓
VIDEO ENCODING
↓
AUDIO ENCODING
↓
MUXING
↓
OUTPUT VALIDATION
↓
EXPORT
```

No critical stage should be represented by a fake placeholder.

---

# 12. FREE-TIER-FIRST PRODUCT REQUIREMENT

The core application must be designed around:

> **Maximum useful computation on the user's device, minimum unnecessary server computation.**

The product should function without:

* mandatory paid APIs
* mandatory subscriptions
* mandatory cloud rendering
* mandatory cloud transcription
* mandatory external AI APIs

Where feasible, the core workflow should work using:

* browser APIs
* WebAssembly
* local inference
* Web Workers
* IndexedDB
* Canvas
* WebGL
* WebGPU
* WebCodecs
* local file APIs
* local rendering
* client-side processing

This does **not** mean every operation must run locally.

It means:

> **For every operation, explicitly determine whether browser-side execution is practical before sending it to a server.**

---

# 13. COMPUTE LOCATION OPTIMIZATION

For every meaningful operation classify it as:

```text
LOCAL
EDGE
SERVER
HYBRID
OPTIONAL CLOUD
```

Evaluate:

* CPU cost
* GPU cost
* RAM usage
* file size
* latency
* privacy
* browser support
* reliability
* battery usage
* implementation complexity
* scalability
* monetary cost

Prefer local processing when it is:

* technically feasible
* reliable
* performant enough
* privacy-beneficial
* cost-effective

Prefer server processing when local processing would be:

* impossible
* excessively slow
* unreliable
* unsupported
* dangerously memory-intensive
* operationally unreasonable

---

# 14. COST MODEL

For every major feature classify:

```text
FREE LOCAL
FREE SERVER
LOW-COST SERVER
EXTERNAL API
OPTIONAL PAID
```

The core product must remain usable without paid infrastructure.

Avoid unnecessary:

* Worker invocations
* database writes
* database reads
* object storage
* bandwidth
* polling
* external API calls
* queue jobs
* server rendering
* cloud AI inference

Do not sacrifice correctness merely to reduce cost.

---

# 15. PREFERRED DEPLOYMENT ARCHITECTURE

Preferred:

```text
                 USERS
                   │
                   ▼
          ┌──────────────────┐
          │      VERCEL      │
          │ FRONTEND / PWA   │
          └────────┬─────────┘
                   │
             HTTPS / API
                   │
                   ▼
          ┌──────────────────┐
          │ CLOUDFLARE       │
          │ WORKERS API      │
          └────────┬─────────┘
                   │
       ┌───────────┼────────────┐
       │           │            │
       ▼           ▼            ▼
      D1          R2           KV
   metadata     cloud files   cache/
                            configuration
```

Optional:

```text
Durable Objects
Queues
Cron
```

Only introduce them where genuinely justified.

---

# 16. CRITICAL ARCHITECTURAL DIFFERENCE FOR THIS PRODUCT

The normal architecture:

```text
Frontend
↓
Backend
↓
Database
↓
Storage
```

must NOT become the primary media-processing architecture.

Instead:

```text
                USER DEVICE
                    │
       ┌────────────┼─────────────┐
       │            │             │
       ▼            ▼             ▼
   Audio Engine  AI Engine   Render Engine
       │            │             │
       └────────────┼─────────────┘
                    ▼
              Project Engine
                    │
                    ▼
              Local Storage
                    │
                    ▼
                Export
```

Cloud services provide optional:

```text
Accounts
↓
Project metadata
↓
Cloud backup
↓
Sharing
↓
Templates
↓
Community
↓
Optional collaboration
```

The backend should be a **cloud convenience layer**, not the default compute engine.

---

# 17. BROWSER MEDIA ENGINEERING

Treat media engineering as a first-class engineering discipline.

Evaluate:

* codecs
* containers
* sample rates
* channels
* bit depth
* frame rates
* timestamps
* keyframes
* encoding
* muxing
* seeking
* buffering
* synchronization
* memory pressure
* GPU acceleration
* color spaces
* aspect ratios
* audio/video drift
* browser support

Never assume that because a file plays in the browser it is automatically suitable for deterministic rendering.

---

# 18. AUDIO INGESTION

Support common audio formats where technically feasible.

At minimum evaluate:

* MP3
* WAV
* M4A
* AAC
* OGG
* FLAC where supported

On upload:

1. validate file
2. identify MIME/type
3. inspect size
4. decode
5. determine duration
6. determine sample rate
7. determine channels
8. detect malformed input
9. normalize processing representation
10. generate waveform data
11. release unnecessary memory

Never trust file extension alone.

---

# 19. AUDIO ANALYSIS ENGINE

Analyze where practical:

* duration
* sample rate
* channel count
* waveform
* RMS/loudness
* peak level
* silence
* pauses
* clipping
* BPM
* beats
* beat confidence
* onset events
* energy
* frequency spectrum
* low/mid/high frequency energy
* spectral changes
* song sections
* intro
* verse
* pre-chorus
* chorus
* bridge
* hook
* refrain
* outro
* instrumental sections

The analysis engine should feed downstream systems.

Example:

```text
BPM
↓
Beat Grid
↓
Timeline snapping
↓
Animation timing
↓
Scene transitions
↓
Particle bursts
↓
Text emphasis
```

---

# 20. TRANSCRIPTION ENGINE

Transcription is a core feature.

Support a local/browser-first transcription strategy where practical.

Possible architecture:

```text
Audio
↓
Audio preprocessing
↓
Worker
↓
WASM / local speech model
↓
Transcript
↓
Word timestamps
↓
Alignment
```

Never architect the application around a mandatory paid transcription API.

External transcription providers may be optional adapters.

---

# 21. WORD-LEVEL TIMING IS A CORE REQUIREMENT

Line-level transcription alone is insufficient.

Represent timing hierarchically:

```text
Song
└── Section
    └── Line
        └── Phrase
            └── Word
                └── optional syllable
```

Each timed entity should support:

```text
id
text
start
end
confidence
source
locked
style
```

Potential timing sources:

```text
MODEL
ALIGNMENT
BEAT
MANUAL
IMPORTED
INFERRED
```

Never silently pretend inferred timings are exact.

---

# 22. TIMING DATA MODEL

Time must be a first-class domain type.

Do not scatter inconsistent floating-point timestamps throughout the application.

Prefer deterministic integer time units internally, such as:

```text
microseconds
```

or another explicitly defined precision.

Example:

```ts
type Microseconds = number;
```

Use consistent conversion boundaries.

This protects against:

* floating-point drift
* frame rounding errors
* inconsistent comparisons
* audio/video synchronization bugs
* cumulative timing errors

---

# 23. LYRIC NORMALIZATION

After transcription/import:

Normalize:

* whitespace
* punctuation
* capitalization
* duplicate spaces
* malformed characters
* Unicode normalization
* line breaks
* repeated fragments

Never modify user lyrics destructively without preserving the original.

Track:

```text
original
normalized
edited
```

where appropriate.

---

# 24. LYRIC SEGMENTATION

Automatically divide lyrics into useful units.

Support:

* lines
* phrases
* words
* sections
* repeated choruses
* hooks
* refrains

Infer sections where confidence is sufficient.

Possible labels:

```text
INTRO
VERSE
PRE_CHORUS
CHORUS
HOOK
REFRAIN
BRIDGE
BREAKDOWN
INSTRUMENTAL
OUTRO
```

Always allow manual correction.

---

# 25. REPEATED-LYRIC DETECTION

Detect repeated lyrics where practical.

Use this to:

* recognize repeated choruses
* reuse style
* preserve timing behavior
* suggest consistent animation
* identify song structure
* create scene variation without unnecessary manual work

Never alter user intent automatically.

---

# 26. LYRIC EDITOR

The editor must support:

* edit text
* split line
* merge lines
* delete line
* reorder
* duplicate
* adjust timing
* move start
* move end
* move entire line
* edit word timing
* lock timing
* lock styling
* change section
* search lyrics
* undo
* redo
* copy/paste
* keyboard shortcuts

Provide both:

### TEXT VIEW

and:

### TIMELINE VIEW

and:

### WAVEFORM VIEW

They must remain synchronized.

---

# 27. TIMING EDITOR

Provide:

* waveform
* playhead
* zoom
* horizontal scroll
* line markers
* word markers
* beat markers
* section markers
* snapping
* manual timing
* keyboard nudging
* tap-to-sync
* playback speed
* loop region
* selected lyric playback
* start/end handles
* bulk offset
* timing stretch
* timing compression

Snapping options:

```text
Frame
Word
Beat
Half Beat
Quarter Beat
Bar
Section
Manual
```

---

# 28. KARAOKE ENGINE

Support:

### Line highlight

Entire line changes state.

### Word highlight

Words progressively activate.

### Progressive fill

Text fill travels through the word.

### Glow progression

Current word receives glow.

### Scale emphasis

Active words subtly enlarge.

### Color transition

Active words transition to the highlight color.

### Beat-aware emphasis

Words can respond to nearby musical events.

The rendering engine must make these effects deterministic.

---

# 29. FUTURE SYLLABLE SUPPORT

Design the timing model so syllable-level timing can be added later without restructuring the project.

Do not implement syllables merely for novelty.

Architect for:

```text
word
↓
syllable
↓
character
```

where future features require it.

---

# 30. “MAKE IT BEAUTIFUL” AUTOMATION

Implement an intelligent design-generation layer.

The user should eventually be able to press:

> **MAKE IT BEAUTIFUL**

The engine analyzes:

* song duration
* BPM
* energy
* lyric density
* line lengths
* section structure
* repeated lyrics
* beat positions
* frequency distribution
* mood signals where technically defensible
* timing density
* aspect ratio
* safe areas

Then intelligently selects:

* visual theme
* font
* font size
* color palette
* background
* text placement
* lyric animations
* scene transitions
* visualizer
* beat effects
* section changes
* typography hierarchy
* emphasis behavior
* motion intensity

The result must be editable.

Automation should create a strong starting point, not trap the user.

---

# 31. TEMPLATE ENGINE

Build a data-driven template system.

Templates may include styles such as:

* Minimal
* Clean
* Cinematic
* Karaoke
* Gospel
* Worship
* Afrobeats
* Hip-hop
* R&B
* Electronic
* Neon
* Retro
* Social
* Editorial
* Ambient
* High-energy
* Typographic
* Photographic

Do not hardcode templates into UI components.

Templates should be structured data.

Conceptually:

```text
Template
├── metadata
├── typography
├── colors
├── backgrounds
├── lyric behavior
├── animations
├── transitions
├── visualizers
├── effects
├── scene rules
└── responsive rules
```

Allow users to save customized templates.

---

# 32. VISUAL DESIGN ENGINE

Support:

* solid colors
* gradients
* animated gradients
* image backgrounds
* video backgrounds
* procedural backgrounds
* particles
* stars
* waves
* equalizers
* spectrum
* aurora
* bokeh
* grain
* noise
* light leaks
* geometric motion
* waveform backgrounds
* reactive backgrounds

Use multiple compositing layers.

---

# 33. MEDIA ASSETS

Support:

* images
* video
* GIF where practical
* logos
* overlays
* textures
* backgrounds

Provide:

* asset library
* metadata
* dimensions
* duration
* preview
* deletion
* replacement
* duplicate detection where useful
* memory-aware loading

Never decode every asset at full resolution unnecessarily.

---

# 34. IMAGE MOTION

Support:

* pan
* zoom
* Ken Burns
* position keyframes
* scale keyframes
* rotation
* opacity
* blur
* crop
* focal-point positioning

Use the same deterministic renderer for preview and export.

---

# 35. SCENE SYSTEM

A project should contain multiple scenes.

Example:

```text
Scene 1
INTRO

Scene 2
VERSE

Scene 3
CHORUS

Scene 4
VERSE

Scene 5
BRIDGE

Scene 6
OUTRO
```

Each scene can define:

* duration
* background
* typography
* lyric layout
* animation
* effects
* visualizer
* transitions
* media
* audio-reactive behavior

Scene transitions must be time-aware.

---

# 36. MULTI-TRACK TIMELINE

Support tracks such as:

```text
Audio
Background
Video
Images
Overlays
Particles
Visualizer
Lyrics
Logo
Effects
```

Each track should support:

* visibility
* locking
* muting
* ordering
* timing
* trimming
* duplication
* deletion

---

# 37. KEYFRAME ENGINE

Support keyframes for:

* position
* scale
* rotation
* opacity
* blur
* color
* glow
* effects
* camera-like motion
* visualizer intensity

Support easing:

* linear
* ease-in
* ease-out
* ease-in-out
* cubic curves
* spring-like interpolation where appropriate

Keyframes must be deterministic.

---

# 38. AUDIO-REACTIVE ENGINE

Map audio characteristics to visual properties.

Potential sources:

```text
Beat
Kick
Bass
Mid
High
Volume
Energy
Onset
Spectrum
```

Potential targets:

```text
Scale
Opacity
Glow
Blur
Rotation
Particle emission
Background brightness
Camera movement
Visualizer size
Text emphasis
Image zoom
```

Provide sensible defaults.

Do not require users to understand signal processing.

---

# 39. VISUALIZER ENGINE

Support:

* waveform
* oscilloscope
* frequency bars
* spectrum
* circular spectrum
* equalizer
* radial visualizer
* waveform ribbon
* particle spectrum

Visualizers must be:

* customizable
* performant
* deterministic for export
* responsive to output resolution

---

# 40. TYPOGRAPHY ENGINE

Provide:

* font family
* font size
* weight
* width
* line height
* letter spacing
* alignment
* capitalization
* opacity
* fill
* stroke
* outline
* shadow
* glow
* blur
* gradient fill
* gradient movement
* text masking
* clipping
* wrapping
* max width
* safe-area awareness

Support:

```text
Global Style
↓
Section Style
↓
Line Style
↓
Word Style
```

with inheritance and overrides.

---

# 41. SMART LYRIC PLACEMENT

Automatically consider:

* aspect ratio
* safe areas
* lyric length
* font metrics
* background brightness
* visual focal point
* scene composition
* media subject location
* current animation
* screen readability

Avoid placing lyrics over important visual content where practical.

Provide manual override.

---

# 42. SMART LINE BREAKING

Automatically consider:

* punctuation
* pauses
* word boundaries
* duration
* musical phrasing
* maximum characters
* font width
* screen dimensions
* readability

Never split words incorrectly merely to fit a box.

---

# 43. RESPONSIVE VIDEO COMPOSITION

Do not merely resize the same layout.

For:

```text
16:9
9:16
1:1
4:5
4:3
Custom
```

allow:

* different lyric positions
* different font sizes
* different safe zones
* different scene composition
* different media crop
* different visualizer positioning
* different animation behavior

A vertical export should feel deliberately designed for vertical viewing.

---

# 44. EXPORT PRESETS

Support sensible presets such as:

```text
YouTube
YouTube Shorts
TikTok
Instagram Reels
Instagram Post
Facebook
Custom
```

Allow:

* resolution
* frame rate
* bitrate/quality
* codec
* audio quality
* aspect ratio

Validate that selected settings are compatible.

---

# 45. RENDERING ARCHITECTURE

The canonical pipeline should conceptually be:

```text
PROJECT JSON
      ↓
SCENE GRAPH
      ↓
TIMELINE
      ↓
FRAME STATE
      ↓
FRAME RENDERER
      ↓
CANVAS / WEBGL / WEBGPU
      ↓
VIDEO ENCODER
      ↓
AUDIO ENCODER
      ↓
MUXER
      ↓
OUTPUT FILE
```

Preview and final export must consume the same scene definition.

Do not create one rendering implementation for preview and an unrelated implementation for export unless unavoidable.

---

# 46. BROWSER RENDERING TECHNOLOGY STRATEGY

Evaluate and use where supported:

* Canvas
* OffscreenCanvas
* Web Workers
* WebAssembly
* WebGL
* WebGPU
* WebCodecs
* AudioWorklet
* Web Audio API

Possible role separation:

```text
MAIN THREAD
→ UI

WORKER
→ transcription

WORKER
→ audio analysis

WORKER
→ render preparation

WORKER
→ frame generation

WORKER
→ encoding/muxing where feasible
```

Never perform heavy processing on the main UI thread if it can reasonably be isolated.

---

# 47. WEBGPU / WEBGL GRACEFUL DEGRADATION

Do not assume WebGPU exists.

Use capability detection:

```text
Detect capabilities
↓
Build performance profile
↓
Select renderer
```

Example:

### Powerful device

```text
WebGPU
+
WebCodecs
+
high-quality local model
```

### Average device

```text
WebGL
+
WebCodecs / WASM
+
balanced model
```

### Weak device

```text
Canvas
+
smaller model
+
lower preview quality
```

The application must remain functional even when advanced acceleration is unavailable.

---

# 48. PREVIEW ENGINE

Preview should be optimized for responsiveness, not necessarily final quality.

Provide:

* play
* pause
* seek
* loop
* frame stepping
* selected-section preview
* low-resolution preview
* quality selector
* FPS awareness
* dropped-frame indication where useful

Never block the UI unnecessarily.

---

# 49. PREVIEW VS FINAL RENDER

Clearly distinguish:

```text
REAL-TIME PREVIEW
```

from:

```text
FINAL QUALITY RENDER
```

Preview may use:

* lower resolution
* lower effect quality
* lower particle count
* simplified blur
* lower-quality assets
* reduced sampling

Final rendering must use the configured project quality.

---

# 50. RENDER QUEUE

Support:

* start render
* progress
* stage reporting
* estimated progress where defensible
* cancellation
* retry
* failure recovery
* output validation
* render history

Example:

```text
Preparing
↓
Rendering Frames
↓
Encoding Video
↓
Encoding Audio
↓
Muxing
↓
Validating
↓
Complete
```

Never display fake progress.

---

# 51. MEMORY MANAGEMENT

This is critical.

Large media files can overwhelm browser memory.

Implement:

* lazy loading
* streaming where possible
* chunking where practical
* object URL lifecycle management
* asset disposal
* worker termination
* model unloading
* renderer cleanup
* bitmap disposal
* audio buffer lifecycle management
* render chunking where possible
* preview-quality adaptation

Do not keep multiple massive representations of the same media in memory unnecessarily.

---

# 52. AI MODEL RESOURCE MANAGEMENT

Avoid loading large AI models and FFmpeg simultaneously when unnecessary.

Prefer:

```text
TRANSCRIPTION
↓
release transcription resources
↓
RENDER
↓
release rendering resources
```

where practical.

Monitor:

* memory
* model size
* load time
* initialization failures
* device capability

Provide graceful fallback.

---

# 53. PROJECT STORAGE

Core projects should be locally persistent.

Use appropriate browser storage such as:

* IndexedDB
* Cache Storage
* File System Access API where supported

Store:

```text
project metadata
lyrics
timings
styles
scenes
effects
settings
asset references
```

Do not assume IndexedDB should contain every huge binary asset indefinitely.

Use sensible storage strategies.

---

# 54. LOCAL-FIRST PROJECT MODEL

A user should be able to:

* create a project
* save it
* close the browser
* return later
* restore it
* export it
* import it
* continue editing

without requiring an account for the basic workflow.

---

# 55. PROJECT FILE FORMAT

Define a versioned project format.

Example:

```text
.lyricproject
```

or structured JSON.

Include:

```text
formatVersion
project
audio
lyrics
timings
sections
scenes
assets
styles
animations
effects
export
```

Support migrations between project versions.

Never silently corrupt older projects.

---

# 56. PROJECT IMPORT / EXPORT

Support:

* project export
* project import
* asset references
* packaged projects where practical
* JSON project representation
* version migration

Validate imported projects before loading them.

Never execute arbitrary imported project code.

---

# 57. SUBTITLE EXPORTS

Where appropriate support:

* SRT
* VTT
* ASS
* TXT
* LRC
* JSON

JSON should support:

* line timings
* word timings
* sections
* confidence
* metadata

---

# 58. MANUAL LYRICS MODE

Users must be able to bypass transcription.

Flow:

```text
Create project
↓
Upload audio
↓
Paste/type lyrics
↓
Split
↓
Sync
↓
Design
↓
Render
```

The application must never force AI transcription.

---

# 59. TRANSLATION ARCHITECTURE

Where appropriate allow translated lyric layers.

Example:

```text
Original
English
French
Spanish
Portuguese
Yoruba
Igbo
etc.
```

Do not assume machine translation is perfect.

Keep original lyrics separate.

Support:

* original
* translation
* transliteration
* display layer

---

# 60. LYRIC DISPLAY MODES

Potential modes:

* standard lyric
* karaoke
* word-by-word
* phrase-by-phrase
* typewriter
* progressive reveal
* highlighted current line
* dual-language
* lyric + translation
* lyric + transliteration

All must use the same underlying timing model.

---

# 61. ANIMATION SYSTEM

Support entrance animations:

* fade
* slide
* scale
* blur-to-sharp
* clip reveal
* mask reveal
* stagger
* wipe
* split
* typewriter
* pop
* zoom
* directional reveal

Exit animations:

* fade
* slide
* scale
* blur
* collapse
* clip
* wipe

Continuous:

* float
* drift
* pulse
* breathe
* shimmer
* glow
* subtle rotation

In-lyric:

* karaoke highlight
* glow
* pulse
* scale
* color transition
* gradient movement
* underline
* wave
* word emphasis

Every animation must be purposeful.

---

# 62. MOTION CHOREOGRAPHY

Do not animate isolated elements randomly.

Design motion as sequences.

For example:

```text
Scene enters
↓
Background establishes atmosphere
↓
Lyrics appear
↓
Primary word activates
↓
Supporting visual reacts
↓
Beat arrives
↓
Visual emphasis occurs
↓
Scene resolves
↓
Next scene transitions
```

Use:

* timing
* delay
* staggering
* easing
* duration
* hierarchy
* beat alignment

Motion should feel connected to the music.

---

# 63. ORGANIC MOTION

Motion should feel natural.

Use:

* easing
* interpolation
* spring-like behavior
* subtle inertia
* controlled acceleration
* controlled deceleration

Avoid:

* arbitrary bouncing
* excessive spinning
* repetitive loops
* distracting movement

---

# 64. CINEMATIC MOTION

When appropriate support:

* dramatic reveals
* layered depth
* controlled camera-like motion
* scene transitions
* parallax
* atmospheric lighting
* large typography
* full-frame imagery
* slow movement
* rhythmic cuts

Never sacrifice readability or synchronization.

---

# 65. TACTILE EDITOR EXPERIENCE

The editor should feel responsive.

Consider:

* draggable timeline handles
* magnetic snapping
* responsive buttons
* animated panels
* smooth inspector transitions
* contextual toolbars
* keyboard shortcuts
* hover feedback
* touch interactions
* resize handles
* selected-state transitions

Never make essential functionality dependent on hover or pointer effects.

---

# 66. COMPLETE VISUAL TOOLBOX

Use the complete visual toolbox intelligently.

Consider:

### Layout

* Grid
* Flexbox
* container queries
* media queries
* intrinsic sizing
* fluid sizing
* clamp
* min
* max
* calc
* aspect ratios
* sticky positioning
* absolute positioning
* layered positioning
* overlaps
* full-screen composition
* asymmetric layouts
* editorial layouts
* bento layouts
* split layouts
* floating compositions

### Typography

* display typography
* variable fonts
* fluid typography
* animated text
* clipping
* masking
* gradient text
* editorial typography

### Color

* primary
* secondary
* accent
* semantic
* surface
* background
* gradients
* transparency
* highlights
* glow

### Surfaces

* flat
* elevated
* glass
* floating
* layered
* gradient
* editorial
* interactive
* 3D

### Effects

* shadows
* blur
* filters
* gradients
* glow
* overlays
* texture
* transparency
* blend modes

### Transforms

* translate
* scale
* rotate
* skew
* 3D translation
* perspective
* transform origin

### Composition

* clipping
* masking
* organic shapes
* diagonal structures
* curved structures
* gradient masks
* image masks
* text masks
* overlapping layers

Do not use everything.

> **Understand the complete toolbox; intelligently select what the product needs.**

---

# 67. ALIVE + BEAUTIFUL + IMMERSIVE PRODUCT DESIGN

The application itself must feel:

> **Alive.**

> **Beautiful.**

> **Modern.**

> **Immersive.**

> **Slick.**

> **Organic.**

> **Tactile.**

> **Cinematic where appropriate.**

> **Visually compelling.**

> **Bespoke.**

> **Distinctive.**

> **Sophisticated.**

> **Memorable.**

And where genuinely appropriate:

> **Avant-garde.**

The interface should feel like a sophisticated creative application rather than a collection of generic dashboard components.

---

# 68. DESIGN QUALITY HIERARCHY

Use:

```text
Product Purpose
↓
Usability
↓
Clarity
↓
Accessibility
↓
Performance
↓
Brand Identity
↓
Visual Sophistication
↓
Immersion
↓
Experimental Enhancement
```

Do not sacrifice the earlier layers for the later ones.

---

# 69. ANTI-GENERIC DESIGN RULE

Avoid automatically creating:

* generic SaaS dashboards
* repetitive cards
* excessive rounded containers
* random gradients
* unnecessary glassmorphism
* generic dark-mode interfaces
* predictable sidebars
* component-library-looking layouts
* template-like editor screens

The editor should have its own identity.

The interface should feel designed specifically for a **music + visual creation workflow**.

---

# 70. EDITOR UX DESIGN

The central studio should have an intentional workspace hierarchy.

Potential structure:

```text
┌─────────────────────────────────────────────────────────────┐
│ TOP BAR                                                     │
│ Project • Undo • Redo • Preview • Render • Export           │
├───────────────┬─────────────────────────────┬───────────────┤
│ ASSETS /      │                             │ INSPECTOR      │
│ TOOLS         │       VIDEO CANVAS          │               │
│               │                             │ Properties    │
│ Lyrics        │                             │ Typography    │
│ Backgrounds   │                             │ Animation     │
│ Media         │                             │ Effects       │
│ Templates     │                             │ Timing        │
│ Audio         │                             │               │
├───────────────┴─────────────────────────────┴───────────────┤
│ TIMELINE / WAVEFORM / LYRICS / BEATS                        │
└─────────────────────────────────────────────────────────────┘
```

This is a conceptual structure, not a rigid requirement.

Derive the final composition from actual usability.

---

# 71. EDITOR STATES

Support:

* first launch
* empty project
* importing
* analyzing
* transcribing
* syncing
* editing
* previewing
* rendering
* export complete
* export failed
* offline
* low memory
* unsupported browser capability
* missing asset
* corrupted project
* unsaved changes

Every state must communicate clearly what is happening.

---

# 72. UNDO / REDO / HISTORY

Every meaningful editing action should be reversible where practical.

Support:

* undo
* redo
* history
* snapshots
* autosave
* crash recovery

Do not make users afraid to experiment.

---

# 73. AUTOSAVE

Autosave project state intelligently.

Avoid:

* excessive writes
* blocking UI
* race conditions
* corrupted states

Use:

```text
Debounced persistence
+
Versioning
+
Atomic update strategy
```

where practical.

---

# 74. CRASH RECOVERY

If the browser or tab crashes:

Attempt to restore:

* project
* lyrics
* timings
* scenes
* styles
* recent changes

Provide a clear recovery experience.

---

# 75. RESPONSIVE WEB APP

The public-facing application should be responsive.

The editor itself may require a specialized responsive strategy.

Desktop:

> full studio

Tablet:

> condensed studio

Mobile:

> simplified editing workflow

Do not attempt to force the full desktop timeline onto a tiny screen.

---

# 76. MOBILE EXPERIENCE

Support practical mobile operations such as:

* upload
* transcription
* basic lyric correction
* template selection
* simple timing correction
* preview
* export

Advanced timeline operations may require a simplified interface.

---

# 77. ACCESSIBILITY

Implement:

* semantic HTML
* keyboard navigation
* visible focus
* focus-visible states
* accessible labels
* screen-reader support
* sufficient contrast
* appropriate touch targets
* reduced motion
* non-hover alternatives
* accessible dialogs
* accessible menus
* accessible timeline controls

Respect:

```text
prefers-reduced-motion
```

---

# 78. KEYBOARD SHORTCUT SYSTEM

Where appropriate:

```text
Space
Play/Pause

← →
Seek

Shift + ← →
Fine seek

Ctrl/Cmd + Z
Undo

Ctrl/Cmd + Shift + Z
Redo

Ctrl/Cmd + S
Save

Delete
Delete selected

B
Split

M
Marker

I
Set In

O
Set Out
```

The actual shortcut system should be conflict-free and configurable.

---

# 79. FRONTEND ENGINEERING AUDIT

Evaluate:

* architecture
* component boundaries
* state management
* rendering
* data fetching
* caching
* invalidation
* lazy loading
* code splitting
* bundle size
* memory usage
* event listeners
* subscriptions
* worker lifecycle
* API abstractions
* types
* forms
* validation
* routing
* duplicated logic
* hardcoded configuration

---

# 80. STATE ARCHITECTURE

Separate:

```text
UI STATE
PROJECT STATE
TIMELINE STATE
MEDIA STATE
PROCESSING STATE
RENDER STATE
PERSISTENCE STATE
AUTH STATE
SERVER STATE
```

Do not put everything into one giant state object.

Use domain boundaries.

---

# 81. BACKEND ENGINEERING AUDIT

Evaluate:

* API architecture
* business logic
* validation
* authorization
* database access
* error handling
* retries
* idempotency
* concurrency
* caching
* logging
* observability
* rate limiting
* background jobs
* integrations

---

# 82. BACKEND RESPONSIBILITIES

Cloud backend may provide:

* authentication
* user accounts
* project metadata
* cloud project synchronization
* optional asset storage
* optional backup
* template catalog
* public sharing
* collaboration metadata
* usage analytics
* feature configuration
* administration

Do not force the backend to process every audio file.

---

# 83. CLOUDFLARE WORKERS

Use Workers for appropriate:

* APIs
* authentication
* authorization
* project synchronization
* sharing
* lightweight processing
* webhooks
* edge logic

Do not turn Workers into a long-running video-rendering server.

---

# 84. CLOUDFLARE D1

Use D1 for structured relational metadata.

Potential entities:

```text
users
projects
project_versions
templates
template_versions
shares
assets
asset_metadata
organizations
memberships
audit_events
usage_events
```

Do not store large binary media in D1.

Do not store every lyric word as a database row unless a real requirement justifies it.

A project's lyric/timing document can generally remain a structured project payload.

---

# 85. CLOUDFLARE R2

Use R2 only where cloud storage is justified.

Potential:

* project packages
* user assets
* generated exports
* thumbnails
* shared media

Do not automatically upload every locally processed audio file.

Prefer local storage for local-first workflows.

---

# 86. CLOUDFLARE KV

Use KV for:

* configuration
* caching
* feature flags
* temporary lightweight state

Do not use KV as the relational database.

---

# 87. DURABLE OBJECTS

Use only when genuine stateful coordination exists.

Possible future uses:

* live collaboration
* synchronized editing
* collaborative sessions

Do not introduce them merely because they are available.

---

# 88. QUEUES

Use where justified for:

* email
* notifications
* cloud asset processing
* optional server-side jobs
* asynchronous integrations
* cleanup

Do not queue operations that are faster and cheaper locally.

---

# 89. CRON

Use only where needed for:

* cleanup
* stale cloud asset removal
* scheduled maintenance
* reports
* synchronization

---

# 90. CLOUD STORAGE STRATEGY

The application should clearly distinguish:

```text
LOCAL ASSET
CLOUD ASSET
GENERATED LOCAL EXPORT
GENERATED CLOUD EXPORT
```

Users must understand where their data exists.

---

# 91. PRIVACY-FIRST PROCESSING

Clearly communicate:

* whether audio stays on the device
* whether transcription is local
* whether assets are uploaded
* whether projects sync
* whether cloud rendering exists
* whether analytics are collected

Never claim “private” if data is actually transmitted.

---

# 92. AUTHENTICATION

If accounts exist, audit:

* registration
* login
* logout
* sessions
* expiry
* refresh
* password handling
* recovery
* verification
* cookies
* tokens
* multi-device behavior
* brute-force protection
* enumeration
* session invalidation

Never expose secrets to clients.

---

# 93. AUTHORIZATION

For every protected operation:

```text
Authenticated?
↓
Authorized?
↓
Correct role?
↓
Correct ownership?
↓
Correct resource?
↓
Correct operation?
```

Protect against:

* IDOR
* privilege escalation
* ownership bypass
* admin exposure
* frontend-only authorization

Authorization must be enforced server-side.

---

# 94. SECURITY AUDIT

Look for:

* XSS
* SQL injection
* command injection
* SSRF
* CSRF
* path traversal
* insecure uploads
* insecure CORS
* broken access control
* exposed secrets
* token leakage
* sensitive-data exposure
* verbose production errors
* weak cookies
* replay attacks
* webhook spoofing
* rate-limit bypass
* brute-force attacks
* vulnerable dependencies
* insecure redirects

For media applications additionally investigate:

* malicious media files
* decompression/resource exhaustion
* oversized uploads
* malformed project files
* unsafe asset URLs
* malicious SVG
* unsafe imported metadata
* arbitrary project execution
* codec/parser vulnerabilities

---

# 95. FILE VALIDATION

Treat uploaded files as untrusted.

Validate:

* MIME type
* extension
* size
* actual decodability
* dimensions
* duration
* codec
* container
* metadata
* ownership
* storage authorization

Do not trust filename extensions.

---

# 96. IMPORTED PROJECT SECURITY

Imported projects must be treated as untrusted data.

Never execute arbitrary code contained in:

* project files
* JSON
* SVG
* templates
* imported metadata

Validate against a strict schema.

---

# 97. BUSINESS LOGIC AUDIT

Extract rules from:

* conditions
* validators
* enums
* permissions
* calculations
* database constraints
* lifecycle states
* UI restrictions
* media state
* render state

Find contradictions.

---

# 98. MEDIA STATE MACHINE

Media operations must have explicit lifecycle states.

Example:

```text
IDLE
↓
IMPORTING
↓
VALIDATING
↓
DECODING
↓
ANALYZING
↓
READY
```

Transcription:

```text
QUEUED
↓
LOADING_MODEL
↓
TRANSCRIBING
↓
ALIGNING
↓
COMPLETE
```

Rendering:

```text
QUEUED
↓
PREPARING
↓
RENDERING
↓
ENCODING
↓
MUXING
↓
VALIDATING
↓
COMPLETE
```

Failure:

```text
FAILED
↓
RETRYABLE
or
BLOCKED
```

Do not represent complex processes with ambiguous boolean flags.

---

# 99. REAL-WORLD FAILURE HANDLING

Assume users will:

* double-click
* refresh
* close the tab
* lose internet
* run multiple tabs
* upload huge files
* upload malformed files
* cancel processing
* cancel rendering
* lose browser memory
* run unsupported browsers
* switch applications
* run on low-power devices
* interrupt rendering
* reopen projects
* import old projects
* duplicate exports

Handle meaningful cases.

---

# 100. SECOND-ORDER ANALYSIS

For every major change ask:

> **What problem might this fix create?**

Examples:

```text
Local caching
→ stale project state

Large models
→ memory pressure

Rendering
→ battery/CPU usage

Cloud backup
→ privacy/storage cost

Autosave
→ excessive writes

Cloud sync
→ conflict resolution

Worker processing
→ lifecycle complexity

Asset caching
→ storage exhaustion

Project import
→ security risks

Multiple tabs
→ conflicting edits
```

Address consequential side effects.

---

# 101. THIRD-ORDER ANALYSIS

Ask:

> **If this application grows substantially, what breaks next?**

Consider:

* number of users
* project count
* project size
* storage
* cloud sync
* template count
* concurrent sessions
* collaboration
* database size
* asset bandwidth
* generated exports
* API usage
* analytics
* operational complexity

Fix foreseeable problems proportionately.

---

# 102. PERFORMANCE ENGINEERING

Evaluate:

### UI

* rendering
* bundle size
* JavaScript execution
* state updates
* unnecessary rerenders
* timeline virtualization
* canvas rendering
* DOM complexity

### Media

* decoding
* waveform generation
* transcription
* rendering
* encoding
* memory
* GPU utilization

### Network

* requests
* payload size
* caching
* unnecessary API calls
* asset downloads

Optimize actual bottlenecks.

---

# 103. TIMELINE PERFORMANCE

A song can contain thousands of timed words/elements.

Do not render thousands of complex DOM elements unnecessarily.

Use:

* virtualization
* canvas where appropriate
* viewport-aware rendering
* simplified offscreen elements
* memoization
* batched updates
* efficient timeline data structures

Timeline zoom should not cause catastrophic rendering cost.

---

# 104. RENDER PERFORMANCE

Use:

* workers
* GPU acceleration where available
* efficient texture handling
* caching
* precomputation
* frame reuse where safe
* render chunking
* adaptive quality

Never block the main thread during heavy rendering if avoidable.

---

# 105. PRECOMPUTATION

Precompute reusable information:

* waveform
* beat grid
* lyric layout
* text metrics
* scene boundaries
* animation curves
* asset metadata
* visualizer data

Do not repeatedly calculate expensive values every frame.

---

# 106. DETERMINISTIC RENDERING

Given:

```text
Same Project
+
Same Assets
+
Same Export Settings
```

the renderer should produce materially consistent output.

Avoid non-deterministic random effects unless seeded.

If particles/randomness are used:

```text
projectSeed
+
sceneSeed
+
effectSeed
```

must produce repeatable results.

---

# 107. FRAME ACCURACY

Synchronize:

```text
Audio Time
↔
Project Time
↔
Scene Time
↔
Lyric Time
↔
Animation Time
↔
Frame Time
```

Use a single canonical timeline.

Do not allow separate subsystems to invent their own clocks.

---

# 108. AUDIO/VIDEO SYNC VALIDATION

After rendering verify:

* duration
* audio start
* audio end
* lyric timing
* frame timing
* scene timing
* output frame rate
* audio sample rate
* mux duration
* A/V synchronization

Where feasible perform automated sanity checks.

---

# 109. EXPORT VALIDATION

Never declare an export successful merely because an encoder returned a file.

Validate:

* file exists
* file size
* container validity
* codec
* duration
* audio stream
* video stream
* resolution
* frame rate
* synchronization
* readable playback metadata

---

# 110. ERROR MESSAGING

Errors must tell users:

1. What happened?
2. Why did it happen?
3. What can they do?

Examples:

Bad:

> Render failed.

Better:

> The video renderer ran out of available browser memory while processing this project. Try lowering preview/export resolution, closing other tabs, or reducing high-resolution media.

Do not expose unnecessary technical internals.

---

# 111. GRACEFUL DEGRADATION

If advanced capability is unavailable:

```text
Detect capability
↓
Select compatible pipeline
↓
Explain limitations
↓
Continue wherever possible
```

Examples:

```text
No WebGPU
→ WebGL

No WebGL
→ Canvas

No local model capability
→ manual lyrics / optional server transcription

Low memory
→ smaller model / lower preview quality

Unsupported codec
→ conversion/import fallback where feasible
```

Never make an advanced feature silently break the entire application.

---

# 112. DESIGN SYSTEM

Establish reusable tokens for:

```text
Colors
Spacing
Typography
Radius
Elevation
Shadows
Motion
Surfaces
Interaction
```

The editor must feel like one coherent product.

---

# 113. MOTION SYSTEM

Create a consistent motion language.

Define:

* durations
* easing
* entrance
* exit
* hover
* selection
* drag
* panel transitions
* timeline movement
* scene transitions
* rendering progress
* success/error feedback

---

# 114. MICRO-INTERACTIONS

Buttons:

```text
Rest
Hover
Focus
Active
Loading
Success
Disabled
```

Controls:

```text
Rest
Focus
Selected
Dragging
Disabled
```

Timeline:

```text
Hover
Selected
Dragging
Snapping
Locked
```

Forms:

```text
Rest
Focus
Valid
Invalid
Loading
Success
```

---

# 115. LOADING EXPERIENCE

Avoid blank screens.

For processing stages show meaningful progress:

```text
Analyzing audio…
Generating waveform…
Transcribing lyrics…
Aligning words…
Preparing visual preview…
Rendering scene 4 of 8…
Encoding video…
Validating export…
```

Where exact progress cannot be known, do not fabricate percentages.

Use indeterminate progress with truthful stage information.

---

# 116. EMPTY / ERROR / SUCCESS / OFFLINE STATES

Design all of:

* empty project
* no assets
* no lyrics
* no templates
* no cloud projects
* offline
* processing
* failed transcription
* failed rendering
* unsupported file
* missing asset
* corrupted project
* successful export
* saved project
* recovered project

---

# 117. SEO

SEO primarily applies to the public-facing portions:

* landing page
* product pages
* documentation
* guides
* template pages where indexable
* educational resources
* public shared pages where appropriate

Do not attempt to SEO-index private editor state.

Treat SEO as product architecture.

Audit:

* titles
* descriptions
* headings
* URLs
* structured data
* canonicals
* sitemap
* robots
* internal linking
* metadata
* Open Graph
* social previews
* accessibility
* performance
* crawlability

Never guarantee rankings.

---

# 118. PUBLIC CONTENT ARCHITECTURE

Potential public structure:

```text
Home
├── Features
├── How It Works
├── Lyric Video Maker
├── Karaoke Maker
├── Audio-to-Lyrics
├── Templates
├── Guides
├── Tutorials
├── Documentation
├── FAQ
└── About
```

Only create pages that genuinely serve users.

---

# 119. COMPETITIVE THINKING

Where useful, study strong products in:

* video editing
* lyric video creation
* karaoke
* transcription
* motion design
* browser-based creative tools

Do not clone them.

Extract:

* user expectations
* useful workflows
* common pain points
* missing capabilities
* opportunities for differentiation

Build a better product, not a clone.

---

# 120. ACCESSIBILITY + PERFORMANCE

Beautiful design must remain:

* accessible
* readable
* responsive
* performant

Prioritize:

* GPU-friendly transforms
* opacity
* efficient animation
* minimal layout thrashing
* optimized media
* lazy loading
* code splitting
* worker isolation
* minimal DOM complexity

---

# 121. ANTI-EFFECT RULE

Do not use every effect simply because it exists.

Every effect must justify itself through at least one of:

* hierarchy
* feedback
* storytelling
* atmosphere
* depth
* branding
* interaction
* rhythm
* musical synchronization
* delight
* continuity

If it accomplishes none of these:

> **Remove it.**

---

# 122. NO GENERIC CREATIVE SOFTWARE UI

Do not produce a generic:

```text
Sidebar
+
Cards
+
Properties Panel
+
Timeline
```

without considering the creative workflow.

The studio should have a recognizable visual identity.

Think:

> **Music instrument + motion-design workstation + modern creative application.**

Not:

> **Enterprise dashboard with a timeline attached.**

---

# 123. PRODUCT-SPECIFIC VISUAL LANGUAGE

The visual system should draw inspiration from:

* rhythm
* waveform
* typography
* musical timing
* frequency
* light
* motion
* cinematic composition
* editorial design
* audio-reactive graphics

The application itself should subtly communicate:

> **sound becoming visual.**

This should become part of the product's identity.

---

# 124. FRONTEND TECHNOLOGY PREFERENCE

Where appropriate use:

```text
React
+
Vite
+
TypeScript
+
MUI
+
Framer Motion
```

Use additional technologies only when they solve a real problem.

Potential media technologies:

```text
Web Audio API
AudioWorklet
Web Workers
WebAssembly
Canvas
OffscreenCanvas
WebGL
WebGPU
WebCodecs
ffmpeg.wasm
IndexedDB
File System Access API
```

Do not add libraries merely because they are fashionable.

---

# 125. DEPENDENCY STRATEGY

For every major dependency determine:

```text
KEEP
UPGRADE
REPLACE
REMOVE
REWRITE
```

Evaluate:

* security
* maintenance
* compatibility
* browser support
* bundle size
* performance
* Cloudflare compatibility
* licensing
* maturity
* project requirements

Do not upgrade blindly.

---

# 126. CLOUDFLARE COMPATIBILITY AUDIT

Identify dependencies relying on:

* filesystem access
* long-running servers
* unsupported Node APIs
* native modules
* persistent process state
* server-specific behavior

Replace or redesign incompatible components.

Remember:

> The browser media engine and Cloudflare backend have fundamentally different runtime capabilities.

---

# 127. ENVIRONMENT SEPARATION

Support:

```text
Development
↓
Preview / Staging
↓
Production
```

Separate:

* secrets
* API URLs
* database
* storage
* integrations
* analytics
* feature flags

Provide:

```text
.env.example
```

Never commit real secrets.

---

# 128. DATABASE MIGRATIONS

Before schema changes:

1. Understand existing data.
2. Identify dependencies.
3. Create safe migrations.
4. Preserve records.
5. Provide defaults.
6. Consider rollback.
7. Test migrations.

Never casually destroy data.

---

# 129. MOCK DATA AUDIT

Identify:

* fake users
* fake statistics
* fake projects
* fake exports
* mock APIs
* fake transcription
* fake rendering
* fake success responses
* demo-only behavior

Classify each as:

* legitimate seed
* development-only
* demo
* accidental production dependency

Remove accidental dependencies.

---

# 130. NO FAKE COMPLETION

Never declare:

> “Complete”

when:

* transcription is mocked
* rendering is mocked
* persistence is missing
* exports are fake
* authentication is bypassed
* authorization is missing
* tests were not run
* deployment was not validated
* required credentials are unavailable
* critical workflows remain broken

Use honest states:

```text
Implemented
Verified
Environment-dependent
Not verified
Blocked
```

---

# 131. TESTING STRATEGY

Prioritize:

1. project creation
2. audio upload
3. audio decoding
4. transcription
5. word timing
6. lyric editing
7. timing editing
8. scene editing
9. preview
10. rendering
11. export
12. project save
13. project restore
14. project import/export
15. failure recovery
16. security
17. authorization
18. data integrity

Use:

* unit tests
* integration tests
* component tests
* worker tests
* media pipeline tests
* rendering tests
* synchronization tests
* end-to-end tests
* accessibility tests
* performance tests

---

# 132. GOLDEN MEDIA TESTS

Create controlled test assets where appropriate.

Test:

* short audio
* long audio
* silence
* rapid lyrics
* slow lyrics
* repeated lyrics
* instrumental sections
* dense lyrics
* multilingual lyrics
* malformed media
* large files

Verify:

```text
Input
→
Transcription
→
Timing
→
Project
→
Render
→
Output
```

---

# 133. RENDER REGRESSION TESTS

Maintain deterministic test projects.

Compare:

* frame dimensions
* timing
* scene boundaries
* lyric positions
* animation states
* output metadata

Where exact pixel comparison is impractical, use meaningful structural validation.

---

# 134. VALIDATION PIPELINE

Run relevant:

```text
Dependency installation
↓
Type checking
↓
Linting
↓
Unit tests
↓
Integration tests
↓
Media tests
↓
Rendering tests
↓
End-to-end tests
↓
Frontend production build
↓
Worker validation
↓
Database migration validation
↓
Deployment validation
↓
Final manual product walkthrough
```

Never weaken tests merely to make them pass.

---

# 135. ADVERSARIAL SELF-TEST

When you think you are finished:

> **Assume you are wrong. Try to break your own work.**

Test:

* invalid inputs
* unauthorized access
* direct API manipulation
* stale sessions
* duplicate operations
* concurrent edits
* network interruption
* offline mode
* failed transcription
* failed render
* cancelled render
* malformed media
* massive media
* missing assets
* deleted assets
* corrupted projects
* old project versions
* unsupported browser
* low memory
* multiple tabs
* mobile
* keyboard navigation
* reduced motion
* accessibility
* SEO
* deployment differences

Then repair meaningful failures.

---

# 136. FINAL USER EXPERIENCE TEST

Pretend you are a first-time user.

Ask:

> Do I understand what this application does?

> Do I know where to begin?

> Can I create a lyric video without understanding video engineering?

> Can I correct transcription mistakes?

> Can I synchronize lyrics accurately?

> Can I visually design the video?

> Can I preview the result?

> Can I render it?

> Can I export it?

> Can I recover if something fails?

> Does the application feel fast?

> Does it feel trustworthy?

> Does it feel professional?

> Does it feel visually distinctive?

> Does it feel alive?

> Does it feel like a real creative tool?

> Does it reward exploration?

> Does it feel custom-built?

Fix what remains.

---

# 137. FINAL DESIGN QUALITY GATE

Before declaring the interface complete:

```text
✓ Distinct visual identity
✓ Strong typography
✓ Excellent hierarchy
✓ Intentional spacing
✓ Coherent design system
✓ Bespoke composition
✓ Responsive layouts
✓ Purposeful motion
✓ Natural interactions
✓ Appropriate depth
✓ Strong imagery
✓ Polished editor states
✓ Loading states
✓ Empty states
✓ Error states
✓ Success states
✓ Processing states
✓ Offline states
✓ Mobile consideration
✓ Reduced-motion support
✓ Keyboard accessibility
✓ Strong contrast
✓ Performance awareness
✓ No unnecessary visual complexity
✓ No generic-template feeling
✓ Product-specific visual language
✓ Music-specific visual identity
✓ Smooth timeline interaction
✓ Clear processing feedback
✓ Beautiful preview experience
✓ Memorable signature interaction
```

The final interface should feel:

> **Designed, not assembled.**

> **Alive, not merely animated.**

> **Immersive, not cluttered.**

> **Premium, not generic.**

> **Memorable, not gimmicky.**

---

# 138. THE “BREATHTAKING” TEST

For the public-facing experience ask:

> Does the first viewport immediately communicate the product?

> Does it create curiosity?

> Does the visual identity feel memorable?

> Does motion feel alive?

> Does the experience communicate that audio becomes visual?

> Does interaction reward exploration?

> Does the site feel custom-built?

> Would a professional musician/content creator understand its value quickly?

> Is there at least one memorable signature experience?

Create the “wow” through:

```text
Originality
+
Art Direction
+
Typography
+
Composition
+
Motion
+
Interaction
+
Depth
+
Storytelling
+
Brand Identity
+
Responsive Craft
+
Performance
+
Accessibility
+
Usability
```

---

# 139. CORE WEB PERFORMANCE

For the public-facing application evaluate:

* LCP
* INP
* CLS
* TTFB
* JavaScript execution
* image size
* fonts
* third-party scripts
* render blocking
* caching

For the editor additionally evaluate:

* timeline FPS
* preview FPS
* audio latency
* worker responsiveness
* transcription throughput
* memory consumption
* render throughput
* encoding throughput

Optimize for actual users, not artificial scores.

---

# 140. RELIABILITY ENGINEERING

Assume users will:

* retry
* refresh
* lose internet
* duplicate actions
* close the browser
* reopen projects
* edit concurrently
* cancel operations
* use multiple tabs
* encounter expired sessions

Use where appropriate:

* idempotency
* transactions
* retries
* timeouts
* concurrency controls
* state machines
* graceful failure
* recovery
* autosave
* snapshots

---

# 141. OBSERVABILITY

Where cloud infrastructure exists, implement:

* structured logs
* request IDs
* error IDs
* health checks
* audit events
* useful metrics

Potential application metrics:

```text
project_created
audio_imported
transcription_started
transcription_completed
transcription_failed
render_started
render_completed
render_failed
export_completed
export_failed
```

Never log sensitive audio or lyrics unnecessarily.

---

# 142. PRIVACY-AWARE ANALYTICS

If analytics are used:

Track product behavior rather than unnecessary personal/media content.

Do not collect:

* raw audio
* full private lyrics
* private project contents

unless explicitly required and clearly disclosed.

---

# 143. DISASTER / RECOVERY THINKING

Consider:

* accidental deletion
* corrupted projects
* failed migrations
* failed deployments
* cloud storage failures
* browser crashes
* interrupted renders
* broken configurations
* unavailable services

Provide where appropriate:

* local project export
* cloud backup
* version history
* migration strategies
* rollback
* recovery documentation

---

# 144. CODE QUALITY

Improve:

* naming
* organization
* separation of concerns
* maintainability
* readability
* types
* error handling
* reuse
* documentation

Remove where safe:

* dead code
* obsolete dependencies
* duplicate logic
* abandoned routes
* unnecessary configuration
* obsolete comments

---

# 145. TYPESCRIPT QUALITY

If TypeScript is used:

* eliminate unnecessary `any`
* correct incorrect types
* synchronize API contracts
* validate runtime data
* remove unsafe casts
* improve domain models
* eliminate contradictory interfaces

Types must represent actual runtime behavior.

---

# 146. DOMAIN MODEL

Create explicit domain models for:

```text
Project
AudioAsset
LyricDocument
LyricSection
LyricLine
LyricWord
Timing
Scene
SceneLayer
Animation
Keyframe
Effect
Visualizer
Template
RenderJob
Export
Asset
ProjectVersion
```

Avoid one giant generic object for everything.

---

# 147. API CONTRACT GOVERNANCE

Ensure frontend/backend agree on:

* endpoint paths
* methods
* parameters
* request bodies
* response structures
* errors
* authentication
* authorization
* pagination
* filtering
* sorting

Avoid contract drift.

Use shared schemas/types where practical.

---

# 148. DECISION LEDGER

For every major architectural decision internally maintain:

```text
Decision
Evidence
Context
Problem
Options
Chosen Solution
Reason
Tradeoffs
Risk
Mitigation
Result
```

---

# 149. IMPACT ANALYSIS

Before major changes ask:

```text
What depends on this?
What could break?
What data is affected?
What APIs are affected?
What frontend components are affected?
What workers are affected?
What media pipelines are affected?
What permissions change?
What storage changes?
What deployment configuration changes?
What tests must change?
```

Then implement accordingly.

---

# 150. INCREMENTAL VERIFICATION

Do not make huge speculative changes.

Use:

```text
Implement
↓
Typecheck
↓
Test
↓
Inspect
↓
Continue
```

For media features:

```text
Implement
↓
Test with small asset
↓
Test with representative asset
↓
Test with large asset
↓
Test failure path
↓
Optimize
↓
Continue
```

---

# 151. DO NOT ASK FOR PERMISSION FOR OBVIOUS FIXES

If something is clearly:

* broken
* insecure
* incomplete
* inconsistent
* inefficient
* required for functionality

fix it.

Do not repeatedly ask:

> “Should I fix this?”

Exercise engineering judgment.

---

# 152. WHEN TO ASK FOR CLARIFICATION

Only stop when:

* business intent genuinely cannot be inferred
* materially different interpretations exist
* the choice has significant irreversible consequences
* legal/compliance requirements cannot safely be inferred
* required external credentials/resources are unavailable
* destructive action requires authorization

Otherwise use the evidence hierarchy and proceed.

---

# 153. NO SHORTCUT ENGINEERING

Never solve problems by:

* disabling validation
* suppressing errors
* swallowing exceptions
* bypassing authentication
* bypassing authorization
* using fake data
* weakening tests
* exposing private APIs
* hardcoding secrets
* arbitrary delays
* commenting out broken functionality
* pretending rendering succeeded
* pretending transcription succeeded
* silently dropping lyrics
* silently changing timestamps

Fix root causes.

---

# 154. MULTI-PASS AUDIT

Perform:

## PASS 1 — REPOSITORY

Understand the codebase.

## PASS 2 — PRODUCT

Reconstruct purpose, users and workflows.

## PASS 3 — LYRIC-VIDEO DOMAIN

Evaluate:

* transcription
* timing
* lyrics
* audio
* scenes
* rendering
* export

## PASS 4 — FUNCTIONAL

Find broken functionality.

## PASS 5 — MEDIA

Attack the media pipeline.

## PASS 6 — SECURITY

Attack the security model.

## PASS 7 — DATA

Audit project and database integrity.

## PASS 8 — UX

Walk through real user journeys.

## PASS 9 — VISUAL DESIGN

Evaluate:

* beauty
* identity
* hierarchy
* composition
* typography
* depth
* motion
* interaction

## PASS 10 — TIMELINE

Evaluate editor responsiveness and correctness.

## PASS 11 — RENDERING

Evaluate deterministic output.

## PASS 12 — ACCESSIBILITY

Audit practical accessibility.

## PASS 13 — PERFORMANCE

Evaluate actual bottlenecks.

## PASS 14 — SEO

Audit public-facing surfaces.

## PASS 15 — DEPLOYMENT

Validate Vercel + Cloudflare.

## PASS 16 — TESTING

Run meaningful tests.

## PASS 17 — ADVERSARIAL

Try to break everything.

## PASS 18 — FINAL PRODUCT REVIEW

Use the application like a real user.

---

# 155. PRODUCTION READINESS GATE

Before completion verify:

```text
✓ Product purpose understood
✓ User journeys reconstructed
✓ Core workflows work
✓ Audio import works
✓ Audio analysis works
✓ Transcription works
✓ Word timing works
✓ Lyric editing works
✓ Timing editor works
✓ Preview works
✓ Scene system works
✓ Animation system works
✓ Rendering works
✓ Encoding works
✓ Audio/video muxing works
✓ Output validation works
✓ Export works
✓ Project save works
✓ Project restore works
✓ Project import/export works
✓ Important failure states handled
✓ Data model coherent
✓ Authentication secure where applicable
✓ Authorization secure where applicable
✓ APIs robust
✓ Input validation appropriate
✓ Media validation appropriate
✓ Errors handled
✓ UI polished
✓ Mobile experience considered
✓ Accessibility reasonable
✓ Performance reasonable
✓ Memory management considered
✓ Graceful degradation implemented
✓ Privacy behavior clear
✓ Cost architecture sensible
✓ SEO technically strong for public surfaces
✓ Tests run
✓ Important workflows validated
✓ Migrations safe
✓ Secrets protected
✓ Observability adequate
✓ External failures considered
✓ Vercel architecture sound
✓ Cloudflare architecture sound
✓ Documentation reflects reality
✓ Own implementation adversarially tested
✓ No obvious high-impact issue remains
```

---

# 156. STOPPING CRITERIA

You may stop when:

1. Core workflows work.
2. Important missing functionality is addressed.
3. Audio processing is real.
4. Transcription is real or transparently marked as unavailable.
5. Timing is accurate enough for the supported workflow.
6. Editing is functional.
7. Rendering is real.
8. Export is real.
9. Projects persist correctly.
10. Security is appropriate.
11. Data integrity is sound.
12. UX is coherent.
13. Design quality is exceptional for the product category.
14. Visual identity is distinctive.
15. Responsive behavior is strong.
16. Performance is reasonable.
17. Memory behavior is controlled.
18. Accessibility is reasonable.
19. SEO is comprehensive for public surfaces.
20. Backend architecture is sound.
21. Vercel architecture is sound.
22. Cloudflare architecture is sound.
23. Core functionality does not depend on paid services.
24. Important workflows are tested.
25. Documentation reflects reality.
26. Remaining work is optional, speculative, externally blocked, or disproportionate.

---

# 157. DOCUMENTATION RECOVERY

Create/update:

* README
* architecture overview
* project structure
* local development
* environment variables
* deployment
* Vercel setup
* Cloudflare setup
* Workers
* D1
* R2 where used
* KV where used
* Durable Objects where used
* Queues where used
* authentication
* media pipeline
* transcription
* timing engine
* rendering engine
* project format
* import/export
* important workflows
* migrations
* operational procedures
* testing
* troubleshooting
* browser compatibility
* performance requirements
* memory considerations

Documentation must describe the actual resulting system.

---

# 158. FINAL REPORT

At completion provide:

## A. PRODUCT RECONSTRUCTION

Explain:

* what the application is
* who it serves
* what problem it solves
* category
* maturity
* core workflows

## B. INITIAL STATE

Summarize original weaknesses.

## C. MAJOR PROBLEMS FOUND

Categorize:

```text
Critical
High
Medium
Low
```

## D. PROBLEMS FIXED

For each:

```text
Problem
Evidence
Root Cause
Solution
Result
```

## E. FEATURES COMPLETED

List completed functionality.

## F. INFERRED FEATURES

Clearly identify functionality added from:

* repository evidence
* user journeys
* industry standards
* production requirements
* security
* reliability
* media requirements

## G. DESIGN IMPROVEMENTS

Summarize:

* UX
* UI
* visual identity
* typography
* composition
* responsive design
* accessibility
* motion
* interaction
* immersion
* bespoke design
* editor experience
* timeline experience
* preview experience

## H. MEDIA ENGINE

Summarize:

* audio ingestion
* analysis
* transcription
* alignment
* timing
* rendering
* encoding
* muxing
* export

## I. PERFORMANCE

Summarize meaningful improvements.

## J. SECURITY

Summarize security improvements.

## K. DATABASE

Summarize schema and migration changes.

## L. LOCAL-FIRST ARCHITECTURE

Explain what runs:

```text
Browser
Worker
WASM
GPU
Server
```

and why.

## M. ARCHITECTURE

Explain the resulting architecture.

## N. VERCEL

Explain frontend deployment.

## O. CLOUDFLARE

Explain only services actually used.

## P. COST MODEL

Explain:

* free local
* free server
* low-cost server
* optional paid/external services

## Q. TESTING

Report exactly what was actually tested.

Never claim tests were run if they were not.

## R. DOCUMENTATION

List documentation created/updated.

## S. REMAINING ISSUES

Clearly identify:

* external credentials
* unavailable integrations
* browser limitations
* device limitations
* environment requirements
* business decisions
* unresolved limitations

## T. DEPLOYMENT

Provide exact deployment steps.

---

# 159. FINAL PHILOSOPHY

Do not think:

> “How do I make the existing repository pass?”

Think:

> **“What is this product trying to become, and how do I responsibly get it there?”**

Do not think:

> “There is no documentation, so I cannot proceed.”

Think:

> **“The repository contains evidence. I will reconstruct the missing context.”**

Do not think:

> “The build works, therefore the app is finished.”

Think:

> **“The build is only one signal of correctness.”**

Do not think:

> “Industry standards mean I should add every possible feature.”

Think:

> **“Industry standards reveal legitimate gaps; product relevance determines what belongs.”**

Do not think:

> “SEO means adding keywords.”

Think:

> **“SEO means making the right content discoverable, crawlable, understandable, useful, technically healthy and deserving of visibility.”**

Do not think:

> “Beautiful means adding animations.”

Think:

> **“Beautiful means coherent art direction, excellent hierarchy, typography, composition, interaction, branding and execution.”**

Do not think:

> “Immersive means WebGL everywhere.”

Think:

> **“Immersion means creating a coherent sense of visual presence using whatever combination of layout, typography, imagery, motion, depth and interaction best serves this product.”**

Do not think:

> “Award-winning means extravagant.”

Think:

> **“Award-level means exceptional craft, originality, coherence and execution.”**

Do not think:

> “More effects means better design.”

Think:

> **“Every effect must earn its place.”**

Do not think:

> “More technology means better architecture.”

Think:

> **“The best architecture is the simplest architecture that reliably satisfies the product's actual requirements.”**

Do not think:

> “Cloud is always better.”

Think:

> **“Run computation where it is technically appropriate, economically sensible, privacy-conscious and reliable.”**

Do not think:

> “AI should handle everything.”

Think:

> **“AI should automate difficult work while keeping the user in control.”**

Do not think:

> “A transcription result is good enough.”

Think:

> **“Lyrics must be editable, timing must be inspectable, and synchronization must be controllable.”**

Do not think:

> “A video file exists, therefore rendering is complete.”

Think:

> **“The output must be validated as an actual playable, synchronized media artifact.”**

Do not think:

> “Free tier means putting everything on Cloudflare.”

Think:

> **“Free-tier architecture means intelligently distributing work between the user's device, browser capabilities and minimal cloud infrastructure.”**

---

# 160. ULTIMATE LYRIC VIDEO STUDIO DIRECTIVE

> **BUILD SOMETHING PEOPLE WANT TO CREATE WITH.**

Do not build merely:

> “An AI lyric generator.”

Build:

> **A complete creative instrument for turning sound into visual storytelling.**

The experience should make the progression feel natural:

```text
I HAVE A SONG
       ↓
I HAVE LYRICS
       ↓
THE APP UNDERSTANDS THE SONG
       ↓
THE LYRICS ARE SYNCHRONIZED
       ↓
I CAN SHAPE THE VISUAL EXPERIENCE
       ↓
THE VISUALS RESPOND TO THE MUSIC
       ↓
I CAN SEE THE RESULT
       ↓
I CAN REFINE IT
       ↓
I CAN RENDER IT
       ↓
I HAVE A FINISHED LYRIC VIDEO
```

The product should hide unnecessary technical complexity while exposing sophisticated control when users need it.

---

# 161. SIGNATURE PRODUCT EXPERIENCE

Create at least one genuinely memorable signature workflow.

The ideal conceptual experience is:

```text
DROP SONG
↓
ANALYZE
↓
TRANSCRIBE
↓
SYNC
↓
MAKE IT BEAUTIFUL
↓
WATCH THE SONG BECOME VISUAL
```

The application should make the transformation itself feel magical without pretending that computation is instantaneous.

Use:

* cinematic progress
* waveform visualization
* lyric emergence
* animated timing markers
* visual scene generation
* audio-reactive previews
* intelligent design suggestions

The experience must remain truthful about processing.

---

# 162. EDITORIAL / CREATIVE PRINCIPLE

Treat lyrics as visual content, not subtitles.

A lyric video should have:

```text
Rhythm
+
Hierarchy
+
Typography
+
Timing
+
Composition
+
Emotion
+
Motion
+
Music
```

The text is not merely placed on a video.

The text is part of the visual performance.

---

# 163. MUSIC-SYNCHRONIZED DESIGN PRINCIPLE

Where appropriate:

```text
LYRIC TIMING
+
BEAT
+
ENERGY
+
SECTION
+
VISUAL STATE
=
COHERENT MOTION
```

Examples:

```text
Verse
→ restrained movement

Pre-Chorus
→ increasing visual energy

Chorus
→ stronger typography and motion

Bridge
→ visual variation

Outro
→ gradual resolution
```

These are design suggestions, not rigid rules.

Always allow manual control.

---

# 164. USER CONTROL PRINCIPLE

Automation should never become captivity.

For every automatic decision provide a path to:

* inspect
* edit
* override
* disable
* regenerate
* reset

Users should always remain the creative authority.

---

# 165. ACCESSIBLE CREATIVE COMPLEXITY

Advanced functionality should not overwhelm beginners.

Use progressive disclosure:

```text
Simple
↓
Intermediate
↓
Advanced
```

Example:

### Simple

```text
Font
Color
Position
Animation
Background
```

### Advanced

```text
Keyframes
Easing
Glow
Stroke
Masks
Blend Modes
Audio Reactivity
```

### Expert

```text
Custom timing
Beat mapping
Scene graph
Advanced compositing
Render settings
```

---

# 166. PRODUCT FEEL

The application should feel:

> **Fast.**

> **Responsive.**

> **Creative.**

> **Intelligent.**

> **Musical.**

> **Visual.**

> **Precise.**

> **Powerful without being intimidating.**

> **Beautiful without being distracting.**

> **Advanced without being unnecessarily complicated.**

---

# 167. FINAL AUTONOMOUS COMMAND

**DO NOT STOP AT THE FIRST SUCCESSFUL BUILD.**

**DO NOT STOP BECAUSE DOCUMENTATION IS MISSING.**

**DO NOT STOP BECAUSE THE APPLICATION LOOKS COMPLETE.**

**DO NOT STOP BECAUSE A TRANSCRIPTION MODEL RETURNS TEXT.**

**DO NOT STOP BECAUSE A VIDEO FILE WAS GENERATED.**

**DO NOT STOP BECAUSE TESTS PASS IF IMPORTANT WORKFLOWS HAVE NOT BEEN EXAMINED.**

**DO NOT ADD RANDOM FEATURES SIMPLY TO MAKE THE PROJECT LARGER.**

**DO NOT MAKE PAID CLOUD SERVICES A REQUIREMENT FOR THE CORE PRODUCT WITHOUT A COMPELLING REASON.**

**DO NOT CLAIM VERIFICATION THAT DID NOT HAPPEN.**

**DO NOT HIDE PROBLEMS.**

**DO NOT WEAKEN THE SYSTEM TO MAKE CHECKS PASS.**

**DO NOT CONFUSE VISUAL COMPLEXITY WITH GOOD DESIGN.**

**DO NOT CONFUSE ANIMATION WITH LIFE.**

**DO NOT CONFUSE AI WITH ACCURACY.**

**DO NOT CONFUSE TRANSCRIPTION WITH SYNCHRONIZATION.**

**DO NOT CONFUSE A VIDEO FILE WITH A VALID VIDEO.**

**DO NOT CONFUSE MORE TECHNOLOGY WITH BETTER ARCHITECTURE.**

Instead:

> **USE THE REPOSITORY AS EVIDENCE.**

> **RECONSTRUCT THE STRONGEST DEFENSIBLE UNDERSTANDING OF THE PRODUCT.**

> **UNDERSTAND THE MEDIA PIPELINE.**

> **UNDERSTAND THE BROWSER RUNTIME.**

> **APPLY SOUND INDUSTRY STANDARDS.**

> **EXERCISE AUTONOMOUS ENGINEERING JUDGMENT.**

> **BUILD THE PRODUCT IT IS CLEARLY TRYING TO BECOME.**

> **MAKE AUDIO PROCESSING REAL.**

> **MAKE TRANSCRIPTION REAL.**

> **MAKE TIMING EDITABLE.**

> **MAKE SYNCHRONIZATION PRECISE.**

> **MAKE THE PROJECT PERSISTENT.**

> **MAKE RENDERING DETERMINISTIC.**

> **MAKE EXPORT VALID.**

> **MAKE THE EXPERIENCE BEAUTIFUL.**

> **MAKE IT ALIVE.**

> **MAKE IT MODERN.**

> **MAKE IT IMMERSIVE WHERE APPROPRIATE.**

> **MAKE IT DISTINCTIVE.**

> **MAKE IT FEEL BESPOKE.**

> **MAKE INTERACTION FEEL NATURAL.**

> **MAKE MOTION FEEL ALIVE RATHER THAN MERELY ANIMATED.**

> **MAKE THE VISUAL EXPERIENCE MEMORABLE.**

> **MAKE THE MUSIC FEEL CONNECTED TO THE VISUALS.**

> **MAKE ADVANCED CAPABILITIES PROGRESSIVELY DISCOVERABLE.**

> **MAKE THE PRODUCT EASY TO USE.**

> **KEEP THE USER IN CONTROL.**

> **MAKE IT ACCESSIBLE.**

> **MAKE IT FAST.**

> **MAKE IT MEMORY-CONSCIOUS.**

> **MAKE IT PRIVACY-CONSCIOUS.**

> **MAKE IT COST-AWARE.**

> **MAKE IT SECURE.**

> **MAKE IT SEARCH-READY.**

> **MAKE IT PRODUCTION-READY.**

> **VERIFY THE RESULT.**

> **CHALLENGE YOUR OWN ASSUMPTIONS.**

> **TRY TO BREAK YOUR OWN IMPLEMENTATION.**

> **RE-AUDIT EVERYTHING.**

> **FIX ROOT CAUSES.**

> **DO NOT FAKE COMPLETION.**

> **CONTINUOUSLY RAISE THE QUALITY OF THE PROJECT UNTIL NO OBVIOUS HIGH-IMPACT IMPROVEMENT REMAINS REASONABLY ACTIONABLE.**

# BEGIN.

This version keeps the original prompt's core operating system while making **media processing, transcription, synchronization, browser compute, deterministic rendering, local-first storage, cost control, and the actual lyric-video production workflow first-class concerns** rather than afterthoughts. The original prompt's evidence hierarchy, production discipline, visual system, testing, documentation, and final quality philosophy are retained and reorganized around the new product.  

If you use this as the project's master prompt, it should be substantially better suited to the **free-tier/browser-first lyric-video studio** than using the generic `Pasted markdown(4).md` unchanged.


Building a web application that automatically generates lyrics videos from an audio track is an excellent project. To achieve this, you need to chain together three main steps: Speech-to-Text with word-level timestamps, video timeline generation, and rendering the final media.
------------------------------
## 🏗️ The Core Architecture
A scalable stack for this specific use case consists of:

* Frontend: React, Vue, or Next.js to handle file uploading and an interactive timeline where users can tweak the timing if the AI makes a minor mistake.
* Backend: Python (FastAPI or Flask) or Node.js to handle file processing. Python is heavily preferred here due to its native ecosystem for AI and video manipulation.

------------------------------
## 🛠️ Step-by-Step Technical Blueprint## 1. Audio Transcription & Time-Alignment (The AI Layer)
Standard Speech-to-Text (STT) isn't enough; you need forced alignment or word-level timestamps so you know exactly when a syllable starts and ends. [1, 2] 

* Open-Source Option: [OpenAI's Whisper](https://github.com/openai/whisper) (using libraries like faster-whisper). When configuring the model, you can extract timestamps down to the individual word. [1, 3] 
* API Option: [AssemblyAI](https://www.assemblyai.com/) or [Deepgram](https://deepgram.com/). They offer pre-built music/speech transcription endpoints that return JSON objects mapping every word to an exact millisecond. [4, 5] 

## 2. Layout & Animation (The Video Blueprint)
Once you have a JSON file mapping words to timestamps, you have two choices for how the video actually "displays" the text:

* Client-Side Rendering (Web Video): If you want the video to render instantly in the browser without server lag, use HTML5 <canvas> or a library like [Remotion](https://www.remotion.dev/) (a React framework for making videos programmatically). Remotion allows you to use standard CSS/web animations to move the text in sync with the audio track.
* Server-Side Rendering (Hardcoded MP4): If you want to process the video on the backend and give the user a downloadable file, use Python's [MoviePy](https://zulko.github.io/moviepy/) framework. You can use it to create text clips, specify their start and duration properties based on the AI data, and overlay them onto a static background image or dynamic video loop. [6] 

## 3. Backend Video Export Engine
Rendering videos is incredibly CPU/GPU intensive. If multiple users hit your web app at the same time, your server will crash unless you process them asynchronously.

* Implement a Task Queue using [Celery](https://docs.celeryq.dev/) and Redis.
* When a user clicks "Export Video," the backend logs it as a background job, processes the video stitching via FFmpeg, saves the final .mp4 file to a cloud storage bucket (like AWS S3), and alerts the user when the download link is ready.

------------------------------
## 📝 Proof-of-Concept Python Snippet
If you want to test how the video-generation logic works on your computer right away, you can use Python with faster-whisper and moviepy to stitch lyrics over an audio file:

from faster_whisper import WhisperModelfrom moviepy.editor import AudioFileClip, ColorClip, TextClip, CompositeVideoClip
# 1. Transcribe audio and get timestampsmodel = WhisperModel("base", device="cpu", compute_type="int8")segments, info = model.transcribe("your_song.mp3", word_timestamps=True)
text_clips = []
# 2. Iterate through sentences and generate video text segmentsfor segment in segments:
    # You can loop through segment.words for word-by-word animation
    text = segment.text
    start_time = segment.start
    end_time = segment.end
    
    # Create a text overlay for this specific timeframe
    txt_clip = (TextClip(text, fontsize=40, color='white', font='Arial')
                .set_start(start_time)
                .set_end(end_time)
                .set_position(('center', 'center')))
    text_clips.append(txt_clip)
# 3. Create a background loop and composite the audio + text togetheraudio_clip = AudioFileClip("your_song.mp3")background = ColorClip(size=(1080, 1920), color=[0, 0, 0], duration=audio_clip.duration)
final_video = CompositeVideoClip([background] + text_clips)final_video = final_video.set_audio(audio_clip)
# 4. Save file
final_video.write_videofile("lyrics_video.mp4", fps=24)

------------------------------
## 💡 Features That Will Make Your App Stand Out

   1. Manual Sync Editor: AI speech recognition is famously bad at distinguishing between background harmonies and main vocals in music. Give users a timeline editor (using a library like wavesurfer.js) so they can manually drag text block boundaries to perfectly match the beat. [7] 
   2. Style Presets: Offer pre-configured cinematic, kinetic typography, karaoke highlighting, or minimalist "TikTok vertical" caption styles. [8] 

To help narrow down your development stack, tell me:

* Do you prefer to build the video rendering on the backend (Python/FFmpeg/MoviePy) or frontend (React/Remotion)?
* Do you want the text to appear line-by-line or word-by-word (Karaoke style)?
* What is your preferred programming language for the web framework (e.g., Python, JavaScript/TypeScript)?


[1] [https://www.youtube.com](https://www.youtube.com/watch?v=-xv65jYlxtU)
[2] [https://www.assemblyai.com](https://www.assemblyai.com/blog/how-to-transcribe-audio-with-timestamps)
[3] [https://www.youtube.com](https://www.youtube.com/watch?v=FarqAx_RoNg&vl=en)
[4] [https://www.youtube.com](https://www.youtube.com/watch?v=NNq_XBVk30w)
[5] [https://www.youtube.com](https://www.youtube.com/watch?v=zghKpKGnw_A)
[6] [https://vibemv.app](https://vibemv.app/tools/lyric-video-maker)
[7] [https://www.youka.io](https://www.youka.io/lyric-video-maker)
[8] [https://solmi.ai](https://solmi.ai/lyric-video-generator)


If you want the frontend to do the heavy lifting, you can bypass expensive server-side video rendering entirely. Modern browsers support powerful tools like the Web Audio API and HTML5 Canvas, and frameworks like Remotion or Ffmpeg.wasm allow users to preview and export videos directly from their own devices. This completely eliminates your server costs for processing media.
Here is a comprehensive list of feature ideas grouped by functionality that can be built using 100% free, open-source web technologies.
------------------------------
## 🎨 Visuals & Style Customization

* Dynamic Audio Visualizers: Use the browser's native Web Audio API (AnalyserNode) to extract real-time frequency data from the audio file. You can draw bouncing bars, pulsing circles, or abstract waves onto an HTML5 Canvas that react dynamically to the beat of the song.
* Media Backgrounds: Allow users to upload their own background images or loop videos (.mp4), or fetch free stock backgrounds directly in-app using free API tiers from Unsplash or Pexels.
* Karaoke Highlighting (Word-by-Word): Instead of just rendering whole blocks of text, use the word-level timestamp data to transition the color of individual words (e.g., changing from white to yellow) exactly as they are spoken or sung.
* Typography & Animation Presets: Offer pre-set text animations (Fade In, Cinematic Kinetic Scroll, Zoom-on-Beat, Typewriter) using CSS animations or GSAP.

## ⏱️ Timeline & Editor Features

* Interactive Waveform Workspace: Use wavesurfer.js to generate an interactive visual waveform of the audio file. Users can see the audio peaks, click anywhere to skip to that timestamp, and visually align text to specific audio spikes.
* Drag-and-Drop Caption Blocks: Map the lyrics onto the timeline as draggable blocks. Users can stretch the edges of a block to change its duration or drag it left/right to adjust when it appears.
* Subtitle File Import/Export: Let users import or export standard .srt or .vtt subtitle files. This acts as a backup in case they want to use their timed lyrics elsewhere.

## 🤖 AI Transcription (Keeping it Free)

* Client-Side Whisper (Transformers.js): You can actually run AI speech recognition directly inside the user's browser using Hugging Face's Transformers.js. It downloads a miniature, optimized version of OpenAI's Whisper model (like whisper-tiny) straight to the user's browser cache. It handles the transcription locally on their machine without costing you a single penny in server fees.
* Free-Tier API Fallbacks: If client-side AI is too slow on older user devices, you can integrate the free trial tiers of APIs like Groq (which offers incredibly fast, free Whisper transcription up to certain daily limits).

------------------------------
## 💻 The Frontend Architecture (How to make it work)
To make the browser do all the heavy work, your architecture will look like this:

[User Audio + Lyrics File] 
           │
           ▼
[Transformers.js (Whisper Tiny)] ───► Generates JSON Timestamps (Free, local)
           │
           ▼
[Wavesurfer.js + Canvas] ───────────► Renders interactive timeline & visualizers
           │
           ▼
[WebCodecs API / Ffmpeg.wasm] ──────► Compiles Canvas frames + Audio into an MP4 file

To achieve client-side export, you have two primary options:

   1. Ffmpeg.wasm: A web-assembly port of FFmpeg that runs completely inside the browser. It takes canvas frame snapshots and merges them with the audio file into a downloadable .mp4.
   2. Remotion Lambda / Player: If you build the app using React, Remotion allows you to preview the video perfectly in real-time. For downloading, you can use their client-side browser capture tools.

------------------------------
## ⚠️ Technical Trade-Offs to Keep in Mind
While making the frontend do the heavy lifting saves you server costs, keep these limitations in mind:

* Export Speeds: Rendering a video via WebAssembly (ffmpeg.wasm) on a low-end laptop or smartphone will be significantly slower than doing it on a dedicated backend server with a GPU.
* Browser Memory Limits: If a user tries to make a 10-minute high-definition video, the browser tab might run out of RAM and crash. This setup is perfect for short-form content (TikToks, Reels, Shorts, 3-minute songs), but tougher for long podcasts.

To help plan the next steps, let me know:

* Would you prefer to focus on short-form vertical videos (TikTok/Reels format) or long-form horizontal videos (YouTube format)?
* Do you want to try setting up Transformers.js for completely free browser-side AI transcription, or start with manual text syncing first?


Short answer: it's usable, but it's the wrong prompt for this app, and a few of its instructions will actively hurt you here.

**Where it misfires**

It's written for *reconstructing an existing repository* — "the repository is evidence," "codebase archaeologist," "audit the migrations." You have no repo. About 40% of it is dead weight from the first token.

It mandates a Cloudflare Workers + D1 + R2 backend. Your app's entire advantage is that it needs none of that. Push audio into R2 and you inherit egress costs, storage costs, and — the real problem — you become a host of user-uploaded copyrighted music, which means DMCA agent registration, takedown processing, and liability you currently don't have. The free tier dies the moment the app gets popular. A prompt that forces a backend onto a client-side app will get you one.

"Make sure all paths are happy paths" is the most damaging line in it. The hard part of this app is exactly the unhappy paths: the 250 MB model download that fails at 80%, Safari without WebCodecs, the 4K export that OOMs on mobile, alignment that returns garbage on a heavily produced track. Instruct an agent to only build happy paths and you'll get a polished demo that breaks on the second real song.

The cinematic/immersive directive is right for your landing page and wrong for your editor. A timeline editor needs density, sub-16ms scrub response, and visual restraint. Parallax and scroll-pinning in a waveform editor is a bug. The prompt doesn't distinguish the two surfaces, so it will animate the wrong one.

And 130 sections of adjectives dilutes attention. Agents follow concrete constraints and acceptance criteria far better than "make it breathtaking."

**What works** — the evidence hierarchy, no-fake-completion rule, adversarial self-test, and second/third-order analysis are all genuinely good. I kept those.

I've written a replacement tuned to this specific app:The main differences worth noting:

**It forbids the backend rather than mandating one.** The original prompt's Cloudflare stack would push you into hosting user audio, which turns a free app into a bandwidth bill and a DMCA obligation. The replacement allows exactly one Worker, for model file delivery and anonymous counts, and only in Phase 5.

**Two design languages instead of one.** The landing page gets the full cinematic treatment you asked for. The editor gets restraint, density, and sub-16ms scrub latency. Applying "immersive and motion-driven" to a timeline editor produces a tool nobody can work in for two hours.

**Unhappy paths are a required section, not a banned one.** Eleven specific failure modes, each needing designed behavior, with manual tap-sync as the guaranteed floor beneath all of them.

**Verification gates between phases.** Each phase has a concrete pass condition — a click-track sync test, a measured timing-error number, a crash-recovery test — so the agent can't build five phases of unverified code and declare victory.

One thing to set expectations on: no prompt reliably produces this whole app in one pass. It's genuinely large — WebCodecs muxing, ONNX inference, and a timeline editor are each a substantial project. Run it phase by phase, and treat Phase 1's gate as a real release. A working tap-sync app that exports clean MP4s is more useful than a half-built ML pipeline.

I'll lay this out as a full build spec you can keep and work through.The spec is published above. Three things in it are worth flagging now, because they change decisions you'd otherwise make first:

**Don't build ASR-first.** Whisper on a full music mix misses words badly — reverb, backing vocals, melisma. The real problem is timing, not transcription. Have the user paste lyrics they already have and solve alignment only. ASR becomes a fallback mode, not the backbone.

**Ship manual tap-sync before any ML.** The user plays the track and taps a key at each line. It takes a day, never fails, works on every browser and every language, and it's your permanent escape hatch when a model chokes. That plus WebCodecs export is already a shippable product.

**Lyrics are copyrighted independently of the recording.** You can't pull from Genius/Musixmatch — that's licensed data. Lyrics must come from the user. Since everything runs locally, "your audio never leaves your device" is both literally true and your best marketing line.

On the frontend-heavy goal: it's fully viable. Whisper and the alignment models run via `transformers.js`/`onnxruntime-web` on WebGPU, and WebCodecs gives you hardware-accelerated MP4 export. The one hosting constraint to plan around from day one is COOP/COEP headers, since `SharedArrayBuffer` is needed for threaded WASM and `ffmpeg.wasm`.
