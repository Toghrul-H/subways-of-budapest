// ============================================================
// Subways of Budapest – Core Edition (Extended Version)
// Extra Tasks:
// 1) Card type system (center/side)
// 2) Round ends when 5 of same type appeared (End Round button)
// 3) Switch card (branch from a visited station)
// 4) LocalStorage high scores
// ============================================================

import { canStartRoute, roundScore, routeError, scoreBreakdown } from "./rules.mjs";

const qs  = (s, e=document) => e.querySelector(s);
const qsa = (s, e=document) => [...e.querySelectorAll(s)];

const CONST = {
  GRID: 10,
  CARDS_PER_ROUND: 8,
  LS_KEY: "subways_scores"
};

const state = {
  stations: [],
  stationById: new Map(),
  lines: [],
  lineOrder: [],
  currentLine: null,
  round: 0,
  deck: [],
  drawn: [],
  segments: [],
  scores: [],
  selected: null,
  activeEndpoint: null,
  switchMode: false,
  centerCount: 0,
  sideCount: 0,
  roundLocked: false,   // when 5 of same type appeared
  finished: false,
  player: "",
  startTime: null,
  timerHandle: null
};

init();

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------
async function init() {
  renderHighScores();
  try {
    [state.stations, state.lines] = await Promise.all(
      ["stations.json", "lines.json"].map(async file => {
        const response = await fetch(file);
        if (!response.ok) throw new Error(file + ": " + response.status);
        const data = await response.json();
        if (!Array.isArray(data) || !data.length) throw new Error(file + ": missing data");
        return data;
      })
    );
  } catch {
    const error = qs("[data-load-error]");
    error.textContent = "Station or line data could not load. Serve the project over HTTP and reload.";
    error.classList.remove("hidden");
    return;
  }
  state.stationById = new Map(state.stations.map(station => [station.id, station]));

  qs("[data-start-form]").addEventListener("submit", event => {
    event.preventDefault();
    startGame();
  });
  qs('[data-action="start"]').disabled = false;
  qs('[data-action="draw"]').addEventListener("click", drawCard);
  qs('[data-action="skip"]').addEventListener("click", skipCard);
  qs('[data-action="undo"]').addEventListener("click", undoSegment);
  qs('[data-action="end-round"]').addEventListener("click", endRoundManually);
  qs('[data-action="restart"]').addEventListener("click", () => confirmNavigation(true));
  qs('[data-action="leave"]').addEventListener("click", () => confirmNavigation(false));
  qs('[data-action="again"]').addEventListener("click", () => beginGame(state.player));
  qs('[data-action="results-menu"]').addEventListener("click", showMenu);

  window.addEventListener("resize", renderSegments);

}

// ------------------------------------------------------------
// START GAME
// ------------------------------------------------------------
function startGame() {
  const name = qs("#playerName").value.trim();
  if (!name) {
    toast("❌ Please enter a player name.","error");
    return;
  }

  beginGame(name);
}

function resetSession() {
  clearInterval(state.timerHandle);
  Object.assign(state, {
    player: "", round: 0, lineOrder: [], currentLine: null, scores: [], segments: [],
    deck: [], drawn: [], selected: null, activeEndpoint: null, switchMode: false,
    centerCount: 0, sideCount: 0, roundLocked: false, finished: false,
    startTime: null, timerHandle: null
  });
  for (const selector of ["[data-toast]", "[data-scores]", '[data-layer="stations"]',
    '[data-layer="segments"]', '[data-result="lines"]']) {
    qs(selector).replaceChildren();
  }
  qs("[data-final]").textContent = "Final Score: –";
  qs('[data-hud="timer"]').textContent = "00:00";
}

function showScreen(screen) {
  qsa("[data-screen]").forEach(element => element.classList.toggle("hidden", element.dataset.screen !== screen));
  window.scrollTo(0, 0);
}

function showMenu() {
  resetSession();
  renderHighScores();
  showScreen("menu");
  qs("#playerName").focus({ preventScroll: true });
}

