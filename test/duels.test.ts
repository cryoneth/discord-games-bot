import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commands } from '../src/commands/index.js';
import { dotsAndBoxes, fiveInARow, higherLower, mancala, matchsticks } from '../src/games/boardgames.js';
import { boxSides, callHolds, drawSide, fullDeck, isSolved, maskWord, newDots, newMancala, sow, type PlayingCard } from '../src/games/logic.js';
import { hangmanRules, numberRules } from '../src/games/secretduels.js';
import { sceneImage } from '../src/ui/card.js';

const png = (s: { w: number; h: number; draw: unknown }) => sceneImage(s as never, 'x', 'x').data;
const isPng = (b: Buffer) => b.subarray(1, 4).toString('ascii') === 'PNG';

test('dots: a shared line closes two boxes, taken lines are refused', () => {
  const d = newDots(2, 1); // two boxes side by side
  assert.equal(drawSide(d, 0, 'top', 1), 0);
  assert.equal(drawSide(d, 0, 'top', 2), -1);
  drawSide(d, 0, 'bottom', 1);
  drawSide(d, 0, 'left', 1);
  drawSide(d, 1, 'top', 2);
  drawSide(d, 1, 'bottom', 2);
  drawSide(d, 1, 'right', 2);
  assert.equal(boxSides(d, 0), 3);
  // The middle line is box 0's right and box 1's left.
  assert.equal(drawSide(d, 1, 'left', 2), 2);
  assert.deepEqual(d.boxes, [2, 2]);
  assert.equal(drawSide(d, 0, 'right', 1), -1, 'same line from the other side');
  assert.equal(drawSide(d, 5, 'top', 1), -1);
});

test('dots game: select then draw, closing a box grants another turn', () => {
  const g = dotsAndBoxes(2);
  assert.equal(g.move('s:top', 0), false, 'needs a box first');
  assert.equal(g.move('b0', 0), 'select');
  assert.equal(g.move('s:top', 0), true);
  for (const side of ['left', 'bottom'] as const) {
    g.move('b0', 1);
    assert.equal(g.move(`s:${side}`, 1), true);
  }
  g.move('b0', 0);
  assert.equal(g.move('s:right', 0), 'again');
  assert.equal(g.move('b0', 0), false, 'closed boxes cannot be picked');
  assert.equal(g.result(0), null);
  assert.match(g.status!(), /1.*0/);
  assert.equal(g.buttons('d:x', false, 0).length, 3);
  assert.ok(isPng(png(g.scene())));
});

test('matchsticks: taking the last stick loses', () => {
  const g = matchsticks(5);
  assert.equal(g.move('4', 0), false);
  assert.ok(g.move('3', 0));
  assert.equal(g.result(0), null);
  assert.equal(g.move('3', 1), false, 'only 2 left');
  assert.ok(g.move('1', 1));
  assert.ok(g.move('1', 0));
  assert.deepEqual(g.result(0), { kind: 'win', winner: 1 });
  assert.ok(isPng(png(g.scene())));
});

test('five in a row: row then column, five wins, occupied refused', () => {
  const g = fiveInARow();
  assert.equal(g.move('c:0', 0), false, 'pick a row first');
  for (let c = 0; c < 4; c++) {
    assert.equal(g.move('r:0', 0), 'select');
    assert.equal(g.move(`c:${c}`, 0), true);
    g.move('r:1', 1);
    g.move(`c:${c}`, 1);
  }
  g.move('r:0', 0);
  assert.equal(g.move('c:0', 0), false, 'occupied');
  assert.equal(g.result(0), null);
  assert.equal(g.move('c:4', 0), true);
  assert.deepEqual(g.result(0), { kind: 'win', winner: 0 });
  assert.equal(g.buttons('g:x', false, 0).length, 4);
  assert.ok(isPng(png(g.scene())));
});

