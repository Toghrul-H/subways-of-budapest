// ============================================================
// Subways of Budapest – Core Edition (Extended Version)
// Extra Tasks:
// 1) Card type system (center/side)
// 2) Round ends when 5 of same type appeared (End Round button)
// 3) Official SWITCH rules (branch from any visited station)
// 4) LocalStorage high scores
// ============================================================

const qs  = (s, e=document) => e.querySelector(s);
const qsa = (s, e=document) => [...e.querySelectorAll(s)];

const CONST = {
  GRID: 10,
  CARDS_PER_ROUND: 8,
  RAIL: [0,1,2,4,6,8,11,14,17,21,25],
  LS_KEY: "subways_scores"
};

const state = {
  stations: [],
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
  player: "",
  startTime: null,
  timerHandle: null
};

init();

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------
async function init() {
  const [stations, lines] = await Promise.all([
    fetch("stations.json").then(r => r.json()),
    fetch("lines.json").then(r => r.json())
  ]);

  state.stations = stations;
  state.lines    = lines;

  qs('[data-action="start"]').addEventListener("click", startGame);
  qs('[data-action="draw"]').addEventListener("click", drawCard);
  qs('[data-action="skip"]').addEventListener("click", skipCard);
  qs('[data-action="undo"]').addEventListener("click", undoSegment);
  qs('[data-action="end-round"]').addEventListener("click", endRoundManually);

  window.addEventListener("resize", renderSegments);

  // Load high scores for menu
  renderHighScores();
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

  state.player = name;
  state.round = 0;
  state.scores = [];
  state.segments = [];
  state.switchMode = false;
  state.centerCount = 0;
  state.sideCount = 0;
  state.roundLocked = false;

  state.lineOrder   = shuffle(state.lines.map(l => l.id));
  state.currentLine = getLine(state.lineOrder[0]);

  newDeck();
  state.startTime = Date.now();

  state.activeEndpoint = state.currentLine.start;
  state.selected = null;

  qs('[data-screen="menu"]').classList.add("hidden");
  qs('[data-screen="game"]').classList.remove("hidden");
  qs('[data-hud="player"]').textContent = state.player;

  showCard(null);
  updateHUD(true);
  renderStations();
  renderSegments();
  highlightEndpoints();
  updateRoundLockUI();

  if (state.timerHandle) clearInterval(state.timerHandle);
  state.timerHandle = setInterval(updateTimer, 1000);
}

// ------------------------------------------------------------
// TIMER
// ------------------------------------------------------------
function updateTimer() {
  if (!state.startTime) return;
  const s  = Math.floor((Date.now() - state.startTime) / 1000);
  const m  = String(Math.floor(s / 60)).padStart(2,"0");
  const ss = String(s % 60).padStart(2,"0");
  qs('[data-hud="timer"]').textContent = `${m}:${ss}`;
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
    el.style.gridColumn = st.x + 1;
    el.style.gridRow    = st.y + 1;

    const mark = qs("[data-mark]", el);
    mark.textContent = st.type;

    // Train station visual: neon purple ring (for scoring)
    if (st.train) {
      mark.style.borderColor = "#B26BFF";
      mark.style.boxShadow = "0 0 12px #B26BFF";
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

    if (!involved.length) continue;

    const colors = [...new Set(involved.map(x => getLine(x.lineId).color))];
    mark.style.background = mixColors(colors);
  }
}

