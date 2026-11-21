# Producing a video

Choose **Script to video**, **Song to lyric video**, or **Video as code**. None requires starting in another mode. On phones, **Edit project** opens full-width authoring controls; **Preview & timeline** returns to the stage. Project/file operations are under **Actions**.

- **Script:** paste prose or a scene spec and choose **Build & narrate** or **Apply & narrate**. This generates speech on-device, then sets scene times from the audio. Regenerate after changing spoken copy. Select **Download WAV** to keep the exact recording.
- **Song:** choose a track. Import LRC, SRT, VTT, ASS or timed JSON if you have timings. For an empty timeline, **Create lyric video draft** uses local Whisper and applies a visual treatment. Alternatively **Transcribe audio** lets you inspect cues before replacing anything. With existing lyrics, **Keep lyrics · match…** matches recognized phrases in sequence; it skips unmatched and already confirmed lines. It is not phoneme-level alignment. The optional stereo centre filter can suppress panned accompaniment but cannot isolate centred drums from vocals; export always uses the original track.
- **Code/template:** open a template or paste a validated `vidlyrics.spec`. Edit and preview it, optionally narrate it, or export a silent composition. Script preferences and spoken overrides remain separate from on-screen typography.
- **Correct:** **Review uncertain timings** seeks just before a word. Edit its start/end in seconds and confirm. The edit is undoable, including changes to adjacent estimated boundaries. Repeated words have distinct IDs.
- **Direct:** under **Design → Scene director**, choose Sanctuary, Afterglow or Editorial, inspect the storyboard and apply it to one scene or all scenes. The director uses section evidence and the audio spectrum when available. Afterglow projects an animated perspective grid. The director is deterministic and rule-based, not a hosted LLM. Source words, timing, narration, layout content and image overrides survive the edit.
- **Deliver:** preview, save, reopen from Projects and export video. Export project files and keep external media for recovery. Browser MP4 export tests device codec support; AAC, Opus and separate WAV have different player compatibility. Do not distribute a silent MP4 alone if the studio gave you a separate WAV.

## Native H.264/AAC fallback (offline batch runner)

A computer or trusted private render worker can render without a browser video encoder. Install Node 22, a local FFmpeg binary with `libx264` and AAC, then run from the checkout:

```sh
npm ci
npx playwright install --with-deps chromium
npm run render:native -- song.vidlyricsproject song.mp4 original.wav voiceover.wav background.png
# A spec without external assets renders silently:
npm run render:native -- scenes.spec.json scenes.mp4
```

Pass only assets needed by this project. The runner matches by SHA-256, not filename. For narrated projects use the WAV downloaded from the studio; a spec alone is not an audio recording. Missing media or stale enabled narration is an error. In-memory browser routes serve only supplied files; there is no upload, listening service or paid API. The runner validates input, uses the studio's frame painter in headless Chromium, streams PNG frames with backpressure to FFmpeg, and publishes the MP4 only after encoding succeeds. It refuses to overwrite an existing output. `FFMPEG_PATH` and `CHROMIUM_PATH` optionally select locally installed binaries.

Use the same fonts on both machines. This runner uses Chromium's audio decoder, writes H.264/AAC regardless of the browser codec choice, and limits its mixed audio buffer to 64 million samples. Use a shorter range for larger jobs. It is not a public multi-tenant job service. Web users do not download FFmpeg or native codecs.

## Verification

`npm run verify` runs lint, types, unit tests and an app-only build. `npm run test:e2e` includes an original two-tone song fixture, repeated SRT lyrics, word correction, direction, save/reopen and decoding actual exported audio. This fixture verifies synchronization mechanics, not recognition accuracy for real singers. PR CI renders its exported project via native FFmpeg as a separate check. The full-pack speech workflow builds real weights and exercises local narration and transcription. No browser-wide, visual-model or sung-word accuracy benchmark is implied by these checks.

**Save a reusable style:** under Design → My style presets, name and save the current typography, motion, karaoke and accent. The versioned library is device-local. Applying a style copies those values into the project as a single undoable edit; deleting the library entry does not change earlier exports or projects.

**Shape a song's dynamics:** Design → Track energy map suggests quiet, steady and lift spans from the decoded spectrum. Select a marker to seek, change its level, add another boundary, or remove it. Accepting/editing saves the map with the track hash. The director follows the accepted level at each cue midpoint. Energy is not evidence that a particular lyric is a chorus.
