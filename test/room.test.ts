import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanText, levenshtein, normalizeGuess, Room, validStroke, type RoomResult } from '../src/activity/room.js';
import { estimateMinutes, validSettings, type ServerMessage, type StateMessage } from '../src/shared/protocol.js';

// secondMs: 4 → a 45 s draw lasts 180 ms, a 5 min limit lasts 1.2 s.
const fast = { chooseMs: 50, revealMs: 20, secondMs: 4 };
const oneRound = { mode: 'rounds', value: 1, drawSeconds: 45 } as const;
const drawMs = oneRound.drawSeconds * fast.secondMs;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function client() {
  const inbox: ServerMessage[] = [];
  return {
    conn: { send: (m: ServerMessage) => inbox.push(m) },
    inbox,
    lastState: () => [...inbox].reverse().find((m): m is StateMessage => m.t === 'state'),
    chats: () => inbox.filter((m) => m.t === 'chat').map((m) => (m as { text: string }).text),
  };
}

test('normalizeGuess ignores case, accents and punctuation', () => {
  assert.equal(normalizeGuess('  Ice-Cream!! '), 'icecream');
  assert.equal(normalizeGuess('ICE  cream'), 'ice cream');
  assert.equal(normalizeGuess('Café'), 'cafe');
});

test('levenshtein detects near misses', () => {
  assert.equal(levenshtein('coffee', 'cofee'), 1);
  assert.equal(levenshtein('coffee', 'coffee'), 0);
  assert.ok(levenshtein('coffee', 'banana') > 1);
});

test('cleanText strips control characters and limits length', () => {
  assert.equal(cleanText('hi\u0000​there', 100), 'hithere');
  assert.equal(cleanText('x'.repeat(100), 10).length, 10);
  assert.equal(cleanText(42, 10), '');
});

test('validStroke rejects bad input', () => {
  assert.ok(validStroke({ id: 1, c: 0, w: 0, p: [1, 2, 3, 4] }));
  assert.ok(!validStroke({ id: 1, c: 99, w: 0, p: [1, 2] }), 'unknown color');
  assert.ok(!validStroke({ id: 1, c: 0, w: 0, p: [1, 2, 3] }), 'odd point list');
  assert.ok(!validStroke({ id: 1, c: 0, w: 0, p: [1, 1e9] }), 'out of bounds');
  assert.ok(!validStroke({ id: 1, c: 0, w: 0, p: Array(1000).fill(1) }), 'too many points');
  assert.ok(!validStroke({ id: -1, c: 0, w: 0, p: [1, 2] }), 'negative id');
  assert.ok(!validStroke(null));
});

test('only the host can start, and it needs 2 players', () => {
  const room = new Room('i1', 'g1', 'c1', { onGameEnd: () => {} }, fast);
  const a = client();
  const b = client();
  room.join({ id: 'A', name: 'Alice' }, a.conn);
  room.handle('A', { t: 'start' });
  assert.equal(room.currentPhase, 'lobby');
  room.join({ id: 'B', name: 'Bob' }, b.conn);
  room.handle('B', { t: 'start' });
  assert.equal(room.currentPhase, 'lobby', 'non-host cannot start');
  room.handle('A', { t: 'start' });
  assert.equal(room.currentPhase, 'choosing');
  room.dispose();
});

test('full game: word is hidden from guessers, correct guess scores, results reported', async () => {
  let results: RoomResult[] = [];
  const room = new Room('i2', 'g1', 'c1', { onGameEnd: (_r, res) => (results = res) }, fast);
  const a = client();
  const b = client();
  room.join({ id: 'A', name: 'Alice' }, a.conn);
  room.join({ id: 'B', name: 'Bob' }, b.conn);
  room.handle('A', { t: 'settings', settings: oneRound });
  room.handle('A', { t: 'start' });

  // A draws first (join order). Only A receives choices.
  const choices = a.inbox.find((m) => m.t === 'choices');
  assert.ok(choices && choices.t === 'choices');
  assert.ok(!b.inbox.some((m) => m.t === 'choices'), 'guesser must not see choices');
  room.handle('A', { t: 'pick', index: 0 });
  const word = choices.words[0]!;

  const bState = b.lastState()!;
  assert.equal(bState.phase, 'drawing');
  assert.equal(bState.word, undefined, 'guesser must not receive the word');
  assert.ok(!bState.hint.replaceAll(' ', '').replaceAll('_', '').length, 'hint starts fully hidden');
  assert.equal(a.lastState()!.word, word, 'drawer sees the word');

  // Non-drawer strokes are ignored; drawer strokes reach the guesser.
  room.handle('B', { t: 'stroke', s: { id: 1, c: 0, w: 0, p: [1, 1, 2, 2] } });
  assert.ok(!a.inbox.some((m) => m.t === 'stroke'));
  room.handle('A', { t: 'stroke', s: { id: 1, c: 0, w: 0, p: [1, 1, 2, 2] } });
  assert.ok(b.inbox.some((m) => m.t === 'stroke'));

  // Correct guess text is never broadcast.
  room.handle('B', { t: 'guess', text: word.toUpperCase() + '!' });
  assert.ok(!a.chats().some((t) => normalizeGuess(t) === normalizeGuess(word)), 'correct guess must not leak');
  assert.ok(a.chats().some((t) => t.includes('guessed the word')));

  // Everyone guessed → reveal → (1 round, B draws next) → let it time out → finished.
  assert.equal(room.currentPhase, 'reveal', 'turn ends once everyone guessed');
  assert.equal(b.lastState()!.word, word, 'word revealed to everyone after the turn');
  await wait(fast.chooseMs + drawMs + fast.revealMs + 100);
  assert.equal(room.currentPhase, 'finished');
  assert.equal(results.length, 2);
  const bob = results.find((r) => r.userId === 'B')!;
  assert.ok(bob.points >= 50, 'guesser scored');
  room.dispose();
});

