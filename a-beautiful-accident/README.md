# A Beautiful Accident

A 60-second motion-graphics short about a university love story. An outgoing boy and a shy girl meet by accident in the canteen. The film is drawn entirely in code: characters, set, camera moves, lighting and soundtrack. There are no image, video or audio assets.

- `index.html` is the player. Open it in a browser and press play (sound on). You can scrub by scene, and each shot-list card jumps to its scene.
- `film.js` is the film. Every frame is a pure function of time `t`, so the player and the renderer draw exactly the same thing.
- `render.mjs` renders `a-beautiful-accident.mp4` (1920×1080, 30 fps, AAC) using headless Chromium and ffmpeg.
- `a-beautiful-accident.mp4` is the rendered film.

## Timeline

| Time | Scene | What happens |
| --- | --- | --- |
| 0–8 s | The boy | Establishing wide shot and title. Quick cuts as he and his friend joke and laugh. Warm grade, ukulele groove. |
| 8–16 s | The girl | She walks in with lunch in one hand and her phone in the other, eyes down. Slower, closer shots and a cooler grade. The music softens. |
| 16–22 s | The accident | They collide: a white flash, camera shake, and slow motion as her phone, lunch box, juice, notebook and pencil fly. The music cuts out and the items clatter. |
| 22–33 s | First words | "Oh, sorry! I didn't mean to— sorry, sorry." / "It's okay. Don't worry." They kneel to pick things up, and their hands almost meet over her phone. |
| 33–43 s | The glance | Close-ups as their eyes meet. Letterbox bars come in, the canteen blurs into bokeh, and a gentle piano theme begins. |
| 43–53 s | A small connection | "Here you go." / "Thank you." Shy smiles. His friend calls out and he lingers. |
| 53–60 s | Ending | They walk opposite ways and both glance back. The camera pulls out wide over the closing lines. |

## How it's built

- **Camera and depth.** Each layer has a depth scale `s`. A point at depth `s` projects to `W/2 + (X − fx)·z·s`, which gives parallax, a perspective checker floor and consistent framing from a single camera `{fx, fy, z}`. Background layers are blurred with a mip chain based on shot depth of field.
- **Characters.** Each character is a small rig: a walk cycle with auto-grounding, a kneel/crouch pose, two-bone IK arms driven by timed hand targets, and a face with eyelids, gaze, brows, mouth shapes, blush and blinks.
- **Props.** Props follow a phase list: held in a hand, resting on another prop, or in ballistic flight with a bounce. Flight runs on a slow-motion story clock, and the landing sounds are scheduled from the same physics.
- **Sound.** The Web Audio API synthesizes the soundtrack: a strummed ukulele with drums and a glockenspiel hook, a formant-filtered "babble" for canteen chatter, impact and clatter effects, and an additive-sine piano theme in F. The same score renders offline for the MP4.

## Re-rendering

```sh
npm i -D playwright            # or use a global install
FFMPEG=/path/to/ffmpeg node render.mjs          # full film
node render.mjs --stills 4,17,38,56             # a few JPEG stills
```