test('mancala: sowing, free turn, capture, skipping the opponent store', () => {
  const p = newMancala();
  // Pit 3 (index 2) holds 4: lands in 3,4,5 and the store → free turn.
  const s = sow(p, 0, 2)!;
  assert.deepEqual(s.path, [3, 4, 5, 6]);
  assert.ok(s.extra);
  assert.equal(sow(p, 0, 2), null, 'empty pit');

  // Capture: last seed in an own empty pit with seeds opposite.
  const c = Array(14).fill(0);
  c[0] = 1;
  c[11] = 5; // opposite of index 1 (12 - 1)
  c[9] = 1; // keep both sides non-empty after the capture
  c[4] = 1;
  const cap = sow(c, 0, 0)!;
  assert.equal(cap.captured, 6);
  assert.equal(c[6], 6);
  assert.equal(c[1], 0);
  assert.equal(c[11], 0);

  // A big pit skips the opponent's store.
  const big = Array(14).fill(0);
  big[5] = 9;
  big[8] = 1;
  const path = sow(big, 0, 5)!.path;
  assert.ok(!path.includes(13));

  // Game over sweeps remaining seeds.
  const end = Array(14).fill(0);
  end[5] = 1;
  end[7] = 3;
  const over = sow(end, 0, 5)!;
  assert.ok(over.over);
  assert.equal(end[6], 1);
  assert.equal(end[13], 3);

  const g = mancala();
  assert.equal(g.move('2', 0), 'again');
  assert.equal(g.move('9', 0), false);
  assert.equal(g.buttons('m:x', false, 1).length, 2);
  assert.ok(isPng(png(g.scene())));
});

test('higher or lower: ties are safe, a wrong call loses', () => {
  const c = (rank: number): PlayingCard => ({ rank, suit: 'hearts' });
  assert.ok(callHolds('higher', c(5), c(9)));
  assert.ok(!callHolds('higher', c(9), c(5)));
  assert.ok(callHolds('lower', c(7), c(7)));
  assert.equal(fullDeck().length, 52);

  // Deck pops from the end: first card 5, then 9, then 2.
  const g = higherLower([c(2), c(9), c(5)]);
  assert.equal(g.move('sideways', 0), false);
  assert.ok(g.move('higher', 0));
  assert.equal(g.result(0), null);
  assert.ok(g.move('higher', 1));
  assert.deepEqual(g.result(1), { kind: 'win', winner: 0 });
  assert.ok(isPng(png(g.scene())));
});

test('hangman rules: letters, lives, whole-answer guesses', () => {
  assert.equal(maskWord('ice cream', new Set(['c', 'e'])), '_ce c_e__');
  assert.ok(isSolved('go-go', new Set(['g', 'o'])));

  const h = hangmanRules();
  assert.ok('error' in h.parseSecret('a1'));
  assert.ok('error' in h.parseSecret('aaaa'));
  const random = h.parseSecret('');
  assert.ok('value' in random && /^[a-z]{4,12}$/.test(random.value));
  h.setSecret(0, 'apple'); // seat 1 solves this
  h.setSecret(1, 'kiwi'); // seat 0 solves this
  assert.match((h.guess(0, 'k') as { note: string }).note, /1 × K/);
  assert.ok('error' in h.guess(0, 'k'), 'repeat letters are refused');
  assert.ok('error' in h.guess(0, '7'));
  h.guess(0, 'z');
  assert.match((h.guess(0, 'z') as { error: string }).error, /already/);
  assert.equal(h.solved(0), false);
  h.guess(0, 'kiwi');
  assert.ok(h.solved(0));
  for (const l of 'bcdfgh') h.guess(1, l);
  assert.ok(h.failed(1));
  assert.ok(isPng(png(h.scene(0, -1, true, false))));
});

test('number duel rules: narrowing range and solving', () => {
  const n = numberRules(100);
  assert.ok('error' in n.parseSecret('0'));
  assert.ok('error' in n.parseSecret('101'));
  assert.ok('error' in n.parseSecret('4.5'));
  n.setSecret(0, '30');
  n.setSecret(1, '77');
  assert.match((n.guess(0, '50') as { note: string }).note, /higher/);
  assert.match((n.guess(1, '50') as { note: string }).note, /lower/);
  assert.match((n.guess(0, '77') as { note: string }).note, /that's it/);
  assert.ok(n.solved(0));
  assert.ok(!n.solved(1));
  assert.ok(isPng(png(n.scene(1, -1, false, false))));
});

test('all commands have unique names and valid payloads', () => {
  const names = commands.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  for (const c of commands) {
    const json = c.toJSON();
    assert.match(json.name, /^[a-z-]{1,32}$/);
    assert.ok(json.description.length <= 100, `${json.name} description too long`);
  }
});