function confirmNavigation(restart) {
  const dialog = qs("[data-confirm]");
  dialog.returnValue = "";
  qs("[data-confirm-title]").textContent = restart ? "Restart this game?" : "Return to the main menu?";
  qs("[data-confirm-action]").textContent = restart ? "Restart" : "Leave game";
  dialog.addEventListener("close", () => {
    if (dialog.returnValue !== "confirm") return;
    if (restart) beginGame(state.player);
    else showMenu();
  }, { once: true });
  dialog.showModal();
}

function beginGame(name) {
  resetSession();
  state.player = name;

  state.lineOrder   = shuffle(state.lines.map(l => l.id));
  state.currentLine = getLine(state.lineOrder[0]);

  newDeck();
  state.startTime = Date.now();

  state.activeEndpoint = state.currentLine.start;
  state.selected = null;

  showScreen("game");
  qs('[data-hud="player"]').textContent = state.player;

  showCard(null);
  updateHUD();
  updateTimer();
  renderStations();
  renderSegments();
  highlightEndpoints();
  updateRoundLockUI();

  state.timerHandle = setInterval(updateTimer, 1000);
  qs('[data-action="draw"]').focus({ preventScroll: true });
}

// ------------------------------------------------------------
// TIMER
// ------------------------------------------------------------
function updateTimer() {
  if (!state.startTime) return;
  qs('[data-hud="timer"]').textContent = formatTime(elapsedTime());
}

function elapsedTime() {
  return Math.max(0, Math.floor((Date.now() - state.startTime) / 1000));
}

// ------------------------------------------------------------
// RENDER STATIONS
// ------------------------------------------------------------
function renderStations() {
  const layer = qs('[data-layer="stations"]');
  layer.innerHTML = "";

  const tpl = qs("#tpl-station");

  for (const st of state.stations) {
    const el = tpl.content.firstElementChild.cloneNode(true);
    el.dataset.id = st.id;
    el.setAttribute("aria-label", `Station ${st.id}, ${st.type === "?" ? "wildcard" : st.type}, ${st.side}${st.train ? ", rail" : ""}`);
    el.style.gridColumn = st.x + 1;
    el.style.gridRow    = st.y + 1;

    const mark = qs("[data-mark]", el);
    mark.textContent = st.type;

    if (st.train) {
      el.dataset.rail = "";
    }

    el.addEventListener("click", () => stationClick(st.id));
    layer.appendChild(el);
  }

  highlightEndpoints();
  blendStationColors();
}

// ------------------------------------------------------------
// RENDER SEGMENTS (DOM-based coordinates)
// ------------------------------------------------------------
function renderSegments() {
  const segLayer = qs('[data-layer="segments"]');
  segLayer.innerHTML = "";

  const segRect = segLayer.getBoundingClientRect();

  for (const seg of state.segments) {
    const aEl = qs(`.station[data-id="${seg.a}"]`);
    const bEl = qs(`.station[data-id="${seg.b}"]`);
    if (!aEl || !bEl) continue;

    const aRect = aEl.getBoundingClientRect();
    const bRect = bEl.getBoundingClientRect();

    const A = {
      x: aRect.left + aRect.width  / 2 - segRect.left,
      y: aRect.top  + aRect.height / 2 - segRect.top
    };
    const B = {
      x: bRect.left + bRect.width  / 2 - segRect.left,
      y: bRect.top  + bRect.height / 2 - segRect.top
    };

    const dx  = B.x - A.x;
    const dy  = B.y - A.y;
    const len = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx) * (180 / Math.PI);

    const div = document.createElement("div");
    div.className = "segment";
    div.style.color = getLine(seg.lineId).color;
    div.style.width = `${len}px`;
    div.style.transformOrigin = "left center";
    div.style.transform = `translate(${A.x}px,${A.y}px) rotate(${ang}deg)`;

    segLayer.appendChild(div);
  }

  blendStationColors();
}

// ------------------------------------------------------------
// BLEND COLORS (stations passed by multiple lines)
// ------------------------------------------------------------
function blendStationColors() {
  for (const s of state.stations) {
    const node = stationBtn(s.id);
    if (!node) continue;

    const mark = node.querySelector(".station-mark");
    const involved = state.segments.filter(x => x.a === s.id || x.b === s.id);

    if (!involved.length) {
      mark.style.removeProperty("--station-route");
      continue;
    }

    const colors = [...new Set(involved.map(x => getLine(x.lineId).color))];
    mark.style.setProperty("--station-route", mixColors(colors));
  }
}