// ------------------------------------------------------------
// STATION CLICK + SWITCH / ACTIVE ENDPOINT LOGIC
// ------------------------------------------------------------
function stationClick(id) {
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

    // If SWITCH MODE is active: can start from ANY visited station of this line
    if (state.switchMode) {
      const visited = getVisitedStations(lineId);
      if (!visited.has(id)) {
        toast("⚠️ With SWITCH, you must start from a visited station.","warn");
        return;
      }
      state.selected = id;
      pulse(id);
      return;
    }

    // Normal mode: must be exactly the active endpoint
    if (id !== state.activeEndpoint) {
      toast("❌ You can’t build from that endpoint without a Switch card.","error");
      return;
    }

    state.selected = id;
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
    return;
  }

  pulse(id);

  if (validateSegment(a, b, card, lineId)) {
    addSegment(a, b, lineId);

    // after placing, new active endpoint becomes the target
    state.activeEndpoint = b;
    state.selected = null;

    // SWITCH mode is single-use: turn off after building one segment
    if (state.switchMode) state.switchMode = false;

    markCardUsed();
    checkRoundEnd();
    autoDrawIfNone();
  } else {
    // invalid: cancel selection, but switchMode still stays until card used/skip
    state.selected = null;
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
function validateSegment(a, b, card, lineId) {
  const A = getStation(a);
  const B = getStation(b);

  if (!matchesCard(B, card)) {
    toast("⚠️ Destination must match the card.","warn");
    return false;
  }

  const dx = B.x - A.x;
  const dy = B.y - A.y;

  if (!(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy))) {
    toast("⚠️ Segments must be straight or 45° diagonal.","warn");
    return false;
  }

  if (passesThroughStation(A, B)) {
    toast("❌ You can’t intersect or pass through another station.","error");
    return false;
  }

  if (intersectsExisting(A, B)) {
    toast("❌ You can’t intersect an existing segment.","error");
    return false;
  }

  // Overlap rule: no line may reuse the same segment pair as any other line
  const overlap = state.segments.find(
    s => (s.a === a && s.b === b) || (s.a === b && s.b === a)
  );
  if (overlap) {
    toast("❌ Two metro lines cannot overlap between the same stations.","error");
    return false;
  }

  // Loop rule: same line cannot revisit a station
  const sameLineSeg = state.segments.filter(s => s.lineId === lineId);
  const usedStations = new Set();
  for (const s of sameLineSeg) {
    usedStations.add(s.a);
    usedStations.add(s.b);
  }
  if (usedStations.has(b)) {
    toast("❌ This line cannot form a loop.","error");
    return false;
  }

  return true;
}

// ------------------------------------------------------------
// ADD SEGMENT
// ------------------------------------------------------------
function addSegment(a, b, lineId) {
  state.segments.push({ a, b, lineId });
  renderSegments();
  highlightEndpoints();
}

// ------------------------------------------------------------
// GEOMETRY HELPERS
// ------------------------------------------------------------
function passesThroughStation(A,B) {
  return state.stations.some(st => {
    if (st.id === A.id || st.id === B.id) return false;
    const px = st.x, py = st.y;
    const minX = Math.min(A.x, B.x);
    const maxX = Math.max(A.x, B.x);
    const minY = Math.min(A.y, B.y);
    const maxY = Math.max(A.y, B.y);
    if (px < minX || px > maxX || py < minY || py > maxY) return false;
    const cross = (B.y - A.y) * (px - A.x) - (B.x - A.x) * (py - A.y);
    return Math.abs(cross) < 0.01;
  });
}

function intersectsExisting(A,B) {
  return state.segments.some(s => {
    const P = getStation(s.a);
    const Q = getStation(s.b);
    return intersect(A,B,P,Q);
  });
}

function intersect(p1,p2,p3,p4) {
  const d = (p2.x-p1.x)*(p4.y-p3.y) - (p2.y-p1.y)*(p4.x-p3.x);
  if (!d) return false;
  const ua = ((p3.x-p1.x)*(p4.y-p3.y) - (p3.y-p1.y)*(p4.x-p3.x)) / d;
  const ub = ((p3.x-p1.x)*(p2.y-p1.y) - (p3.y-p1.y)*(p2.x-p1.x)) / d;
  return ua > 0 && ua < 1 && ub > 0 && ub < 1;
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
function matchesCard(st, card) {
  if (!card) return false;
  if (card.t === "JOKER") return true;
  return st.type === "?" || st.type === card.t;
}

function stationBtn(id) { return qs(`.station[data-id="${id}"]`); }
function getStation(id) { return state.stations.find(s => s.id === id); }
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

  if (!c) {
    face.textContent = "–";
    typeSpan.textContent = "–";
  } else {
    if (c.t === "SWITCH") {
      face.textContent = "↔";
    } else {
      face.textContent = c.t;
    }
    typeSpan.textContent = c.cardType === "center" ? "CENTER" : "SIDE";
  }
}

