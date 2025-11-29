🚇 Subways of Budapest – Core Edition (Extended)

Subways of Budapest is an extended, browser-based strategy game inspired by Next Station: London.
You build neon metro lines across Budapest, following strict placement rules, card mechanics, scoring logic, and advanced constraints such as switch cards, center/side card balancing, and round-locking.

This version includes a fully rewritten rendering system, polished UI/UX, and full support for real-time scoring, localStorage-based high scores, and geometric validation.

🧩 Game Overview

You play four rounds — one for each Budapest metro line (M1–M4).
Each round:

You draw 8 cards (A–D letters, Jokers, Switch)

You extend your metro line from the active endpoint

Segments must be:

straight or 45° diagonal

not intersecting other segments

not passing through stations

not overlapping previous lines

not forming loops

You gain points based on:

District diversity (PK)

Most common district (PM)

Buda ↔ Pest crossings (PD)

Final bonuses for shared stations across multiple lines

Special points from train stations

Everything follows the authentic scoring model of the tabletop original.

✨ Extended Features (Beyond Core Rules)

This version implements several advanced mechanics:

1. Side / Center Card Types

Each card has a cardType:

side

center

The HUD counts them:

Side X · Center Y


If 5 cards of the same type appear → round is locked until the player clicks End Round.

2. SWITCH Card

A special card that:

enables branching from any visited station

acts as a center card for type-counting

instantly auto-draws the next real card

expires immediately after one segment

3. Real Geometry Collision Detection

The system prevents illegal moves:

crossing another segment

passing through stations

reusing the same segment between stations

revisiting a station on the same line (loop rule)

All geometry is calculated using low-level line intersection formulas.

4. LocalStorage High Scores

Scores are saved automatically:

[
  { "name": "Player1", "score": 143, "time": 295 },
  ...
]


Displayed in the menu, with sorting.

🗂️ Project Structure
SubwaysOfBudapest/
│
├── index.html        # UI layout + screens (menu + game)
├── style.css         # Full neon UI theme, grid board styling
├── script.js         # Game logic (1500+ lines)
│
├── stations.json     # Station coordinates, types, sides, districts
├── lines.json        # M1–M4 metadata (color, start id)
│
└── README.md

🎮 How to Play

Open index.html in your browser

Enter your player name

Press Start Game

Draw cards and extend your line following constraints

Use:

Draw

Skip

Undo

End Round (if round locked)

Continue for all 4 lines

View final score + saved highscores

No installation required.
Runs on Chrome, Firefox, Edge, Safari.

🧠 Core Logic Implemented
Rendering

CSS Grid station layout

Dynamic line blending (multi-line stations)

Segment drawing via DOM transforms

Neon effects, highlights, pulses, glows

Gameplay Engine

State machine for rounds, lines, cards

Geometry validation (intersections, overlaps, path correctness)

Switch card logic

Segment tracking + endpoint updates

Full undo system

Scoring System

Implements PK, PM, PD, train scoring, and final combo bonuses.

🚀 Technologies Used
Tech	Use
HTML5	Structure, template rendering
CSS3	Dark neon UI, animations, adaptive grid
JavaScript (Vanilla ES6)	Entire game logic (state machine + rendering + scoring)
localStorage	High score persistence
JSON	Station + line data
👤 Author

Toghrul Hasanli
Frontend Developer
toghrulhasanli2@gmail.com