// ------------------------------------------------------------
// STATION CLICK + SWITCH / ACTIVE ENDPOINT LOGIC
// ------------------------------------------------------------
function stationClick(id) {
  if (state.finished) return;
  const card = currentCard();
  if (!card) {
    toast("⚠️ Draw a card first","warn");
    return;
  }

  const lineId = state.currentLine.id;

  // --------------------------------------------------------
  // FIRST CLICK
  // --------------------------------------------------------
  if (state.selected == null) {

    if (!canStartRoute(id, state.activeEndpoint, state.switchMode, getVisitedStations(lineId))) {
      toast(state.switchMode
        ? "With Switch, you must start from a visited station."
        : "Start from the active endpoint.", "warn");
      return;
    }

    state.selected = id;
    highlightEndpoints();
    pulse(id);
    return;
  }

  // --------------------------------------------------------
  // SECOND CLICK: try to build segment
  // --------------------------------------------------------
  const a = state.selected;
  const b = id;
  if (a === b) {
    state.selected = null;
    highlightEndpoints();
    return;
  }

  pulse(id);

  if (validateSegment(a, b, card, lineId)) {
    addSegment(a, b, lineId);
    toast(`${state.currentLine.name} route extended.`, "success");

    // after placing, new active endpoint becomes the target
    state.activeEndpoint = b;
    state.selected = null;
    highlightEndpoints();

    // SWITCH mode is single-use: turn off after building one segment
    if (state.switchMode) state.switchMode = false;

    markCardUsed();
    checkRoundEnd();
    autoDrawIfNone();
  } else {
    // invalid: cancel selection, but switchMode still stays until card used/skip
    state.selected = null;
    highlightEndpoints();
  }
}

function pulse(id) {
  const node = stationBtn(id);
  if (!node) return;
  node.classList.add("station--selected");
  setTimeout(() => node.classList.remove("station--selected"), 600);
}

// ------------------------------------------------------------
// VALIDATION RULES (geometry, no loops, no overlaps)
// ------------------------------------------------------------
const ROUTE_MESSAGES = {
  station: "Choose a different destination station.",
  card: "Destination must match the card.",
  angle: "Segments must be straight or 45° diagonal.",
  intermediate: "A segment cannot pass through an intermediate station.",
  crossing: "Segments cannot cross or overlap.",
  reuse: "That station pair is already connected.",
  loop: "This line cannot revisit a station."
};

function routeIssue(a, b, card, lineId) {
  return routeError(state.stationById, state.segments, a, b, card, lineId);
}

function validateSegment(a, b, card, lineId) {
  const issue = routeIssue(a, b, card, lineId);
  if (issue) toast(ROUTE_MESSAGES[issue], "error");
  return !issue;
}

function addSegment(a, b, lineId) {
  state.segments.push({ a, b, lineId, previousEndpoint: state.activeEndpoint });
  renderSegments();
}

// ------------------------------------------------------------
// HELPER: VISITED STATIONS PER LINE (for SWITCH mode)
// ------------------------------------------------------------
function getVisitedStations(lineId) {
  const segs = state.segments.filter(s => s.lineId === lineId);
  const visited = new Set();
  visited.add(getLine(lineId).start);
  for (const s of segs) {
    visited.add(s.a);
    visited.add(s.b);
  }
  return visited;
}

// ------------------------------------------------------------
// GENERIC HELPERS
// ------------------------------------------------------------
function stationBtn(id) { return qs(`.station[data-id="${id}"]`); }
function getLine(id)    { return state.lines.find(l => l.id === id); }

function shuffle(a) {
  return a
    .map(x => [x, Math.random()])
    .sort((a,b) => a[1] - b[1])
    .map(x => x[0]);
}