function updateHUD(first=false) {
  const used = usedCount();
  const cardsEl = qs('[data-hud="cards"]');
  if (cardsEl) {
    cardsEl.textContent = `${used} / ${CONST.CARDS_PER_ROUND}`;
  }
  if (first || state.currentLine) {
    qs('[data-hud="line-dot"]').style.background = state.currentLine.color;
    qs('[data-hud="line-name"]').textContent     = state.currentLine.name;
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
  const fp = calculateRoundScore(state.currentLine.id);
  state.scores.push(fp);

  const li = document.createElement("li");
  li.textContent = `${state.currentLine.name}: ${fp} pts`;
  qs("[data-scores]").appendChild(li);

  // Last line? game ends
  if (state.round >= 3) {
    const final = calculateFinalScore();
    qs("[data-final]").textContent = `Final Score: ${final}`;
    toast(`🏁 Final Score: ${final}`,"warn");

    // stop timer
    if (state.timerHandle) {
      clearInterval(state.timerHandle);
      state.timerHandle = null;
    }

    // save high score
    saveHighScore(state.player, final, Math.floor((Date.now()-state.startTime)/1000));
    renderHighScores();
    state.roundLocked = true;
    updateRoundLockUI();
    return;
  }

  // Next line
  state.round++;
  state.currentLine = getLine(state.lineOrder[state.round]);
  state.activeEndpoint = state.currentLine.start;
  state.selected = null;
  state.switchMode = false;

  animateHUDLineSwitch(state.currentLine.color, state.currentLine.name);

  newDeck();
  showCard(null);
  updateHUD(true);
  renderStations();
  renderSegments();
  highlightEndpoints();
  toast(`Next line: ${state.currentLine.name}`,"warn");
}

// update button enabled/disabled when type limit hit
function updateRoundLockUI() {
  const btnDraw  = qs('[data-action="draw"]');
  const btnSkip  = qs('[data-action="skip"]');
  const btnEnd   = qs('[data-action="end-round"]');

  if (!btnDraw || !btnSkip || !btnEnd) return;

  if (state.roundLocked) {
    btnDraw.disabled = true;
    btnSkip.disabled = true;
    btnEnd.disabled  = false;
  } else {
    btnDraw.disabled = false;
    btnSkip.disabled = false;
    btnEnd.disabled  = true;
  }
}

// ------------------------------------------------------------
// SCORING
// ------------------------------------------------------------
function calculateRoundScore(lineId) {
  const lineSegs = state.segments.filter(s => s.lineId === lineId);
  const visited  = new Set(lineSegs.flatMap(s => [s.a, s.b]));
  const dists    = [...visited].map(id => getStation(id).district);

  const PK = new Set(dists).size || 0;

  const districtCount = {};
  dists.forEach(d => districtCount[d] = (districtCount[d] || 0) + 1);
  const PM = Math.max(...Object.values(districtCount));

  let PD = 0;
  for (const seg of lineSegs) {
    const s1 = getStation(seg.a);
    const s2 = getStation(seg.b);
    if (s1.side !== s2.side) PD++;
  }
  return PK * PM + PD;
}

function calculateFinalScore() {
  let sum = state.scores.reduce((a,b)=>a+b,0);

  const linesByStation = {};
  for (const s of state.stations) linesByStation[s.id] = new Set();

  for (const seg of state.segments) {
    linesByStation[seg.a].add(seg.lineId);
    linesByStation[seg.b].add(seg.lineId);
  }

  let c2=0,c3=0,c4=0;
  for (const ids of Object.values(linesByStation)) {
    if (ids.size === 2) c2++;
    if (ids.size === 3) c3++;
    if (ids.size >= 4) c4++;
  }

  const trainStations = state.stations.filter(
    s => s.train && [...linesByStation[s.id]].length > 0
  );
  const pp = CONST.RAIL[Math.min(trainStations.length, CONST.RAIL.length-1)];

  return sum + pp + (2*c2) + (5*c3) + (9*c4);
}

// ------------------------------------------------------------
// HUD ANIMATION
// ------------------------------------------------------------
function animateHUDLineSwitch(color, name) {
  const hud  = qs(".hud");
  const dot  = qs('[data-hud="line-dot"]');
  const text = qs('[data-hud="line-name"]');

  dot.classList.add("fade-out");
  text.classList.add("fade-out");

  setTimeout(() => {
    dot.style.background = color;
    text.textContent     = name;

    dot.classList.remove("fade-out");
    text.classList.remove("fade-out");
    dot.classList.add("fade-in");
    text.classList.add("fade-in");
  }, 250);

  hud.style.boxShadow = `0 0 25px 5px ${color}55`;
  setTimeout(() => { hud.style.boxShadow = "none"; }, 1000);
}

// ------------------------------------------------------------
// UNDO + HIGHLIGHT ENDPOINT
// ------------------------------------------------------------
function undoSegment() {
  const lineId = state.currentLine.id;
  const idx = state.segments.findLastIndex(s => s.lineId === lineId);
  if (idx < 0) return;

  const removed = state.segments[idx];
  state.segments.splice(idx, 1);

  const endpoints = getEndpoints(lineId);

  if (!endpoints.length) {
    state.activeEndpoint = state.currentLine.start;
  } else if (endpoints.length === 1) {
    state.activeEndpoint = endpoints[0];
  } else {
    if (endpoints.includes(removed.a))      state.activeEndpoint = removed.a;
    else if (endpoints.includes(removed.b)) state.activeEndpoint = removed.b;
    else                                    state.activeEndpoint = endpoints[0];
  }

  renderSegments();
  highlightEndpoints();
}

function getEndpoints(lineId) {
  const segs = state.segments.filter(s => s.lineId === lineId);
  if (!segs.length) return [getLine(lineId).start];

  const deg = {};
  for (const s of segs) {
    deg[s.a] = (deg[s.a] || 0) + 1;
    deg[s.b] = (deg[s.b] || 0) + 1;
  }
  return Object.entries(deg)
    .filter(([_,d]) => d === 1)
    .map(([k]) => Number(k));
}

function highlightEndpoints() {
  qsa(".station").forEach(n => {
    n.classList.remove("station--start","station--endpoint");
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
}

// ------------------------------------------------------------
// LOCALSTORAGE HIGH SCORES
// ------------------------------------------------------------
function saveHighScore(name, score, timeSec) {
  try {
    const raw = localStorage.getItem(CONST.LS_KEY) || "[]";
    const arr = JSON.parse(raw);
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

  let arr = [];
  try {
    arr = JSON.parse(localStorage.getItem(CONST.LS_KEY) || "[]");
  } catch (e) {
    arr = [];
  }

  arr.sort((a,b) => b.score - a.score);

  arr.slice(0,10).forEach(({name,score,time}) => {
    const li = document.createElement("li");
    li.textContent = `${name} — ${score} pts — ${formatTime(time)}`;
    list.appendChild(li);
  });
}

function formatTime(sec) {
  const s = Math.max(0, sec|0);
  const m = String(Math.floor(s/60)).padStart(2,"0");
  const ss = String(s%60).padStart(2,"0");
  return `${m}:${ss}`;
}

// ------------------------------------------------------------
// TEST HOOKS
// ------------------------------------------------------------
window.__test = {
  validateSegment,
  checkRoundEnd
};
