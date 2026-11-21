# VidLyrics integration decision register

Companion to the [integration blueprint](integration-blueprint.md). Numbers preserve the original proposal. **Keep** = use the existing integration or browser standard; **Pilot** = bounded experiment, not approved for release; **Study** = design or evaluation reference only, no source or asset imports; **Defer** = no work until the stated need arises. The first word of each rationale maps to a studio in the blueprint.

Evidence: queried GitHub repository metadata for all 100 supplied paths. Links for resolved entries point to the default-branch revision returned by that lookup. The license column is GitHub’s top-level SPDX detection, **not** a component or model license audit. “Review” means null or `NOASSERTION`; “unresolved” means the supplied path did not resolve for this account, not that a project cannot exist. Archived entries need a maintenance owner before any pilot.

## A. Creative agents and production skills

| # | Candidate (source snapshot) | License signal | Decision | VidLyrics use or reason not to integrate |
|---:|---|---|---|---|
| 1 | [calesthio/OpenMontage](https://github.com/OpenMontageInc/OpenMontage/tree/2e003e65fa99a0f329478a2c1cdcf26bc481933a) → OpenMontageInc/OpenMontage | AGPL-3.0 | Study | Director: borrow the idea of a reviewable shot list; emit scene patches, not arbitrary agent tools. |
| 2 | [remotion-dev/skills](https://github.com/remotion-dev/skills/tree/6f55706d1069e512430582ad86e4e57dc07afe1b) | Review | Study | Director: turn pacing and typography guidance into template constraints; no React renderer required. |
| 3 | [howseen-ai/claude-motion-design](https://github.com/howseen-ai/claude-motion-design/tree/3d90d349ef3fdde9b7e89de4df4a2159c9e8697f) | MIT | Study | Type: compare entrance choreography; translate useful patterns into seekable easing curves. |
| 4 | [kmilo93sd/agent-video-editor](https://github.com/kmilo93sd/agent-video-editor/tree/8e32c0aff64c445ef1e2b87bc04408a34d68c973) | MIT | Study | Director: compare suggested cuts with section boundaries; never apply cuts to locked timings. |
| 5 | [konradre/video-production-skills](https://github.com/konradre/video-production-skills/tree/cd92701fd52fbfa668f2247687b32d0f85506fda) | MIT | Study | Director: derive a checklist for brief, storyboard, review and delivery. |
| 6 | [kurbaitaev/ghost-editor](https://github.com/kurbaitaev/ghost-editor/tree/d71bdb62d8e8280f05d6271bb72610ca83d38d8a) | MIT | Defer | FX: short-form auto-cuts can obscure lyrics; benchmark readability first. |
| 7 | [Maciejdziuba/youtube-skills](https://github.com/Maciejdziuba/youtube-skills/tree/0a96a99917b189ee2a268eef81978f3549d0a1b2) · archived | MIT | Defer | Render: publishing automation is downstream of a correct MP4, not an editor dependency. |
| 8 | [pycodebr/heditor](https://github.com/pycodebr/heditor/tree/4f19f560a5a26f3b32a3ea4114fa8b42b84c51f8) | Review | Study | Presets: inspect vertical-safe composition patterns for portrait scenes. |
| 9 | [Vincentwei1021/anything2explainer](https://github.com/Vincentwei1021/anything2explainer/tree/dc2186667b2a7c4722f6a42bb0abd0ae18db0ec9) | Review | Defer | Director: explanatory prose is already served by the script-to-spec path. |
| 10 | [Vincentwei1021/video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft/tree/59f3e9b9e936ff2bce0e18446226d770a3f2f61f) | Apache-2.0 | Study | Director: test shot descriptions as optional storyboard notes, not executable instructions. |

## B. Recognition and lyric synchronization

| # | Candidate (source snapshot) | License signal | Decision | VidLyrics use or reason not to integrate |
|---:|---|---|---|---|
| 11 | [openai/whisper](https://github.com/openai/whisper/tree/86098128c0b4f24f0e2aa2994de830614b474227) | MIT | Study | Lyrics: use as a reference for recognition quality; avoid shipping a second Whisper runtime. |
| 12 | [m-bain/whisperX](https://github.com/m-bain/whisperX/tree/8d8e43bf3698dd1df4b011c0f1a8dd1d468ae365) | BSD-2-Clause | Pilot | Lyrics: opt-in worker for forced alignment; compare sung-word boundaries to the local baseline. |
| 13 | [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper/tree/6cb639e70786aea42b9233006ae60eaf07190bdb) | MIT | Pilot | Lyrics: inference backend inside the same remote alignment job, not another user-facing transcriber. |
| 14 | [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp/tree/5eaee0cc9024eb9e9a99469199920c8b7f5cb9ec) | MIT | Keep | Lyrics: maintain existing WASM integration and verified model pack as the private default. |
| 15 | [jianfch/stable-ts](https://github.com/jianfch/stable-ts/tree/e312072cc024ae9fceb25b057d7d18524873a02b) · archived | MIT | Study | Lyrics: compare timestamp stabilization on sustained notes before changing postprocessing. |
| 16 | [linto-ai/whisper-timestamped](https://github.com/linto-ai/whisper-timestamped/tree/a7a9605f4e82981666e2888aeb295290d825adfb) | AGPL-3.0 | Study | Lyrics: compare confidence calibration; do not equate token scores with ground truth. |
| 17 | [SubtitleEdit/subtitleedit](https://github.com/SubtitleEdit/subtitleedit/tree/a194a64d49a709943b9768654573f3ea0576456b) | MIT | Study | Timeline: adapt correction shortcuts and QC patterns to the existing editor. |
| 18 | [smacke/ffsubsync](https://github.com/smacke/ffsubsync/tree/de310ac6944b8260431a48ee741e7063cec49b0f) | MIT | Defer | Lyrics: subtitle offset correction is not word alignment for singing; retain global offset control. |
| 19 | [alphacep/vosk-api](https://github.com/alphacep/vosk-api/tree/4ab9821510b488efb7740094714a130bd3545e90) | Apache-2.0 | Defer | Lyrics: adds a second offline model family without a demonstrated song-quality gain. |
| 20 | [speechbrain/speechbrain](https://github.com/speechbrain/speechbrain/tree/c0241278f93ef02cd5191f03caf4e5f8e1292bf6) | Apache-2.0 | Defer | Song: broad research toolkit; require a specific vocal-detection benchmark first. |
| 21 | [modelscope/FunASR](https://github.com/modelscope/FunASR/tree/581150d8e1de2bc055cc390b6f2efc9ea78b48b7) | MIT | Defer | Lyrics: compare on underperforming languages only after defining the evaluation corpus. |
| 22 | [NVIDIA/NeMo](https://github.com/NVIDIA-NeMo/Speech/tree/c02239ab43822ea837b21fb5c0c29e45fbd063fd) → NVIDIA-NeMo/Speech | Apache-2.0 | Defer | Lyrics: heavyweight alternative GPU stack overlaps the proposed alignment worker. |
| 23 | [WhisperSpeech/WhisperSpeech](https://github.com/WhisperSpeech/WhisperSpeech/tree/a45964589f0a5c7b8518b2fda1b60e334872c4bd) | MIT | Defer | Lyrics: speech synthesis overlaps working local Piper narration; neither is singing synthesis. |
| 24 | [MontrealCorpusTools/Montreal-Forced-Aligner](https://github.com/MontrealCorpusTools/Montreal-Forced-Aligner/tree/2197ccd2d0bbe0194455b7e22592923be6af385b) | MIT | Study | Lyrics: phoneme boundaries for future syllable karaoke; pronunciation dictionaries add language scope. |
| 25 | [MaaSTeR1/ctc-forced-aligner](https://github.com/MaaSTeR1/ctc-forced-aligner) · unresolved | Unknown | Defer | Lyrics: possible lighter aligner; resolve upstream identity, language and weight terms before comparison. |

## C. Music analysis and audio processing

| # | Candidate (source snapshot) | License signal | Decision | VidLyrics use or reason not to integrate |
|---:|---|---|---|---|
| 26 | [librosa/librosa](https://github.com/librosa/librosa/tree/087a8607dd86e98a9032a62b357eb9afd23a14c5) | ISC | Pilot | Song: offline beat/onset reference for measuring the native detector, not a browser dependency. |
| 27 | [MTG/essentia](https://github.com/MTG/essentia/tree/df27f949d7827a43b4afc216fd5c788454b0f8a4) | AGPL-3.0 | Study | Song: compare section and tonal feature extraction; review commercial/copyleft implications first. |
| 28 | [facebookresearch/demucs](https://github.com/facebookresearch/demucs/tree/e976d93ecc3865e5757426930257e200846a520a) · archived | MIT | Pilot | Song: optional vocal stem as alignment input only if sung-word accuracy improves enough to justify GPU time. |
| 29 | [nomadkaraoke/python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator/tree/4dd3477c0a8f5bfb0fb053c6ed444bb935cb150e) | MIT | Defer | Song: abstraction across separators; select one tested model before adding a dispatcher. |
| 30 | [sigsep/open-unmix](https://github.com/sigsep/open-unmix) · unresolved | Unknown | Defer | Song: alternative vocal separation baseline if the Demucs pilot fails its cost gate. |
| 31 | [asteroid-team/asteroid](https://github.com/asteroid-team/asteroid/tree/eebbc76c731bfeeee355344c97a3d462bf795d7b) | MIT | Defer | Song: separation research recipes are not required for a single supported stem job. |
| 32 | [pyannote/pyannote-audio](https://github.com/pyannote/pyannote-audio/tree/c2b12c5aa5f4c7e52c180a421072be8acc9c94a3) | MIT | Defer | Lyrics: diarization is not duet detection; prefer human speaker labels until evaluated. |
| 33 | [snakers4/silero-vad](https://github.com/snakers4/silero-vad/tree/066409f3d9db45a30d21dfcbf9147826ffdd7052) | MIT | Study | Song: evaluate quiet-region hints; speech VAD must not discard sung or instrumental spans. |
| 34 | [Rikorose/DeepFilterNet](https://github.com/Rikorose/DeepFilterNet/tree/7b14b895fe7fc42cab72b4a4c1e49c982bd6404b) | Review | Defer | Song: speech denoising can alter accompaniment; never overwrite the uploaded master. |
| 35 | [resemble-ai/resemble-enhance](https://github.com/resemble-ai/resemble-enhance/tree/8e978149bfe8abab3eb77d965d579a111afdb0ff) | MIT | Defer | Song: restoration for voice recordings is not the song-import critical path. |
| 36 | [jiaaro/pydub](https://github.com/jiaaro/pydub/tree/103e339d3bc7a9a58a9f1de65f7d8074659b5f5a) | MIT | Defer | Song: redundant conversion layer over the browser decode path or a future FFmpeg worker. |
| 37 | [bastibe/python-soundfile](https://github.com/bastibe/python-soundfile/tree/e8293394e6b712240f06aea5d074956481abf33e) | BSD-3-Clause | Study | Song: read lossless fixtures in an offline evaluation harness, not in the app. |
| 38 | [PyAV-Org/PyAV](https://github.com/PyAV-Org/PyAV/tree/686e192d804e092d36576a5c47517304f99dbf79) | BSD-3-Clause | Pilot | Render: independent CI decoder to count frames, measure embedded audio and detect drift. |
| 39 | [kkroening/ffmpeg-python](https://github.com/kkroening/ffmpeg-python/tree/df129c7ba30aaa9ffffb81a48f53aa7253b0b4e6) | Apache-2.0 | Defer | Render: first worker needs a small fixed encoder argument set, not a graph-building wrapper. |
| 40 | [csteinmetz1/pyloudnorm](https://github.com/csteinmetz1/pyloudnorm/tree/b8d67bfd3ce5deef872f688fcfa491a0ca69fddd) | MIT | Study | Song: compare loudness meters offline before adding a non-destructive normalization option. |

## D. Motion and visual engines

| # | Candidate (source snapshot) | License signal | Decision | VidLyrics use or reason not to integrate |
|---:|---|---|---|---|
| 41 | [mrdoob/three.js](https://github.com/mrdoob/three.js/tree/193048fd8ec7fd95ab65eae12a39bbe10be4b48f) | MIT | Pilot | World: one lazy-loaded, seeded 3D scene after frame parity passes; retain a 2D fallback. |
| 42 | [pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber/tree/d74622ea8ed717f7212d7e19d65ff3e325508389) | MIT | Defer | World: add only if React scene authoring beats direct Three.js without introducing another clock. |
| 43 | [pmndrs/drei](https://github.com/pmndrs/drei/tree/bf6f4addf47467d3885de272d94ca5127f6ef68f) | MIT | Defer | World: convenience helpers require the React Three Fiber choice first. |
| 44 | [pmndrs/react-postprocessing](https://github.com/pmndrs/react-postprocessing/tree/e07ef9a890c8a202a3b20eac0249032cff4e7805) | MIT | Defer | FX: only after a WebGL budget exists; bloom must not reduce lyric contrast. |
| 45 | [theatre-js/theatre](https://github.com/theatre-js/theatre/tree/6ea82b938ea49609489f6377ded693ccc6ee8f5b) | Apache-2.0 | Study | Timeline: compare keyframe interpolation and scrubbing against project microseconds. |
| 46 | [greensock/GSAP](https://github.com/greensock/GSAP/tree/5e6c35ff8eedea12d4f229129def635277d8b0f2) | Review | Study | Type: reference easing and sequencing; runtime and redistribution terms require independent review. |
| 47 | [motiondivision/motion](https://github.com/motiondivision/motion/tree/1b374802de947700ad7d2bb52a0ccec8339cf2f1) | MIT | Defer | Timeline: optional panel polish, not an export animation clock. |
| 48 | [airbnb/lottie-web](https://github.com/airbnb/lottie-web/tree/bede03d25d232826e0c9dca1733d542d8a7754fb) | MIT | Defer | FX: require frame-seeking and external-asset validation before admitting animation files. |
| 49 | [rive-app/rive](https://github.com/rive-app/rive) · unresolved | Unknown | Defer | FX: clarify editor versus runtime and asset licenses before supporting stateful graphics. |
| 50 | [pixijs/pixijs](https://github.com/pixijs/pixijs/tree/16011d73d81678fa8c48f256ad36de7db7f90ce9) | MIT | Defer | World: alternative GPU 2D renderer only if profiling identifies a Canvas bottleneck. |
| 51 | [processing/p5.js](https://github.com/processing/p5.js/tree/492186e1017ce6f19da4117c624f872c012a5333) | LGPL-2.1 | Study | Reactive: prototype seeded particle rules offline; retain one render loop. |
| 52 | [paperjs/paper.js](https://github.com/paperjs/paper.js/tree/0d1446a1bb040e3c87533b28bcc384d87663587b) | Review | Study | Type: investigate text-on-path geometry without adding an entire vector editor. |
| 53 | [cables-gl/cables](https://github.com/cables-gl/cables/tree/d27f472d79e603bd605ddad10ad158c0414e7209) | Review | Defer | World: node-graph authoring needs a portable, versioned shader graph format first. |
| 54 | [stevensona/shader-toy](https://github.com/stevensona/shader-toy/tree/26d08223a9201a54c41f01e664cacf4876a517f7) | MIT | Study | World: tooling reference, not a licensed shader catalog; author original shaders. |
| 55 | [tengbao/vanta](https://github.com/tengbao/vanta/tree/f8b351906688b56f0fc744e53bde81fc3c56f150) | MIT | Defer | Reactive: interactive page backgrounds lack the required guarantee of deterministic frame seeking. |

## E. Composition and delivery

| # | Candidate (source snapshot) | License signal | Decision | VidLyrics use or reason not to integrate |
|---:|---|---|---|---|
| 56 | [FFmpeg/FFmpeg](https://github.com/FFmpeg/FFmpeg/tree/b8c699bfbebd889d7795fb07bd7679b84ab366fb) | Review | Pilot | Render: optional native worker encoding the same frames and PCM; explicitly select build flags and codecs. |
| 57 | [ffmpegwasm/ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm/tree/f876f907c7e9b9bf51d4ed0b913a855a63ae63fc) | MIT | Defer | Render: benchmark memory and download cost against WebCodecs before adding a browser fallback. |
| 58 | [remotion-dev/remotion](https://github.com/remotion-dev/remotion/tree/970849fc1921ed7e0c3175132fe9580e8875ab2f) | Review | Study | Render: study frame-indexed compositions; a second composition model risks preview/export divergence. |
| 59 | [Zulko/moviepy](https://github.com/Zulko/moviepy/tree/211e4b15f6ce4f34a6a9efbfff40590e43a68f77) | MIT | Defer | Render: overlaps native FFmpeg; must not redefine project timing in Python. |
| 60 | [opencv/opencv](https://github.com/opencv/opencv/tree/13778986a86cfb3b6745be923b088914e9fc28f7) | Apache-2.0 | Defer | World: consider only for a defined tracking/cropping tool, not basic background fitting. |
| 61 | [google-ai-edge/mediapipe](https://github.com/google-ai-edge/mediapipe/tree/3ad0cf1606656efc101717952741749393ff96a3) | Apache-2.0 | Defer | World: subject tracking requires video layers and stable asset lifetimes first. |
| 62 | [w3c/webcodecs](https://github.com/w3c/webcodecs/tree/e3e611cc4f68610f8589ad9f70a2ef5f44f74a6b) | Review | Keep | Render: keep capability probing, codec fallback and independent decoding of actual exports. |
| 63 | [WebAudio/web-audio-api](https://github.com/WebAudio/web-audio-api/tree/42e974ad6a627b8791e75e876dd00a181929ab7f) | Review | Keep | Song: retain the browser audio clock and decoded PCM; specification, not an npm install. |
| 64 | [whatwg/html](https://github.com/whatwg/html/tree/0e292f402d0c3dd17fe00c1bb2ef3a3c94cd8bce) | Review | Keep | Render: use Canvas for shared preview/export drawing; HTML is a standards reference. |
| 65 | [GStreamer/gstreamer](https://github.com/GStreamer/gstreamer/tree/f5fd22828e1262a036a4a16710ec6dc8344da561) | Review | Defer | Render: alternative native pipeline; do not maintain two backend encoders in the pilot. |
| 66 | [libass/libass](https://github.com/libass/libass/tree/a6613d2554daff9e1b5ddf2dbfb3fc31b61b9448) | ISC | Study | Type: benchmark ASS subtitle styling and complex-script rendering for subtitle interchange. |
| 67 | [mpv-player/mpv](https://github.com/mpv-player/mpv/tree/7f505de186ddcaeff6dabf48db79c9b8f8adc309) | Review | Study | Render: optional independent player for device/codec compatibility triage. |
| 68 | [mltframework/shotcut](https://github.com/mltframework/shotcut/tree/2eba56a72af3b7806876f2a2956cfff789db1468) | GPL-3.0 | Study | Timeline: compare ripple-edit and lock behavior; preserve undo semantics. |
| 69 | [KDE/kdenlive](https://github.com/KDE/kdenlive/tree/f5ad17c990589ffba60eb31a875f70ec338407d1) | GPL-3.0 | Study | Timeline: learn track targeting and proxy workflow; no desktop engine embedding. |
| 70 | [OpenShot/openshot-qt](https://github.com/OpenShot/openshot-qt/tree/42a26c310e7a09397dde95761dbeb7d543cad006) | Review | Study | FX: compare transition affordances before broadening the scene transition schema. |

## F. Timeline and media UX

| # | Candidate (source snapshot) | License signal | Decision | VidLyrics use or reason not to integrate |
|---:|---|---|---|---|
| 71 | [katspaugh/wavesurfer.js](https://github.com/katspaugh/wavesurfer.js/tree/eef9057e391698370e1a58788646432a562d63a5) | BSD-3-Clause | Study | Timeline: compare region handles, zoom and keyboard editing to current peak rendering; avoid a second player. |
| 72 | [OpenCut-app/OpenCut](https://github.com/OpenCut-app/OpenCut/tree/e668010778568641babef2cc40be4703ae6916d6) | MIT | Study | Timeline: study selection, snapping and media bins; map edits to existing history commands. |
| 73 | [jitteranimation/jitter](https://github.com/jitteranimation/jitter) · unresolved | Unknown | Defer | Type: do not assume the hosted product has an embeddable open-source editor. |
| 74 | [nexrender/twick](https://github.com/nexrender/twick) · unresolved | Unknown | Study | Timeline: compare track schema and handles only if the supplied upstream can be verified. |
| 75 | [videojs/video.js](https://github.com/videojs/video.js/tree/f7b2c07f5839060edfc18b8e3b099f9d84ab4bc9) | Review | Defer | Render: playback controls do not solve composition sampling or audio clock sync. |
| 76 | [vidstack/player](https://github.com/vidstack/player/tree/0133da67e4f84a5aaad59c63853b12c6cda0a6a9) | MIT | Study | Timeline: adapt accessible keyboard and transport interactions without replacing the engine. |
| 77 | [visjs/vis-timeline](https://github.com/visjs/vis-timeline/tree/b5f030de2cffb3af91e5a59782bc8c9be4557398) | Review | Defer | Timeline: generic event timelines need custom sample-accurate boundary semantics. |
| 78 | [taye/interact.js](https://github.com/taye/interact.js/tree/a993eb8cd5cbc65f3a19e45ee24b7fedc026174f) | MIT | Study | Timeline: compare touch resize and snapping; add only if native interactions fail usability tests. |
| 79 | [fabricjs/fabric.js](https://github.com/fabricjs/fabric.js/tree/ab604137e04dd7d3d566462a6b27f5863e37c60b) | MIT | Defer | World: interactive object editing introduces a second scene graph; need layer serialization first. |
| 80 | [konvajs/konva](https://github.com/konvajs/konva/tree/bf1927c1cfec7f47eb608a470aff6ca99dd09aa9) | Review | Defer | World: competing retained canvas graph; choose at most one if transforms become essential. |

## G. Generative and assisted visual assets

| # | Candidate (source snapshot) | License signal | Decision | VidLyrics use or reason not to integrate |
|---:|---|---|---|---|
| 81 | [Comfy-Org/ComfyUI](https://github.com/Comfy-Org/ComfyUI/tree/f99de883d5e65317c7f4a4b617b5aa7936622029) | GPL-3.0 | Pilot | World: opt-in job with one approved workflow returning an image asset, never arbitrary custom nodes. |
| 82 | [huggingface/diffusers](https://github.com/huggingface/diffusers/tree/ed32672706fec20ddac3a090c5a8290b3fd313cb) | Apache-2.0 | Defer | World: alternate provider behind the same image job contract, not a second initial backend. |
| 83 | [invoke-ai/InvokeAI](https://github.com/invoke-ai/InvokeAI/tree/b9023d3d4fa436e31ffae3b895c9f1f6a74423ab) | Apache-2.0 | Study | World: compare asset history, seeds and reuse; keep project media local by default. |
| 84 | [AUTOMATIC1111/stable-diffusion-webui](https://github.com/AUTOMATIC1111/stable-diffusion-webui/tree/82a973c04367123ae98bd9abdf80d9eda9b910e2) | AGPL-3.0 | Defer | World: full image UI and plugin ecosystem unnecessary for a background provider. |
| 85 | [lllyasviel/Fooocus](https://github.com/lllyasviel/Fooocus/tree/ae05379cc97bc4361ec8b4ec90193dab21be763f) | GPL-3.0 | Defer | World: preset-driven generation overlaps the one-workflow ComfyUI pilot. |
| 86 | [Acly/krita-ai-diffusion](https://github.com/Acly/krita-ai-diffusion/tree/e6ac09e163507e7cc4c522f57177ae621968b105) | GPL-3.0 | Study | World: reference non-destructive image variations; import selected result as a new asset. |
| 87 | [facebookresearch/segment-anything](https://github.com/facebookresearch/segment-anything/tree/dca509fe793f601edb92606367a655c15ac00fdf) | Apache-2.0 | Defer | World: segmentation masks require layer compositing and separately approved weights. |
| 88 | [danielgatis/rembg](https://github.com/danielgatis/rembg/tree/991927b77667946dab59c50df31f7d4640e80457) | MIT | Defer | World: future alpha cutouts; verify the chosen model, not just wrapper terms. |
| 89 | [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN/tree/a4abfb2979a7bbff3f69f58f58ae324608821e27) | BSD-3-Clause | Defer | World: upscale low-resolution artwork only on request after measuring artifacts and cost. |
| 90 | [lllyasviel/ControlNet](https://github.com/lllyasviel/ControlNet/tree/ed85cd1e25a5ed592f7d8178495b4483de0331bf) | Apache-2.0 | Defer | Director: consistent compositions may need conditioning; requires an approved generation provider first. |

## H. Typography and subtitle quality

| # | Candidate (source snapshot) | License signal | Decision | VidLyrics use or reason not to integrate |
|---:|---|---|---|---|
| 91 | [foliojs/fontkit](https://github.com/foliojs/fontkit/tree/74ecfacc9ee45873255f88ac16ed6d3c596e2314) | MIT | Study | Type: assess font metadata and fallback coverage before custom font import. |
| 92 | [harfbuzz/harfbuzz](https://github.com/harfbuzz/harfbuzz/tree/0880a1146098d5fa3f07bde886707bb32478e120) | Review | Study | Type: validate shaped multilingual text against browser output before adding a shaping binary. |
| 93 | [opentypejs/opentype.js](https://github.com/opentypejs/opentype.js/tree/5d65b6dcfab5115f90d375f8ba6b7942fdaa0138) | MIT | Defer | Type: outline extraction for path animation only after font embedding rights are tracked. |
| 94 | [formkit/auto-animate](https://github.com/formkit/auto-animate/tree/fc43d3030b8adc8df0c4d78fd4297122753e9765) | MIT | Defer | Timeline: DOM list transitions do not appear in encoded frames. |
| 95 | [motion-canvas/motion-canvas](https://github.com/motion-canvas/motion-canvas/tree/7b91435c301d530351dcf5ebb91dd139c002e405) | MIT | Study | Type: compare deterministic reveal sequences; translate ideas into the shared renderer. |

## I. Automation and quality assurance

| # | Candidate (source snapshot) | License signal | Decision | VidLyrics use or reason not to integrate |
|---:|---|---|---|---|
| 96 | [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph/tree/c6335a4255dc1d8abc25a7677f9c072c7ab27b9c) | MIT | Defer | Director: start with a typed, cancellable sequence; avoid an agent runtime for fixed steps. |
| 97 | [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI/tree/56c26a7fb3ece62c64de52e8b4228d15c9c81492) | MIT | Defer | Director: several agents add latency and conflicting plans; one reviewed plan per song. |
| 98 | [BerriAI/litellm](https://github.com/BerriAI/litellm/tree/edf8d5c57eae874ab17a9385e5608c5134af3d75) | Review | Defer | Director: use only when multiple approved text providers warrant a gateway. |
| 99 | [microsoft/playwright](https://github.com/microsoft/playwright/tree/049226728d2da8054db18b04782a9848b755855e) | Apache-2.0 | Keep | Render: extend real browser import, reopen and encoded-download tests. |
| 100 | [vitest-dev/vitest](https://github.com/vitest-dev/vitest/tree/8b0ca603a8342aff1851a37ce0c0ae8cf4fa6b56) | MIT | Keep | Timeline: extend deterministic unit tests for alignment, plan patches, frame sampling and rollback. |

### Link corrections

These are **separate verified repositories**, not silent substitutions or changes to the counts: [CTC forced aligner](https://github.com/MahmoudAshraf97/ctc-forced-aligner) for #25, [Open-Unmix PyTorch](https://github.com/sigsep/open-unmix-pytorch) for #30, and the [Rive web runtime](https://github.com/rive-app/rive-wasm) for #49. Do not infer rights to weights or artwork from those code repositories. Leave Jitter (#73) and Twick (#74) unapproved pending a confirmed upstream.