function mixColors(colors) {
  if (colors.length === 1) return colors[0];
  let r=0,g=0,b=0;
  for (const c of colors) {
    const v = parseInt(c.slice(1),16);
    r += v >> 16;
    g += (v >> 8) & 255;
    b += v & 255;
  }
  r = Math.round(r/colors.length);
  g = Math.round(g/colors.length);
  b = Math.round(b/colors.length);
  return `rgb(${r},${g},${b})`;
}

function toast(msg,type="error") {
  const box = document.createElement("div");
  box.className = `toast ${type}`;
  box.textContent = msg;
  const cont = qs("[data-toast]");
  if (cont.children.length >= 2) cont.firstElementChild.remove();
  cont.appendChild(box);
  setTimeout(() => box.remove(), 3000);
}

// ------------------------------------------------------------
// CARD TYPE HELPERS
// ------------------------------------------------------------
function incrementTypeCounters(card) {
  if (!card.cardType) return;
  if (card.cardType === "center") state.centerCount++;
  else if (card.cardType === "side") state.sideCount++;
}

function checkTypeLimitReached() {
  if (state.roundLocked) return;
  if (state.centerCount >= 5 || state.sideCount >= 5) {
    state.roundLocked = true;
    updateRoundLockUI();
    highlightEndpoints();
    toast("⚠️ Five cards of same type appeared. Click End Round to continue.","warn");
  }
}

function updateTypeHUD() {
  const typeCountsEl = qs('[data-hud="type-counts"]');
  if (typeCountsEl) {
    typeCountsEl.textContent = `Side ${state.sideCount} · Center ${state.centerCount}`;
  }
}

// ------------------------------------------------------------
// DECK + CARDS
// ------------------------------------------------------------
function newDeck() {
  // 11 cards with cardType side/center
  const base = [
    { t:"A",      cardType:"side"   },
    { t:"B",      cardType:"side"   },
    { t:"C",      cardType:"side"   },
    { t:"D",      cardType:"side"   },
    { t:"JOKER",  cardType:"side"   },
    { t:"A",      cardType:"center" },
    { t:"B",      cardType:"center" },
    { t:"C",      cardType:"center" },
    { t:"D",      cardType:"center" },
    { t:"JOKER",  cardType:"center" },
    { t:"SWITCH", cardType:"center" }
  ];
  state.deck  = shuffle(base);
  state.drawn = [];
  state.centerCount = 0;
  state.sideCount   = 0;
  state.roundLocked = false;
  state.switchMode  = false;
  updateRoundLockUI();
  updateTypeHUD();
}

// main draw function
function drawCard() {
  if (state.roundLocked) return;
  if (currentCard()) return;
  if (!state.deck.length) newDeck();

  const next = state.deck.pop();

  // SWITCH: special handling – counts as center, then auto-draw letter
  if (next.t === "SWITCH") {
    // store SWITCH in history as used immediately
    state.drawn.push({ card: next, used: true });
    state.switchMode = true;

    // type counting: SWITCH is center
    incrementTypeCounters(next);
    updateTypeHUD();
    // do NOT check type-limit yet; let the real letter card trigger it
    // auto-draw the actual letter/Joker card
    drawCard(); // will handle showCard + type-limit for the second card
    return;
  }

  // normal / Joker card
  state.drawn.push({ card: next, used: false });
  incrementTypeCounters(next);
  showCard(next);
  updateHUD();
  updateTypeHUD();
  checkTypeLimitReached();
}

function skipCard() {
  if (state.roundLocked) return;
  const x = state.drawn.at(-1);
  if (!x || x.used) return;
  x.used = true;
  showCard(null);
  // skipping also cancels switchMode if active
  state.switchMode = false;
  state.selected = null;
  highlightEndpoints();
  updateHUD();
  checkRoundEnd();
  autoDrawIfNone();
}

function markCardUsed() {
  const x = state.drawn.at(-1);
  if (x && !x.used) x.used = true;
  // building a segment consumes the card and ends switchMode
  state.switchMode = false;
  showCard(null);
  updateHUD();
}

function currentCard() {
  const x = state.drawn.at(-1);
  return x && !x.used ? x.card : null;
}

function usedCount() {
  return state.drawn.filter(d => d.used).length;
}