test('drawer leaving mid-turn ends the turn; dropping below 2 players returns to lobby', async () => {
  const room = new Room('i3', null, null, { onGameEnd: () => {} }, fast);
  const a = client();
  const b = client();
  const c = client();
  room.join({ id: 'A', name: 'A' }, a.conn);
  room.join({ id: 'B', name: 'B' }, b.conn);
  room.join({ id: 'C', name: 'C' }, c.conn);
  room.handle('A', { t: 'start' });
  room.handle('A', { t: 'pick', index: 0 });
  room.leave('A', a.conn);
  assert.equal(room.currentPhase, 'reveal');
  room.leave('B', b.conn);
  assert.equal(room.currentPhase, 'lobby');
  room.dispose();
});

test('settings: host only, validated, sent in state', () => {
  const room = new Room('i4', null, null, { onGameEnd: () => {} }, fast);
  const a = client();
  const b = client();
  room.join({ id: 'A', name: 'A' }, a.conn);
  room.join({ id: 'B', name: 'B' }, b.conn);
  assert.deepEqual(a.lastState()!.settings, { mode: 'time', value: 10, drawSeconds: 60 }, 'defaults to a 10 minute game');

  room.handle('B', { t: 'settings', settings: { mode: 'points', value: 500, drawSeconds: 45 } });
  assert.equal(a.lastState()!.settings.mode, 'time', 'non-host cannot change settings');

  room.handle('A', { t: 'settings', settings: { mode: 'points', value: 999999, drawSeconds: 45 } });
  assert.equal(a.lastState()!.settings.mode, 'time', 'values outside the allowed options are rejected');

  room.handle('A', { t: 'settings', settings: { mode: 'points', value: 300, drawSeconds: 45 } });
  assert.deepEqual(b.lastState()!.settings, { mode: 'points', value: 300, drawSeconds: 45 });

  room.handle('A', { t: 'start' });
  room.handle('A', { t: 'settings', settings: oneRound });
  assert.equal(a.lastState()!.settings.mode, 'points', 'settings are locked during a game');
  room.dispose();
});

test('points mode ends after the turn in which someone reaches the target', async () => {
  let ended = false;
  const room = new Room('i5', null, null, { onGameEnd: () => (ended = true) }, fast);
  const a = client();
  const b = client();
  room.join({ id: 'A', name: 'A' }, a.conn);
  room.join({ id: 'B', name: 'B' }, b.conn);
  room.handle('A', { t: 'settings', settings: { mode: 'points', value: 300, drawSeconds: 45 } });
  room.handle('A', { t: 'start' });

  // Alternate drawing and guessing instantly until B passes 300 points.
  for (let turn = 0; turn < 20 && room.currentPhase !== 'finished'; turn++) {
    const state = a.lastState()!;
    const drawer = state.drawerId!;
    const dc = drawer === 'A' ? a : b;
    const choices = [...dc.inbox].reverse().find((m) => m.t === 'choices');
    if (!choices || choices.t !== 'choices') break;
    room.handle(drawer, { t: 'pick', index: 0 });
    room.handle(drawer === 'A' ? 'B' : 'A', { t: 'guess', text: choices.words[0]! });
    await wait(fast.revealMs + 30);
  }
  assert.equal(room.currentPhase, 'finished');
  assert.ok(ended);
  const top = Math.max(...a.lastState()!.players.map((p) => p.score));
  assert.ok(top >= 300, 'winner reached the target');
  room.dispose();
});

test('time mode: no new turns once the limit has passed', async () => {
  const room = new Room('i6', null, null, { onGameEnd: () => {} }, { ...fast, secondMs: 1 });
  const a = client();
  const b = client();
  room.join({ id: 'A', name: 'A' }, a.conn);
  room.join({ id: 'B', name: 'B' }, b.conn);
  room.handle('A', { t: 'settings', settings: { mode: 'time', value: 5, drawSeconds: 45 } }); // 300 ms limit
  room.handle('A', { t: 'start' });
  const endsAt = a.lastState()!.gameEndsAt;
  assert.ok(endsAt && endsAt > Date.now());
  // Let turns time out on their own (50 + 45 + 20 ms each) until the limit passes.
  await wait(300 + 50 + 45 + 20 + 100);
  assert.equal(room.currentPhase, 'finished');
  assert.ok(a.chats().some((t) => t.includes("Time's up")) || a.lastState()!.phase === 'finished');
  room.dispose();
});

test('length estimates are sensible and validSettings matches the options', () => {
  const short = estimateMinutes({ mode: 'points', value: 300, drawSeconds: 45 }, 4);
  const long = estimateMinutes({ mode: 'points', value: 1200, drawSeconds: 80 }, 4);
  assert.ok(short > 0.5 && short < long, `${short} < ${long}`);
  assert.ok(long <= 30, 'points mode is capped');
  assert.ok(Math.abs(estimateMinutes({ mode: 'time', value: 10, drawSeconds: 60 }, 6) - 10) < 1);
  const threeRounds = estimateMinutes({ mode: 'rounds', value: 3, drawSeconds: 80 }, 6);
  assert.ok(threeRounds > 20, 'the old default really was long');
  assert.ok(validSettings({ mode: 'rounds', value: 2, drawSeconds: 60 }));
  assert.ok(!validSettings({ mode: 'rounds', value: 7, drawSeconds: 60 }));
  assert.ok(!validSettings({ mode: 'time', value: 10, drawSeconds: 5 }));
  assert.ok(!validSettings({ mode: 'party', value: 10, drawSeconds: 60 }));
});
