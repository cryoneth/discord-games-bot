import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanText, levenshtein, normalizeGuess, Room, validStroke, type RoomResult } from '../src/activity/room.js';
import type { ServerMessage, StateMessage } from '../src/shared/protocol.js';

const fast = { chooseMs: 50, drawMs: 200, revealMs: 20, rounds: 1 };
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
  await wait(fast.chooseMs + fast.drawMs + fast.revealMs + 100);
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