function autoDrawIfNone() {
  if (state.roundLocked) return;
  if (!currentCard() && usedCount() < CONST.CARDS_PER_ROUND) {
    drawCard();
  }
}

function showCard(c) {
  const face = qs('[data-hud="card"]');
  const typeSpan = qs('[data-hud="card-type"]');
  if (!face || !typeSpan) return;
  qs('[data-hud="switch"]').classList.toggle("hidden", !(c && state.switchMode));

  if (!c) {
    delete face.dataset.cardType;
    face.textContent = "–";
    typeSpan.textContent = "–";
  } else {
    face.dataset.cardType = c.cardType;
    if (c.t === "SWITCH") {
      face.textContent = "↔";
    } else {
      face.textContent = c.t;
    }
    typeSpan.textContent = c.cardType === "center" ? "CENTER" : "SIDE";
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      face.getAnimations().forEach(animation => animation.cancel());
      face.animate([{ opacity: .55, transform: "translateY(-3px)" }, { opacity: 1, transform: "none" }],
        { duration: 180, easing: "ease-out" });
    }
  }
  updateRoundLockUI();
  highlightEndpoints();
}

function updateHUD() {
  const used = usedCount();
  const cardsEl = qs('[data-hud="cards"]');
  if (cardsEl) {
    cardsEl.textContent = `${used} / ${CONST.CARDS_PER_ROUND}`;
  }
  if (state.currentLine) {
    qs('[data-hud="line-dot"]').style.background = state.currentLine.color;
    qs('[data-hud="line-name"]').textContent     = state.currentLine.name;
    qs('[data-hud="round"]').textContent = `Round ${state.round + 1} / ${state.lineOrder.length}`;
  }
}

// ------------------------------------------------------------
// ROUND / END ROUND
// ------------------------------------------------------------
function checkRoundEnd() {
  const used = usedCount();
  if (used >= CONST.CARDS_PER_ROUND) {
    // original end-of-round condition (8 used cards)
    endRoundInternal();
  }
}

// triggered by End Round button (5-of-type rule)
function endRoundManually() {
  if (!state.roundLocked) return; // only relevant when type limit hit
  endRoundInternal();
}

function endRoundInternal() {
  if (state.finished) return;
  const fp = roundScore(state.stationById, state.segments, state.currentLine.id);
  state.scores.push(fp);

  const li = document.createElement("li");
  li.textContent = `${state.currentLine.name}: ${fp} pts`;
  qs("[data-scores]").appendChild(li);

  // Last line? game ends
  if (state.round >= 3) {
    finishGame();
    return;
  }

  // Next line
  state.round++;
  state.currentLine = getLine(state.lineOrder[state.round]);
  state.activeEndpoint = state.currentLine.start;
  state.selected = null;
  state.switchMode = false;

  newDeck();
  showCard(null);
  updateHUD();
  renderStations();
  renderSegments();
  highlightEndpoints();
  toast(`Round complete · ${fp} pts. Next line: ${state.currentLine.name}.`, "success");
}

function finishGame() {
  state.finished = true;
  state.roundLocked = true;
  state.selected = null;
  clearInterval(state.timerHandle);
  state.timerHandle = null;

  const time = elapsedTime();
  const result = scoreBreakdown(state.stationById, state.segments, state.scores);
  qs("[data-final]").textContent = `Final Score: ${result.total}`;
  showCard(null);
  saveHighScore(state.player, result.total, time);

  const values = {
    player: state.player, total: result.total, time: formatTime(time),
    "round-points": result.roundPoints, "rail-points": result.railPoints, "transfer-points": result.transferPoints
  };
  for (const [key, value] of Object.entries(values)) {
    qs(`[data-result="${key}"]`).textContent = value;
  }
  const lines = qs('[data-result="lines"]');
  lines.replaceChildren(...state.lines.map(line => {
    const row = document.createElement("li");
    const label = document.createElement("span");
    label.className = "line-key-item";
    label.style.setProperty("--result-line", line.color);
    label.textContent = line.name;
    const score = document.createElement("strong");
    score.textContent = `${state.scores[state.lineOrder.indexOf(line.id)]} pts`;
    row.append(label, score);
    return row;
  }));
  qs("[data-toast]").replaceChildren();
  showScreen("results");
  qs("#results-title").focus({ preventScroll: true });
}

