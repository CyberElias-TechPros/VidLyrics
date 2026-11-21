# VidLyrics: an integrated video production studio

**Product decision: three peer creation workflows, one shared project.** Script → narrated video, song → editable lyric video, and code/template → motion composition are independent entry points. None requires another workflow’s input. The ten modules below serve these paths; build order reflects engineering dependencies, not product rank.

This is a proposal against `18f27fe`, not a list of shipped features. The [100-candidate decision register](integration-register.md) gives every candidate a destination and decision: 6 keep, 8 pilot, 37 study only and 49 defer. Of the eight pilots, librosa and PyAV belong in evaluation tooling; none of the eight requires a new dependency in the initial web bundle.

## The ten studios are workspaces, not ten applications

Paths below `apps/web/src/` are relative to that directory. Keep one project, timeline, media clock and undo history. Studio names in the register are shorthand for these workspaces.

| Studio | Current seam in this checkout | Next user-visible change |
|---|---|---|
| Song Intelligence | `media/audio/decode.ts`, `core/audio/{peaks,spectrum,beats}.ts`, `media/session.ts`: decoded PCM, spectral flux, BPM/grid and confidence | Show energy spans and suggested section boundaries; let the user accept or move them. Loudness is not mood, and a quiet passage is not proof of absent vocals. |
| Lyric Intelligence | `media/workers/transcribe.worker.ts`, `core/lyrics/transcript.ts`, `core/timing/`: local Whisper segment cues, word distribution and matching utilities | Review uncertain words in audio order; distinguish measured, estimated and human timing. Segment timestamps alone are not vocal forced alignment. |
| Typography | `core/render/{layout,blocks,frame}.ts`, `core/types.ts`: wrapping, tracking, word/progressive karaoke | Preview type treatments on the actual longest lyric and test complex scripts before offering custom font embedding. |
| Visual World | `core/render/scene.ts`, `core/spec/schema.ts`: mesh, gradients and image backgrounds | Ship original 2D treatments first. Make generated artwork or one lazy-loaded 3D world optional, with an image/gradient fallback. |
| Director | `core/spec/{templates,compiler}.ts`, `ui/editor/CodePanel.tsx`: validated declarative specs and templates | Suggest a style per section as a diff. Do not reimport a whole spec over manually timed lyrics. |
| Timeline | `ui/editor/Timeline.tsx`, `state/store.ts`, `core/project/history.ts`: waveform, beat grid, selection and history | Jump to next uncertainty, audition a phrase, drag/nudge boundaries, lock, undo and re-open. Add tracks only after stable clip IDs and migrations exist. |
| Reactive | `core/audio/spectrum.ts`, `ui/editor/Preview.tsx`, `media/session.ts`: time-indexed audio features available to rendering | Let energy drive a bounded glow or camera amplitude, with a reduced-motion/off switch. Scrubbing and export must sample identical values. |
| FX | `core/render/{easing,scene,frame}.ts`, `core/types.ts`: scene enters/exits and transitions | Add section-level intensity envelopes, not a separate animation loop. Keep text contrast and avoid strobing. |
| Render | `media/export/encoder.ts`, `media/capability.ts`, `core/export/subtitles.ts`: WebCodecs, MP4 muxing and subtitle output | Preflight exact settings and audio inclusion. Explain separate-WAV fallback; never label silent video as a successful audio mux. |
| Presets | `core/design/tokens.ts`, `core/spec/templates.ts`: themes and reusable scene specs | Version named treatments by palette, typography, motion and transition together. Store resolved settings so old projects do not change when presets evolve. |

**Cross-cutting: recovery and QA.** Extend `storage/{projectRepo,idb,tabLock}.ts` and `core/project/{schema,migrate}.ts`; keep derived analysis disposable, accepted edits persistent and original assets relinkable. Extend `apps/web/tests/`, `e2e/` and `release-tests/`. The Cloudflare `worker/src/router.ts` is a lightweight edge API, not a Python, GPU or native encoding host.

## What to borrow from the closest products

Three of the opening ten are **additional** to the numbered register. Their READMEs describe these workflows; this is a design comparison, not a claim that we ran them:

- [UseSuno MV Studio](https://github.com/UseSuno/UseSunoMVStudio#readme): separate phrase timing from animation/background selection. Compare the number of actions needed to correct a chorus and save a portable project. Study the interaction; do not copy its AGPL templates, bundled sources or demo assets.
- [Phrasync](https://github.com/jaydemks/phrasync#readme): compare cue correction against the waveform, then preview 2D/3D choices **without changing cues**. Borrow the preflight idea (missing fonts/assets, export range); don't import its native application architecture.
- [Music Video Maker](https://github.com/damdavid/music-video-maker#readme): use an editable per-section plan. Regenerating the bridge should not change a manually styled chorus. Retain an abstract visual fallback when no generated image exists.

For the other seven: study Remotion’s frame-addressed composition (#58), OpenCut’s timeline (#72) and WaveSurfer’s handles (#71); pilot FFmpeg (#56), WhisperX (#12), Demucs (#28) and Three.js (#41) **at different gates**, not together.

## Entry-to-delivery contracts

| Main workflow | Create → revise → finish | Recovery requirement |
|---|---|---|
| Script or storyboard → narrated video | Paste prose or validated JSON → build scenes → generate local Piper speech → time to synthesized durations → review spoken vs displayed copy → restyle → MP4 + editable project. | Invalid JSON preserves the draft and prior timeline. If synthesis fails, keep scenes editable and offer retry; after a text edit flag stale speech rather than exporting it unnoticed. |
| Song → editable lyric video | Import master → transcribe or import timed text → correct timing against the waveform → apply type, section and reactive treatments → preview → MP4, subtitles + editable project. | Preserve original audio and locked words. Missing master should request exact relink, not discard the project. |
| Code or template → motion composition | Choose a template or author a spec → validate → compile → adjust scenes, images, typography and transitions → preview → export silent or narrated MP4 and reusable spec. | Invalid edits must not replace the last valid composition. Distinguish a saved spec from project media; reopen and resolve asset references before final export. |

### Module completion checklist

These are planned delivery criteria, not a claim that each module is finished. Each row links to candidates by number in the [register](integration-register.md); a reference is not a required dependency.

| Module · candidate IDs | Input → editable result | Done when… |
|---|---|---|
| Song Intelligence · 26, 28, 33 | PCM → confidence-scored beat/energy spans → accepted markers | Silence and uncertain tempo can be left unmarked; relinking the master restores accepted markers. |
| Lyric Intelligence · 12–16, 24 | Supplied lyrics or ASR cues → reviewed words/locks → timed lines | Correction, undo and subtitle round-trip keep the intended occurrence of repeated words. |
| Typography · 91–93, 95 | Text, language and safe area → editable type treatment | Preview and export agree on wrapping/highlight; missing glyphs or fonts prompt a fallback. |
| Visual World · 41, 81, 88 | Art direction or local asset → original scene background | Failed optional generation leaves a working gradient; accepted assets survive reopen without regeneration. |
| Director · 1, 2, 96 | Script beats, song sections **or** existing spec → proposed scene changes | Reject/apply/regenerate a single scene without rewriting other timings or narration. |
| Timeline · 17, 71, 72 | Lines, scenes and media → selectable, seekable timeline edits | Touch and keyboard edits can be undone, saved and reopened with the same playhead mapping. |
| Audio Reactive · 26, 51, 63 | Song or generated audio features → editable intensity envelope | Preview/export sample the same signal at the same timestamp; silent scenes still render. |
| Effects · 44–46, 50 | Scene + effect parameters → bounded transitions and overlays | Effects can be disabled or reduced; a static fallback retains readable text. |
| Render · 38, 56, 62, 99 | Resolved project + range → preflight → encode → downloaded file | Independently decode output; verify range and intended audio, handle cancellation and unsupported codecs without project loss. |
| Presets · 2, 5, 58, 100 | Resolved design settings → named versioned preset → apply to selected scope | Preview and undo before accepting; changing a preset later never changes a previously saved project. |

## Worked example: the song path

1. **Import.** Decode once; key original media by its content hash. A musician can paste lyrics, import timed text or ask local Whisper for a draft. Do not replace sung vocals with Piper; keep script narration as a separate existing workflow.
2. **Analyze and align.** Derive peaks, spectrum, tempo confidence and energy spans from the master. Propose timestamps against original display text. Mark unmatched words as estimates; a locked line, manually confirmed word or instrumental break must survive reanalysis.
3. **Review.** A low-confidence queue seeks the transport to the phrase with a short lead-in. Accept, edit, lock or skip; undo restores the previous timing *and its provenance*. Timed imports stay authoritative unless the user requests realignment.
4. **Direct.** A single draft plan references existing section/line IDs, not replacement lyrics. A worship preset might hold warm, low-motion gradients through the verse and widen the chorus typography; a neon preset might emphasize beat accents only in a confident chorus. The difference is pacing and hierarchy, not a wallpaper swap. Deterministic defaults must work without an AI account.
5. **Apply and deliver.** Validate the plan, preview a section, apply selected changes as one undoable command, save, preflight and export. Preview, thumbnails and encode sample the same composition time. Exporting or cancelling never mutates the project.

### Proposed contracts (not current APIs)

| Boundary | Minimum contract and failure rule |
|---|---|
| Analysis / alignment | Input: audio hash, project revision, lyric IDs, language and lock mask. Output: bounded microsecond spans, confidence/provenance, provider + model version. Reject stale results when source audio or lyrics change; never silently retime locked words. |
| Creative plan | `{version, sourceRevision, seed, sections:[{sectionId, lineIds, palette, typographyPreset, motionPreset, intensity, assetId?}]}`. Schema-validate IDs, enums and numeric ranges; no JavaScript, HTML, shaders or filesystem paths from a model. A missing asset resolves to a local fallback. |
| Render engine | Capability probe for dimensions, fps, video/audio codecs and frame source → chosen settings and reason. Encoder consumes timestamped frames + PCM for a fixed range, returns progress, cancel or artifact metadata. Start with the existing browser implementation; a server worker must consume the same resolved styling, fonts, assets and timebase. |
| Optional jobs | Separate opt-in alignment, artwork and render job types. Disclose exactly which media leaves the device, estimate cost before upload, authenticate and scope each job, limit bytes/runtime, expire input/output, support cancel and bounded retry. Cache by input hash + settings + provider version; remote failure leaves the local editor usable. No credentials or arbitrary workflow nodes in a project file. |

## Build order and release gates

Targets below are **proposed acceptance tests**, not measured performance claims. Test on rights-cleared fixtures including dense mixes, repeated choruses, held syllables, silence, tempo changes and a multilingual song. Keep human-annotated boundaries separate from algorithm output.

| Order | Deliverable and dependency | Gate before widening scope |
|---|---|---|
| 0 · P0 baseline | Capture three independent release paths: song → timed lyric edit, prose → timed narration, and template/spec → silent motion composition. Save, reopen and export each. Record browser, OS, codecs, elapsed time and peak memory. | Decode the downloaded file independently (PyAV pilot); verify dimensions, frame count, intended audio, range and outro. Compare flash/click sync at start, middle and end within one video frame on the reference device. Test unsupported codec and storage-quota paths. |
| 1 · P0 correction | Add confidence review using existing Whisper, waveform and timing commands. No new runtime. | On a fixture with a repeated refrain, correcting its second occurrence leaves the first untouched; locks survive regeneration, undo and reload. Report word onset error (median/p95), coverage and correction time, not just transcription word error rate. |
| 2 · P1 song analysis | Extend existing beat/spectrum features with user-editable energy sections; compare to librosa offline. | Beat grid is a suggestion on a tempo change; silence creates no fictitious chorus. Dropping derived data and reopening restores accepted markers and the original audio hash. |
| 3 · P1 creative direction | Derive a single section plan from reviewed timing; implement three original preset families in the existing 2D renderer. | Regenerate one section only. Lyric text/times remain byte-for-byte equivalent, one undo reverses the patch, and paused preview matches decoded export at sampled section boundaries in portrait and landscape. |
| 4 · P1 optional alignment | Only if step 1 shows a gap: WhisperX/faster-whisper worker A/B against local cues on the same corpus; compare with/without vocal isolation. | Adopt only for a measured drop in median onset error **and** manual corrections with no lost locked words. Publish p95 error, supported languages, cost/minute and latency. Archived Demucs needs a supported pinned build and weight review, otherwise omit the stem step. |
| 5 · P1 delivery fallback | Extract the encoder boundary after baseline parity. Pilot native FFmpeg for an unsupported local codec or explicitly requested complex export. | Prove the same range, fonts, frame count and audio sync as step 0. Disallow silent uploads; declining server processing still offers supported local settings. Cancel/retry must not double-bill or overwrite prior output. |
| 6 · P2 visual expansion | After section plans and parity: independently pilot **one** deterministic Three.js world and **one** allowlisted ComfyUI image workflow. Then consider keyframes and a user preset library. | Context loss or GPU denial selects the documented fallback. Reopen with the saved image and seed without rerunning inference. Compare seek vs sequential render; enforce a measured frame/memory budget on target devices before enabling by default. |

## License and adoption checkpoint

For each pilot, record the exact commit/package, component license text, required notices, modifications, distribution surface (browser, hosted worker or CI only), model card and weight terms, font embedding rights and example-media provenance. Record an owner and replacement path. **Stop** if terms or upstream identity cannot be verified. A permissively licensed wrapper is not permission to ship its weights, codecs or user media; running a component on a server is not a blanket exemption from obligations.

Two concrete checks: [FFmpeg’s license file](https://github.com/FFmpeg/FFmpeg/blob/master/LICENSE.md) distinguishes build configurations; review the actual binary and enabled codecs. [Remotion’s license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) has specific usage terms; a public repository is not a generic permissive dependency. Do not import agent skills as trusted executable tools. No third-party source, weights, fonts or images are incorporated by this blueprint.

**Song-module follow-up (not a studio-wide prerequisite):** a “Review uncertain timings” action in the lyric inspector, using existing word confidence/source/lock fields. Include a rights-cleared sung fixture, a repeated-chorus regression test, undo/reopen coverage and before/after correction metrics. That gives the next architecture decision a real baseline rather than a list of impressive libraries.
