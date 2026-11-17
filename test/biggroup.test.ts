import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RoomResult } from '../src/activity/base.js';
import { cutRound, MassReactionRoom, type Tap } from '../src/activity/games/massreaction.js';
import { MINORITY_QUESTIONS } from '../src/games/data/minority.js';
import { mentionList, resolveCall, resolveMinority } from '../src/games/elimination.js';
import { CALLS } from '../src/games/laststanding.js';
import type { MassStateMessage } from '../src/shared/massreaction.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`);

// ── Last One Standing ──────────────────────────────────────────────────────

test('resolveCall: wrong picks and no-shows are out', () => {
  const r = resolveCall(['a', 'b', 'c', 'd'], new Map([['a', 0], ['b', 1], ['c', 0]]), [true, false]);
  assert.deepEqual(r.survivors, ['a', 'c']);
  assert.deepEqual(r.wrong, ['b']);
  assert.deepEqual(r.missed, ['d']);
  assert.equal(r.saved, false);
});

test('resolveCall: if every picker is wrong they are spared, but no-shows still go', () => {
  const r = resolveCall(['a', 'b', 'c'], new Map([['a', 1], ['b', 1]]), [true, false]);
  assert.deepEqual(r.survivors, ['a', 'b']);
  assert.deepEqual(r.missed, ['c']);
  assert.equal(r.saved, true);
});

test('resolveCall: nobody picking eliminates nobody', () => {
  const r = resolveCall(['a', 'b'], new Map(), [true, false]);
  assert.deepEqual(r.survivors, ['a', 'b']);
  assert.deepEqual(r.missed, []);
});

test('every call has at least one safe and one losing option', () => {
  for (const call of CALLS) {
    for (let i = 0; i < 50; i++) {
      const { safe, reveal } = call.roll();
      assert.equal(safe.length, call.options.length, call.name);
      assert.ok(safe.some(Boolean) && safe.some((x) => !x), call.name);
      assert.ok(reveal.length > 0);
    }
  }
});

// ── Minority Wins ──────────────────────────────────────────────────────────

test('resolveMinority: the smallest group survives', () => {
  const votes = new Map([['a', 0], ['b', 0], ['c', 0], ['d', 1], ['e', 1], ['f', 2]]);
  const r = resolveMinority(['a', 'b', 'c', 'd', 'e', 'f', 'g'], votes, 3);
  assert.deepEqual(r.counts, [3, 2, 1]);
  assert.deepEqual(r.minority, [2]);
  assert.deepEqual(r.survivors, ['f']);
  assert.deepEqual(r.missed, ['g']);
  assert.deepEqual(r.wrong.sort(), ['a', 'b', 'c', 'd', 'e']);
});

test('resolveMinority: groups tied for smallest both survive', () => {
  const votes = new Map([['a', 0], ['b', 1], ['c', 2], ['d', 2]]);
  const r = resolveMinority(['a', 'b', 'c', 'd'], votes, 3);
  assert.deepEqual(r.minority, [0, 1]);
  assert.deepEqual(r.survivors, ['a', 'b']);
});

test('resolveMinority: an even split or full agreement is a tie', () => {
  const even = resolveMinority(['a', 'b', 'c', 'd'], new Map([['a', 0], ['b', 0], ['c', 1], ['d', 1]]), 2);
  assert.equal(even.minority, null);
  assert.equal(even.survivors.length, 4);
  const same = resolveMinority(['a', 'b', 'c'], new Map([['a', 1], ['b', 1]]), 3);
  assert.equal(same.minority, null);
  assert.deepEqual(same.survivors, ['a', 'b']);
  assert.deepEqual(same.missed, ['c']);
  const none = resolveMinority(['a', 'b'], new Map(), 2);
  assert.deepEqual(none.survivors, ['a', 'b']);
});

test('minority questions have 2 or 3 short, distinct options', () => {
  for (const { q, options } of MINORITY_QUESTIONS) {
    assert.ok(options.length === 2 || options.length === 3, q);
    assert.equal(new Set(options).size, options.length, q);
    assert.ok(options.every((o) => o.length > 0 && o.length <= 70), q);
  }
});

test('mentionList truncates long lists', () => {
  assert.equal(mentionList([]), '');
  assert.equal(mentionList(['1', '2']), '<@1> <@2>');
  assert.match(mentionList(ids(30), 25), /and 5 more$/);
});

// ── Mass Reaction ──────────────────────────────────────────────────────────

test('cutRound: false starts and no-shows are out, then the slowest share', () => {
  const taps = new Map<string, Tap>([
    ['a', { ms: 200, early: false }],
    ['b', { ms: 250, early: false }],
    ['c', { ms: 300, early: false }],
    ['d', { ms: 400, early: false }],
    ['e', { ms: null, early: true }],
  ]);
  const r = cutRound(['a', 'b', 'c', 'd', 'e', 'f'], taps, 50);
  assert.deepEqual(r.survivors, ['a', 'b']);
  assert.equal(r.fastestId, 'a');
  assert.equal(r.replay, false);
  const status = Object.fromEntries(r.entries.map((e) => [e.id, e.status]));
  assert.deepEqual(status, { a: 'safe', b: 'safe', c: 'slow', d: 'slow', e: 'early', f: 'missed' });
});