// update button enabled/disabled when type limit hit
function updateRoundLockUI() {
  const card = currentCard();
  const canDrawOrSkip = !state.roundLocked && !state.finished;
  qs('[data-action="draw"]').disabled = !canDrawOrSkip || Boolean(card);
  qs('[data-action="skip"]').disabled = !canDrawOrSkip || !card;
  qs('[data-action="end-round"]').disabled = !state.roundLocked || state.finished;
  qs('[data-action="undo"]').disabled = state.finished ||
    !state.segments.some(segment => segment.lineId === state.currentLine?.id);
}

// ------------------------------------------------------------
// UNDO + HIGHLIGHT ENDPOINT
// ------------------------------------------------------------
function undoSegment() {
  if (state.finished) return;
  const lineId = state.currentLine.id;
  const idx = state.segments.findLastIndex(s => s.lineId === lineId);
  if (idx < 0) return;

  const removed = state.segments[idx];
  state.segments.splice(idx, 1);
  state.selected = null;

  state.activeEndpoint = removed.previousEndpoint;

  renderSegments();
  highlightEndpoints();
  updateRoundLockUI();
}

function highlightEndpoints() {
  const card = currentCard();
  const canPreview = state.selected != null && card && !state.finished;
  qsa(".station").forEach(n => {
    n.classList.remove("station--start","station--endpoint");
    n.style.removeProperty("color");
    const id = Number(n.dataset.id);
    const selected = id === state.selected;
    n.setAttribute("aria-pressed", String(selected));
    if (selected) n.style.color = state.currentLine.color;
    n.classList.toggle("station--candidate", Boolean(canPreview &&
      !routeIssue(state.selected, id, card, state.currentLine.id)));
  });

  const startId   = state.currentLine.start;
  const startNode = stationBtn(startId);

  if (startNode) {
    startNode.classList.add("station--start");
    startNode.style.color = state.currentLine.color;
  }

  if (state.activeEndpoint != null) {
    const epNode = stationBtn(state.activeEndpoint);
    if (epNode) {
      epNode.classList.add("station--endpoint");
      epNode.style.color = state.currentLine.color;
    }
  }

  const guide = qs("[data-guide]");
  if (state.roundLocked) {
    guide.textContent = "Five cards of one type. End round when ready.";
  } else if (canPreview) {
    guide.textContent = "Choose a highlighted destination.";
  } else if (state.switchMode) {
    guide.textContent = "Switch is active. Select any station on this line.";
  } else {
    guide.textContent = card ? "Select the active endpoint to extend this line." : "Draw a card to begin.";
  }
}

// ------------------------------------------------------------
// LOCALSTORAGE HIGH SCORES
// ------------------------------------------------------------
function saveHighScore(name, score, timeSec) {
  try {
    const arr = readHighScores();
    arr.push({ name, score, time: timeSec });
    localStorage.setItem(CONST.LS_KEY, JSON.stringify(arr));
  } catch (e) {
    // ignore storage errors silently
  }
}

function renderHighScores() {
  const list = qs("[data-highscores]");
  if (!list) return;

  list.innerHTML = "";

  const arr = readHighScores();
  qs("[data-empty-scores]").classList.toggle("hidden", arr.length > 0);

  arr.sort((a,b) => b.score - a.score);

  arr.slice(0,10).forEach(({name,score,time}) => {
    const li = document.createElement("li");
    li.textContent = `${name} — ${score} pts — ${formatTime(time)}`;
    list.appendChild(li);
  });
}

function readHighScores() {
  try {
    const data = JSON.parse(localStorage.getItem(CONST.LS_KEY) || "[]");
    return Array.isArray(data) ? data.filter(entry =>
      entry && typeof entry.name === "string" && Number.isFinite(entry.score) && Number.isFinite(entry.time)
    ) : [];
  } catch {
    return [];
  }
}

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = String(Math.floor(s/60)).padStart(2,"0");
  const ss = String(s%60).padStart(2,"0");
  return `${m}:${ss}`;
}
