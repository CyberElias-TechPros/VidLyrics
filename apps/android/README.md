# VidLyrics — native Android studio

This directory is a **genuinely native Android application**: Kotlin, Jetpack
Compose, MediaCodec / MediaMuxer / MediaExtractor / Media3 ExoPlayer and the
Android Canvas. There is no WebView, no web runtime, no bundled JavaScript and
**no `INTERNET` permission**. It is a reimplementation of the product described
by the repository's web app, not a wrapper around it.

```
apps/android/
├── core/                     pure-JVM Kotlin domain + algorithms (no Android APIs)
│   ├── src/main/kotlin/...   24 files, wire-compatible with project format v2
│   ├── src/test/kotlin/...   dependency-free 145-check verification suite
│   └── verify.sh             compile + run the suite with plain kotlinc
├── app/
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/vidlyrics/studio/
│       │   ├── data/         settings, atomic JSON store, content-addressed assets
│       │   ├── media/        streaming decoder, probe, ExoPlayer clock, offline TTS
│       │   ├── speech/       optional reflective ONNX CTC model pack
│       │   ├── render/       Canvas rasteriser, text measurer, asset cache, preview
│       │   ├── export/       EGL bridge, AAC encoder, MP4 muxer, render service
│       │   └── ui/           Compose theme, navigation, home, editor, settings, guide
│       └── res/              strings, themes, adaptive icon, notification, FileProvider
├── gradle/                   version catalog + Gradle 8.11.1 wrapper
├── gradlew / gradlew.bat     real, executable Gradle wrapper
└── README.md
```

## What the app does

| Area | Implementation |
| --- | --- |
| Import | SAF import of MP3 / M4A-AAC / WAV / FLAC / OGG / Opus, LRC, Enhanced LRC, SRT, VTT, ASS, TXT, timed JSON and `.vidlyricsproject` files; SHA-256 content-addressed private storage |
| Timing | waveform + log-mel + onset + beat-grid analysis, DP auto-alignment, tap-sync read from the **audio clock**, optional on-device CTC word alignment, per-line/word nudging, global offset applied only at render time |
| Editing | full undo/redo command stack, autosave + crash recovery, waveform timeline with confidence heat, loop/scrub/zoom, translations, speakers, split/merge, locks, sections |
| Design | 10+ themes, 5 aspect ratios with platform safe areas, gradient/mesh/image/solid/visualizer backgrounds, album-art palette extraction, karaoke modes, motion transitions, intro/outro cards, branding, safe-area guides |
| Preview | a native `View` drawn by the **same `FramePainter` and `computeFrameState`** used by the encoder, so preview and MP4 cannot drift |
| Export | MediaCodec H.264/HEVC/VP9/AV1 video via an EGL surface, AAC audio with optional offline TTS voiceover, MP4 muxing, foreground service with progress/cancel notification, SAF or MediaStore delivery |
| Recovery paths | typed `AppError` with designed recovery cards (lower resolution, shorter range, tap-sync instead, re-link audio, retry) |
| Privacy | no network permission, no account, no analytics SDK, no model downloads; all decoding, analysis, alignment, rendering and encoding are on-device |
| Accessibility | content descriptions, scalable type, reduced-motion setting, optional haptics, dark/light/system + dynamic colour, keyboard shortcuts (Ctrl+Z / Ctrl+Y / Space / T) |

`core/` is platform-independent and compiles with `kotlinc` alone. The Android
layer calls it directly; nothing is serialised through a JavaScript bridge.

## Building (on a machine with the Android SDK)

Requirements: JDK 17, Android Studio Ladybug (or newer) with **Android SDK 35**,
Android SDK Build-Tools and Platform-Tools, and ~4 GB free for Gradle caches.

```bash
cd apps/android
export ANDROID_HOME=/path/to/Android/Sdk      # or edit local.properties
./gradlew :core:verifyCore                   # 145 pure-JVM checks, no emulator needed
./tools/verify-offline.sh                    # same suite with plain kotlinc (no SDK)
./gradlew :app:assembleDebug                 # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:assembleRelease               # needs a signing config for publishing
./gradlew :app:testDebugUnitTest             # JVM unit tests
./gradlew :app:connectedDebugAndroidTest     # device/emulator tests
```

To make a distributable release, add a `signingConfigs { release { ... } }` block
in `app/build.gradle.kts` backed by local keystore properties (never committed),
then run `./gradlew :app:bundleRelease` for a Play Store `.aab`.

The optional word-alignment model is **not bundled**. If you want it, add
`implementation("com.microsoft.onnxruntime:onnxruntime-android:<version>")` to
`app/build.gradle.kts`, then import `ctc.onnx` and `vocab.json` through
**Settings → Optional on-device speech pack**. `SpeechEngine` finds the runtime
reflectively, so the app builds and all other sync methods work without it.

## Verification status

Verified here (2026-11-04):

* `core/verify.sh` — all **145/145** checks pass on JDK 25 / `kotlinc` 2.4.21
  (`ALL CORE CHECKS PASSED`).
* All **24 core + 36 app Kotlin sources** type-check with zero errors against
  the real Android API 35 `android.jar`, plus offline compile-only Jetpack API
  contracts for Compose / AndroidX / Media3 / coroutines. This catches
  unresolved symbols, wrong argument shapes, bad enum names and API-level
  mistakes (it caught and fixed a two-centre `RadialGradient` call that would
  have crashed on API 26–30).
* Manifest, resources, version catalog and Gradle wrapper are present and
  internally consistent.

Not verified here: this sandbox has no Android SDK, no Google Maven repository
and no emulator, so **no Gradle build, no APK, no instrumentation test and no
on-device render was executed**. Those require the build steps above on a normal
Android development machine. Treat the code as a complete, type-checked source
implementation that still needs one real `assembleDebug` + device smoke test
before shipping.

## Architecture notes

* **One clock.** Tap timestamps and the preview playhead come from
  `ExoPlayer.currentPosition`; the render loop derives frame times from
  `Time.frameToUs`. Wall-clock time is never used for media timing.
* **One scene.** `buildScene()` produces an immutable composition; intro/outro
  cards extend its timeline without shifting lyric times (`toMusicTime()`
  removes `introUs`). `computeFrameState()` is pure and identical in preview and
  export.
* **One command stack.** Every mutation goes through `EditorViewModel.commit()`,
  so undo/redo, autosave and recovery stay consistent. The large PCM buffer and
  the ExoPlayer instance live outside Compose state.
* **Streaming memory.** `AudioAnalysisSink` consumes small decoded chunks
  instead of holding the whole song in RAM; a 10-minute track costs a few
  hundred KB of analysis state.
* **Background correctness.** Long renders live in `RenderService`, a
  `mediaProcessing` foreground service with a cancel action. Cooperative
  cancellation is checked every frame.
* **Fail soft.** If audio encoding fails, the video is still delivered. If the
  chosen codec is unavailable, `VideoExporter` falls back to another available
  hardware encoder. Every failure carries an actionable recovery route.
