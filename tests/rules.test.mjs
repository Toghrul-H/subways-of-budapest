import assert from "node:assert/strict";
import test from "node:test";
import { canStartRoute, onSegmentInterior, roundScore, routeError, scoreBreakdown, segmentsConflict } from "../rules.mjs";

const point = (x, y) => ({ x, y });
const station = (id, x, y, options) => ({ id, x, y, type: "A", district: 1, side: "Buda", ...options });
const board = (...stations) => new Map(stations.map(item => [item.id, item]));
const joker = { t: "JOKER" };
const route = (a, b, lineId = 0) => ({ a, b, lineId });

for (const [name, x, y] of [["horizontal", 3, 0], ["vertical", 0, 3], ["45-degree", 3, 3]]) {
  test(name + " segments are legal", () => {
    assert.equal(routeError(board(station(0, 0, 0), station(1, x, y)), [], 0, 1, joker, 0), null);
  });
}

test("the card and route angle must match", () => {
  const map = board(station(0, 0, 0), station(1, 3, 1, { type: "D" }));
  assert.equal(routeError(map, [], 0, 1, { t: "A" }, 0), "card");
  assert.equal(routeError(map, [], 0, 1, joker, 0), "angle");
});

test("wildcard stations accept ordinary letter cards", () => {
  const map = board(station(0, 0, 0), station(1, 2, 0, { type: "?" }));
  assert.equal(routeError(map, [], 0, 1, { t: "D" }, 0), null);
});

test("interior crossings are rejected", () => {
  const map = board(station(0, 0, 0), station(1, 4, 4), station(2, 4, 0), station(3, 0, 4));
  assert.equal(routeError(map, [route(2, 3, 1)], 0, 1, joker, 0), "crossing");
});

test("shared endpoints are valid across lines and for forward extension", () => {
  const map = board(station(0, 0, 0), station(1, 1, 1), station(2, 2, 1));
  for (const lineId of [0, 1]) {
    assert.equal(routeError(map, [route(0, 1, lineId)], 1, 2, joker, 0), null);
  }
  assert.equal(routeError(map, [route(0, 1, 1)], 2, 1, joker, 0), null);
});

test("collinear segments conflict only if they overlap with positive length", () => {
  assert(segmentsConflict(point(0, 0), point(4, 0), point(2, 0), point(5, 0)));
  assert(segmentsConflict(point(2, 5), point(2, 1), point(2, 3), point(2, 0)));
  assert(segmentsConflict(point(3, 3), point(0, 0), point(2, 2), point(4, 4)));
  assert(!segmentsConflict(point(0, 0), point(2, 0), point(2, 0), point(4, 0)));
  assert(!segmentsConflict(point(0, 0), point(2, 0), point(3, 0), point(4, 0)));
});

test("a station in the interior blocks the route regardless of direction", () => {
  const map = board(station(0, 4, 4), station(1, 0, 0), station(2, 2, 2));
  assert.equal(routeError(map, [], 0, 1, joker, 0), "intermediate");
  assert.equal(onSegmentInterior(point(4, 4), point(4, 4), point(0, 0)), false);
  assert.equal(onSegmentInterior(point(3, 3), point(1, 1), point(2, 2)), false);
});

test("reusing a pair in either direction is rejected", () => {
  const map = board(station(0, 0, 0), station(1, 1, 0));
  assert.equal(routeError(map, [route(0, 1, 1)], 0, 1, joker, 0), "reuse");
  assert.equal(routeError(map, [route(0, 1, 1)], 1, 0, joker, 0), "reuse");
});

test("a line cannot revisit one of its own stations", () => {
  const map = board(station(0, 0, 0), station(1, 2, 0), station(2, 2, 2));
  assert.equal(routeError(map, [route(0, 1), route(1, 2)], 2, 0, joker, 0), "loop");
});

test("normal origins must match the endpoint and Switch origins must be visited", () => {
  const visited = new Set([2, 3]);
  assert(canStartRoute(3, 3, false, visited));
  assert(!canStartRoute(2, 3, false, visited));
  assert(canStartRoute(2, 3, true, visited));
  assert(!canStartRoute(4, 3, true, visited));
});

test("empty rounds and runs score zero", () => {
  assert.equal(roundScore(new Map(), [], 0), 0);
  assert.deepEqual(scoreBreakdown(new Map(), [], [0, 0, 0, 0]),
    { roundPoints: 0, railPoints: 0, transferPoints: 0, total: 0 });
});

test("round score uses unique stations, district diversity and river crossings", () => {
  const map = board(station(0, 0, 0), station(1, 1, 0), station(2, 2, 0, { district: 2, side: "Pest" }));
  assert.equal(roundScore(map, [route(0, 1), route(1, 2), route(0, 2, 1)], 0), 5);
});

test("final score combines rail points and 2/3/4-line transfer bonuses once per station", () => {
  const map = board(...Array.from({ length: 6 }, (_, id) => station(id, id, 0, { train: id < 3 })));
  const segments = [
    route(0, 3, 0), route(0, 4, 1), route(1, 3, 0), route(1, 4, 1), route(1, 5, 2),
    route(2, 3, 0), route(2, 4, 1), route(2, 5, 2), route(2, 5, 3),
  ];
  assert.deepEqual(scoreBreakdown(map, segments, [4, 5, 3, 2]),
    { roundPoints: 14, railPoints: 4, transferPoints: 18, total: 36 });
});