test('cutRound: always cuts at least one but never the last valid tapper', () => {
  const two = cutRound(['a', 'b'], new Map([['a', { ms: 300, early: false }], ['b', { ms: 200, early: false }]]), 20);
  assert.deepEqual(two.survivors, ['b']);
  const one = cutRound(['a', 'b'], new Map([['a', { ms: 300, early: false }], ['b', { ms: null, early: true }]]), 50);
  assert.deepEqual(one.survivors, ['a']);
  const none = cutRound(['a', 'b'], new Map([['a', { ms: null, early: true }]]), 30);
  assert.equal(none.replay, true);
  assert.deepEqual(none.survivors, ['a', 'b']);
});

function player() {
  const inbox: ({ t: string } & Record<string, any>)[] = [];
  return { conn: { send: (m: unknown) => inbox.push(m as never) }, inbox, state: () => [...inbox].reverse().find((m) => m.t === 'state') as MassStateMessage };
}

test('mass reaction: rounds run until one player is left, and results are reported', async () => {
  let results: RoomResult[] = [];
  const room = new MassReactionRoom(
    { instanceId: 'i', guildId: 'g', channelId: null, onGameEnd: (r) => (results = r) },
    { readyMs: 5, waitMinMs: 5, waitMaxMs: 10, windowMs: 1000, resultMs: 5 },
  );
  const ps = ids(4).map((id) => ({ id, ...player() }));
  for (const p of ps) room.join({ id: p.id, name: p.id.toUpperCase() }, p.conn);
  room.handle('u0', { t: 'settings', settings: { cut: 50 } });
  room.handle('u1', { t: 'start' }); // not the host
  assert.equal(room.currentPhase, 'lobby');
  room.handle('u0', { t: 'start' });
  assert.equal(room.currentPhase, 'ready');

  // u3 jumps the gun in the first red phase.
  while (room.currentPhase !== 'wait') await wait(1);
  room.handle('u3', { t: 'tap', ms: 150 });

  for (let guard = 0; room.currentPhase !== 'finished' && guard < 2000; guard++) {
    if (room.currentPhase === 'go') {
      // Lower ids are faster. Wait a human-like moment: a reported time can't exceed the server's clock.
      await wait(220);
      for (const p of ps) room.handle(p.id, { t: 'tap', ms: 150 + Number(p.id.slice(1)) * 10 });
    }
    await wait(2);
  }
  assert.equal(room.currentPhase, 'finished');
  const final = ps[0]!.state();
  assert.equal(final.players.filter((p) => p.alive).length, 1);
  assert.equal(final.players.find((p) => p.alive)?.id, 'u0');
  assert.equal(final.players.find((p) => p.id === 'u3')?.outRound, 1);
  assert.equal(results[0]?.userId, 'u0');
  assert.equal(results[0]?.won, true);
  assert.equal(results.length, 4);
  assert.ok(ps[0]!.inbox.some((m) => m.t === 'go'));
  room.dispose();
});

test('mass reaction: taps under the human limit count as false starts', async () => {
  const room = new MassReactionRoom(
    { instanceId: 'i', guildId: null, channelId: null, onGameEnd: () => {} },
    { readyMs: 5, waitMinMs: 5, waitMaxMs: 5, windowMs: 1000, resultMs: 1000 },
  );
  const a = player();
  const b = player();
  room.join({ id: 'a', name: 'A' }, a.conn);
  room.join({ id: 'b', name: 'B' }, b.conn);
  room.handle('a', { t: 'start' });
  while (room.currentPhase !== 'go') await wait(1);
  room.handle('a', { t: 'tap', ms: 20 });
  await wait(120);
  room.handle('b', { t: 'tap', ms: 5000 }); // clamped to the server's elapsed time
  assert.equal(room.currentPhase, 'result');
  const last = a.state().last!;
  assert.equal(last.entries.find((e) => e.id === 'a')?.status, 'early');
  const bMs = last.entries.find((e) => e.id === 'b')!.ms!;
  assert.ok(bMs < 1000, `clamped, got ${bMs}`);
  room.dispose();
});

test('mass reaction: a late joiner watches instead of playing', async () => {
  const room = new MassReactionRoom(
    { instanceId: 'i', guildId: null, channelId: null, onGameEnd: () => {} },
    { readyMs: 50, waitMinMs: 50, waitMaxMs: 50, windowMs: 50, resultMs: 50 },
  );
  for (const id of ['a', 'b']) room.join({ id, name: id }, player().conn);
  room.handle('a', { t: 'start' });
  const late = player();
  room.join({ id: 'c', name: 'c' }, late.conn);
  const me = late.state().players.find((p) => p.id === 'c')!;
  assert.equal(me.alive, false);
  room.dispose();
});
