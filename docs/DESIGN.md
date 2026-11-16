# Game design — what we took from research, and where it lives

ONE DEGREE's rule: **the actions that win the mission are the actions that show the
science** (intrinsic integration — Habgood & Ainsworth; Ke 2016). Below, each principle,
the source, and the concrete place it is applied. We borrowed principles only — no
assets, text, music or visual identity from any game.

| Principle | Source | Applied in ONE DEGREE |
|---|---|---|
| Exploration should answer a question, and each answer should raise the next one; knowledge is the reward | Outer Wilds (Mobius Digital interview, GameSkinny) | Mission 01 opens with a question from mission control; the S-1 discovery ends with a new one ("can these places also see Earth?") that leads to Mission 02. Field notes log *questions* as well as results. |
| Observe → hypothesise → measure → interpret → decide; mistakes are informative, not punished | Kerbal Space Program research (Computers & Education, 2022) | Before scanning S-1 the player **predicts** more / same / less sunlight. After measuring, the field computer shows whether the prediction held and why; a wrong site choice gets a hint, never a penalty. |
| Landmarks, purposeful base layout, signals that pull you to the next place, small mysteries | Subnautica (GDC 2018 talk) | Distinct silhouettes (dome habitat, L-shaped Mission Control, geodesic lab, dish, rover bay ring), amber path lights, the S-1 light beam visible from the base, the hidden-Sun marker. |
| Real data made spatial and time-based; time controls change what you see | NASA's Eyes | Scrubbing time moves the Horizons Sun, the tracking arrays and dish; the Sun's 30-day path and the LOLA horizon are drawn *in the 3D sky* over the real ridges. |
| Clear goals, immediate feedback, sense of control, appropriate challenge | GameFlow (Sweetser & Wyeth 2005) | One objective card with distance and arrow; every action gives a result in plain words; progressive controls (3 keys at first); speeds, sensitivity and graphics are adjustable. |
| Progressive disclosure | Apple HIG; onboarding guidance (Apple, Roblox) | Instruments open at *Simple* (3 answers + 1 conclusion), with *Scientific details* and *Advanced* one click away — same numbers at every level. |
| Accessibility basics | Game Accessibility Guidelines | Readable sizes, non-colour status (✓ / ! / ✗ and words), reduced camera motion (head bob off), lighting modes, skippable tutorial, direct planner entry from the opening screen, touch controls. |
| Performance is part of the design | Cesium `Scene` docs; three.js | Measured before/after; graphics presets; render distance; adaptive resolution (see PERFORMANCE in README and docs/TESTING.md). |

## The five-minute arc
0–10 s flyover + one-line premise · 10–30 s three keys and one visible objective ·
30–60 s first measurement in plain words · 1–3 min rover drive with a reason to go ·
3–5 min predict → measure → see the ridge → compare → decide → learn why → new question.

## The discovery moment
At S-1, after measuring, the view turns toward the Sun's azimuth: the NASA LOLA horizon
(teal) traces the actual ridge, the Sun's 30-day path is drawn (amber = sunlit, red =
blocked) and a marker shows the Sun hiding behind the ridge — e.g. "a ridge 140 m away
rises to 11.4°; the Sun is at 1.4°". All values come from the same Horizons × LOLA
analysis the planner uses.
