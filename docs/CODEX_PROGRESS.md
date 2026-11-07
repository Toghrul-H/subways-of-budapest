# Codex progress

This record covers the source audit, initial redesign and final portfolio pass. Start here before changing rules, station data or the publication setup.

## Source and baseline

The dedicated clone is `subways-of-budapest` on `main`, tracking `origin/main` at [Toghrul-H/subways-of-budapest](https://github.com/Toghrul-H/subways-of-budapest). The starting commit was `f4aa4095d451070a1c78989de7cdb111515149b9`. The original coursework is the `Project` folder under the university web-programming materials. It has no Git metadata. Its HTML, CSS, JavaScript and all three JSON files match the starting commit after normalizing line endings and trailing whitespace. The course declaration and academic identifier remain with the original coursework.

`Project copy` and `Project Core Task` have smaller implementations. The archive of `Project` has the same application and equivalent data. `Assignment_2` and `Assignment_11` are separate implementations. The source selection used the direct match to the GitHub baseline. The original coursework, archives, and all three repository JSON files stayed unchanged.

## Architecture and rules

- Vanilla HTML/CSS and JavaScript modules. `index.html` provides the menu, board, results, navigation confirmation and station template. `style.css` handles the transit theme, responsive grid, focus styles and reduced-motion rules.
- `script.js` fetches the original 53 stations and four lines, drives the round and deck state, renders the board and HUD, and stores scores in `subways_scores`. The application needs no runtime npm dependencies.
- `rules.mjs` contains pure geometry, route-origin and scoring functions. Candidate highlights and actual connections use the same validator. Strict interior crossings and collinear overlaps are blocked while shared endpoints remain legal.
- M1–M4 play once each in shuffled order. The 11-card deck has A–D and Joker for each side/center type, plus a center Switch. Switch counts as used and draws a replacement. It permits one branch from a visited station on the active line. Draw and Skip lock at five cards of one type. The round can also advance after eight cards are used.
- Undo keeps the used card spent and restores the endpoint saved when the removed segment was placed. Round points multiply district count by the largest district station count, then add crossings. The final total adds the existing rail lookup and bonuses of 2, 5 and 9 for stations shared by two, three and four lines.

## Work completed

| Pass | Changes |
| --- | --- |
| Initial redesign | New transit menu, responsive grid, HUD, labelled input and local leaderboard. Loading failures and malformed score storage are handled. Empty rounds score zero. Completed games cannot save twice. |
| Final gameplay | Dedicated completion screen with player, time, score, four line scores, and bonus breakdown. Added Play again and Main menu. In-progress Restart and Leave use a confirmation dialog. Timer, card, selection and board state reset across runs. |
| Final UI | Legal destination highlighting, instructions for the current turn, Switch and route feedback, line transition messages and a short reduced-motion-aware card animation. |
| Logic and checks | Extracted route validation and scoring, added explicit collinear overlap checking, and fixed Undo after a Switch branch. Added Node tests and expanded the original Playwright runner. |
| Publication | Added the CI workflow, pinned optional test tooling, prepared static hosting with `.nojekyll`, and documented authentic screenshots and GIF. Local test outputs and raw frames are ignored. |

## Verification

- Original browser evidence exposed a 1023 px layout viewport in 360 px emulation and a `NaN` final score for runs with empty rounds. The first redesign resolved both. Its smoke suite passed again before the final pass.
- `npm run check` and `npm test` passed locally with Node.js 24.21.0. The rules suite has **15 passing tests**, with no failures or skips.
- The final Playwright suite passed in headless Edge. It exercised keyboard start, card and Switch behavior, invalid and valid routes, Undo, the fifth-card lock, four rounds, saved results, replay, confirmation cancellation, restart, menu navigation and fault handling. The deterministic M1-only run scored 2, with zero points on the other three lines. An additional branch check verifies that Undo restores the earlier endpoint without returning the spent card.
- Browser checks covered 1920×1080, 1440×900, 1366×768, 1024 and 768 px desktop/tablet viewports, and 390 and 360 px narrow viewports. The runner checked station alignment, HUD separation, control dimensions and horizontal overflow. Touch route placement ran at 360 px. Results were also checked at 390 px. The browser server mounted the site under `/subways-of-budapest/`.
- The [capture gallery](screenshots/README.md) links real before/after evidence, the release views and a 10.5-second GIF from two actual route placements. No raw frame captures belong in Git.

## Resume

From the clone, run `npm ci`, `npm run check`, `npm test`, `npx playwright install chromium`, and `npm run test:browser`. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` only when using an existing browser executable. To refresh release screenshots, run `npm run test:browser -- --screenshots`. Add `--gif-frames` to record timestamped PNGs under ignored `test-results/`. Use `python -m http.server 8000 --bind 127.0.0.1` for manual play.

## Remaining checklist

- [ ] Enable GitHub Pages from `main` and the repository root if a hosted game is wanted, then verify the deployed URL and JSON requests.
- [ ] Check Firefox, Safari, physical touch hardware and assistive technology. Headless viewport emulation covers responsive layout and basic interactions.
- [ ] Consider spatial keyboard navigation or map zoom for narrow screens. Preserve coordinates, cards and existing scoring.
- [ ] Confirm rights to any course-provided material before choosing a project license. The checked-in SVGs were drawn for this project. No commercial artwork is bundled.
