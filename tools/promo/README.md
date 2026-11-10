# Promo video tooling (parked)

Builds the 40 s 9:16 "coming soon" promo: AI shots (Higgsfield Seedance 2.5) + real screen recordings in a
phone frame + captions + end card + beat + spray-can sound logo + voice line ("Spray Path. Follow the art.
Coming soon", Higgsfield voice Maeve).

- `cut.json`: the edit (segments, captions, timings). `phone: true` segments are screen recordings.
- `assemble.py cut.json out.mp4 1|0`: renders the video (1 = with beat.wav, 0 = SFX + voice only).
- `caps.js` → `cap/*.png` and `bezel.png` (needs playwright + the Chromium at /opt/pw-browsers);
  `render.js endcard.html frames 7 30` → PNG frames → `endcard.mp4`.
- `beat.py out.wav 40 6 33` (duration, drop, breakdown); `spray.py out.wav` (rattle + hiss + chime bed).
- AI clips s1–s7 and the voice wav were Higgsfield jobs 9e1740ae, 8ee6a237, 8d01db36, ce1ae22a, c719203b,
  aac06f3e, ffa3b1cf, e55f6e09 (download from the Higgsfield library into clips/).
Last delivered: SprayPath-promo-v2-9x16.mp4 (10 Nov 2026).
