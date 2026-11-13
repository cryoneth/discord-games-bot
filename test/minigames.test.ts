import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fourInARow, ticTacToe } from '../src/games/boardgames.js';
import { VALID_GUESSES } from '../src/games/data/dictionary.js';
import { ANSWERS } from '../src/games/data/fiveletter.js';
import { WYR } from '../src/games/data/wyr.js';
import { dropPiece, lineWinner, rpsWinner, scoreGuess, winningLine, type Cell } from '../src/games/logic.js';
import { bannerScene, rpsScene, wordGridScene } from '../src/render/boards.js';
import { card, sceneImage } from '../src/ui/card.js';
import { voteSummary } from '../src/games/wyr.js';

test('lineWinner finds rows, columns and both diagonals', () => {
  const b = (s: string) => [...s].map(Number) as Cell[];
  assert.equal(lineWinner(b('111000000'), 3, 3, 3), 1);
  assert.equal(lineWinner(b('200200200'), 3, 3, 3), 2);
  assert.equal(lineWinner(b('100010001'), 3, 3, 3), 1);
  assert.equal(lineWinner(b('001010100'), 3, 3, 3), 1);
  assert.equal(lineWinner(b('120210102'), 3, 3, 3), 0);
});

test('dropPiece stacks from the bottom and rejects full columns', () => {
  const board: Cell[] = Array(6).fill(0); // 2 wide, 3 tall
  assert.equal(dropPiece(board, 2, 3, 0, 1), 4);
  assert.equal(dropPiece(board, 2, 3, 0, 2), 2);
  assert.equal(dropPiece(board, 2, 3, 0, 1), 0);
  assert.equal(dropPiece(board, 2, 3, 0, 2), -1);
  assert.equal(dropPiece(board, 2, 3, 5, 1), -1);
});

test('tic-tac-toe game: illegal moves, win, draw', () => {
  const g = ticTacToe();
  assert.equal(g.move('9', 0), false);
  assert.equal(g.move('x', 0), false);
  assert.ok(g.move('0', 0));
  assert.equal(g.move('0', 1), false, 'occupied');
  g.move('3', 1);
  g.move('1', 0);
  g.move('4', 1);
  assert.equal(g.result(1), null);
  g.move('2', 0);
  assert.deepEqual(g.result(0), { kind: 'win', winner: 0 });

  const d = ticTacToe();
  // X O X / X O O / O X X → no line
  for (const [cell, seat] of [[0, 0], [1, 1], [2, 0], [4, 1], [3, 0], [5, 1], [7, 0], [6, 1], [8, 0]] as const) d.move(String(cell), seat);
  assert.deepEqual(d.result(0), { kind: 'draw' });
});

test('four in a row: vertical win and view renders', () => {
  const g = fourInARow();
  for (let i = 0; i < 3; i++) {
    g.move('3', 0);
    g.move('4', 1);
  }
  assert.equal(g.result(1), null);
  g.move('3', 0);
  assert.deepEqual(g.result(0), { kind: 'win', winner: 0 });
  assert.equal(g.buttons('fourinarow:x', true).length, 2);
  const scene = g.scene();
  assert.ok(scene.w > 0 && scene.h > 0);
});

test('winningLine returns the cells of the line', () => {
  const b = [...'000111000'].map(Number) as Cell[];
  assert.deepEqual(winningLine(b, 3, 3, 3), [3, 4, 5]);
  assert.deepEqual(winningLine(Array(9).fill(0) as Cell[], 3, 3, 3), []);
});

test('renderers produce valid PNGs and looping GIFs', () => {
  const t = ticTacToe();
  t.move('0', 0);
  const still = sceneImage(t.scene(), 'b', 'board');
  assert.equal(still.name, 'b.png');
  assert.deepEqual([...still.data.subarray(1, 4)].map((c) => String.fromCharCode(c)).join(''), 'PNG');

  const word = wordGridScene([{ word: 'crane', score: scoreGuess('crane', 'crane') }], 6, 0);
  const anim = sceneImage(word, 'w', 'grid', true);
  assert.equal(anim.name, 'w.gif');
  assert.equal(anim.data.subarray(0, 6).toString('ascii'), 'GIF89a');
  assert.ok(anim.data.length < 2_000_000, 'GIF stays small');

  for (const s of [rpsScene('rock', 'paper', 2), bannerScene('A VERY LONG TITLE THAT MUST SHRINK TO FIT', 'sub', '#fff')]) {
    assert.ok(sceneImage(s, 'x', 'x').data.length > 1000);
  }
});

test('card builds a Components V2 payload with the image attached', () => {
  const c = card({ color: 1, title: 'T', body: 'B', image: { name: 'i.png', data: Buffer.from('x') }, footer: 'F' });
  assert.equal(c.files.length, 1);
  assert.deepEqual(c.attachments, []);
  const json = JSON.stringify(c.components[0]!.toJSON());
  assert.match(json, /attachment:\/\/i\.png/);
  assert.match(json, /### T\\nB/);
});

test('scoreGuess handles repeated letters like the classic rules', () => {
  const s = (g: string, a: string) => scoreGuess(g, a).map((x) => x[0]).join('');
  assert.equal(s('crane', 'crane'), 'hhhhh');
  assert.equal(s('eerie', 'crane'), 'mmnmh'); // only the final E counts
  assert.equal(s('speed', 'abide'), 'mmnmn'); // one E near, D near
  assert.equal(s('llama', 'hello'), 'nnmmm');
});

test('rps winner', () => {
  assert.equal(rpsWinner('rock', 'scissors'), 1);
  assert.equal(rpsWinner('rock', 'paper'), 2);
  assert.equal(rpsWinner('paper', 'paper'), 0);
  assert.equal(rpsWinner('scissors', 'paper'), 1);
});

test('content is well-formed', () => {
  for (const w of ANSWERS) assert.match(w, /^[a-z]{5}$/, `bad answer: ${w}`);
  assert.equal(new Set(ANSWERS).size, ANSWERS.length, 'duplicate answers');
  for (const w of ANSWERS) assert.ok(VALID_GUESSES.has(w), `answer missing from dictionary: ${w}`);
  for (const w of VALID_GUESSES) assert.match(w, /^[a-z]{5}$/, `bad dictionary word: ${w}`);
  for (const w of ['cakes', 'jumps', 'emoji']) assert.ok(VALID_GUESSES.has(w), w);
  for (const w of ['aeiou', 'zzzzz', 'qwert']) assert.ok(!VALID_GUESSES.has(w), w);
  for (const [a, b] of WYR) assert.ok(a.length <= 80 && b.length <= 80, `too long for a button: ${a} / ${b}`);
  assert.match(voteSummary(['A', 'B'], [3, 1]), /75%/);
  assert.match(voteSummary(['A', 'B'], [0, 0]), /0%/);
});
