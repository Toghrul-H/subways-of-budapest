const RAIL_POINTS = [0, 1, 2, 4, 6, 8, 11, 14, 17, 21, 25];

function cross(a, b, p) {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function strictlyBetween(value, a, b) {
  return Math.min(a, b) < value && value < Math.max(a, b);
}

export function onSegmentInterior(point, a, b) {
  return cross(a, b, point) === 0 &&
    (strictlyBetween(point.x, a.x, b.x) || strictlyBetween(point.y, a.y, b.y));
}

export function segmentsConflict(a, b, p, q) {
  const pSide = cross(a, b, p);
  const qSide = cross(a, b, q);
  if (pSide === 0 && qSide === 0) {
    const axis = a.x === b.x ? "y" : "x";
    const overlapStart = Math.max(Math.min(a[axis], b[axis]), Math.min(p[axis], q[axis]));
    const overlapEnd = Math.min(Math.max(a[axis], b[axis]), Math.max(p[axis], q[axis]));
    return overlapStart < overlapEnd;
  }

  // A shared endpoint is a transfer, not an interior crossing.
  return pSide * qSide < 0 && cross(p, q, a) * cross(p, q, b) < 0;
}

export function canStartRoute(id, endpoint, switchMode, visited) {
  return switchMode ? visited.has(id) : id === endpoint;
}

export function routeError(stations, segments, a, b, card, lineId) {
  const from = stations.get(a);
  const to = stations.get(b);
  if (!from || !to || !card || a === b) return "station";
  if (card.t !== "JOKER" && to.type !== "?" && to.type !== card.t) return "card";

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy)) return "angle";

  for (const station of stations.values()) {
    if (station.id !== a && station.id !== b && onSegmentInterior(station, from, to)) {
      return "intermediate";
    }
  }

  for (const segment of segments) {
    if ((segment.a === a && segment.b === b) || (segment.a === b && segment.b === a)) {
      return "reuse";
    }
    if (segmentsConflict(from, to, stations.get(segment.a), stations.get(segment.b))) {
      return "crossing";
    }
  }

  if (segments.some(segment => segment.lineId === lineId && (segment.a === b || segment.b === b))) {
    return "loop";
  }

  return null;
}

export function roundScore(stations, segments, lineId) {
  const route = segments.filter(segment => segment.lineId === lineId);
  const visited = new Set(route.flatMap(({a, b}) => [a, b]));
  const districtCounts = new Map();
  for (const id of visited) {
    const { district } = stations.get(id);
    districtCounts.set(district, (districtCounts.get(district) || 0) + 1);
  }
  const largestDistrict = Math.max(0, ...districtCounts.values());
  const crossings = route.filter(({a, b}) => stations.get(a).side !== stations.get(b).side).length;
  return districtCounts.size * largestDistrict + crossings;
}

export function scoreBreakdown(stations, segments, scores) {
  const roundPoints = scores.reduce((sum, score) => sum + score, 0);
  const linesByStation = new Map();
  for (const { a, b, lineId } of segments) {
    for (const id of [a, b]) {
      if (!linesByStation.has(id)) linesByStation.set(id, new Set());
      linesByStation.get(id).add(lineId);
    }
  }

  let railCount = 0;
  let transferPoints = 0;
  for (const [id, lines] of linesByStation) {
    if (stations.get(id).train) railCount++;
    transferPoints += [0, 0, 2, 5, 9][Math.min(4, lines.size)];
  }

  const railPoints = RAIL_POINTS[Math.min(railCount, RAIL_POINTS.length - 1)];
  return { roundPoints, railPoints, transferPoints, total: roundPoints + railPoints + transferPoints };
}
