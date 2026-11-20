import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { helpText } from '../src/commands/meta.js';
import { BUILTIN_QUIZZES } from '../src/activity/data/quizzes.js';
import { sanitizeQuiz } from '../src/shared/quiz.js';
import { CATEGORY_LABELS, TRIVIA } from '../src/games/data/trivia.js';
import { PAIR_DAILY_LIMIT, takePairSlot } from '../src/games/duel.js';
import { JUST_FOR_FUN } from '../src/shared/protocol.js';
import { simulate } from '../src/games/royale.js';
import { periodRange, ScoreStore, type Period } from '../src/store.js';

test('royale always produces exactly one winner', async () => {
  for (let n = 2; n <= 40; n += 7) {
    const players = Array.from({ length: n }, (_, i) => String(i));
    let lastAlive = -1;
    const { winner, rounds } = await simulate(players, new AbortController().signal, async (_r, lines, alive) => {
      assert.ok(lines.length > 0);
      lastAlive = alive;
    }, 0);
    assert.ok(winner && players.includes(winner));
    assert.equal(lastAlive, 1);
    assert.ok(rounds < 200);
  }
});

test('royale can be aborted', async () => {
  const ac = new AbortController();
  ac.abort();
  const { winner } = await simulate(['a', 'b', 'c'], ac.signal, async () => {}, 0);
  assert.equal(winner, null);
});

test('trivia questions are well-formed', () => {
  for (const q of TRIVIA) {
    assert.equal(new Set(q.answers).size, 4, `duplicate answers: ${q.question}`);
    assert.ok(q.answers.every((a) => a.length <= 76), `answer too long for a button: ${q.question}`);
  }
  assert.equal(new Set(TRIVIA.map((q) => q.question)).size, TRIVIA.length, 'duplicate trivia question');
  // A game can ask up to 20 questions from one category.
  for (const cat of Object.keys(CATEGORY_LABELS)) {
    assert.ok(TRIVIA.filter((q) => q.category === cat).length >= 20, `too few questions in ${cat}`);
  }
});

test('built-in quizzes pass the quiz validator unchanged', () => {
  assert.equal(new Set(BUILTIN_QUIZZES.map((q) => q.id)).size, BUILTIN_QUIZZES.length, 'duplicate quiz id');
  for (const quiz of BUILTIN_QUIZZES) {
    assert.ok(quiz.id.startsWith('builtin:'), quiz.id);
    const clean = sanitizeQuiz(quiz);
    assert.notEqual(typeof clean, 'string', `${quiz.title}: ${String(clean)}`);
    assert.deepEqual(clean, { title: quiz.title, questions: quiz.questions }, `${quiz.title} was altered by the validator`);
    for (const q of quiz.questions) assert.equal(new Set(q.answers).size, q.answers.length, `duplicate answers: ${q.q}`);
  }
});

test('score store: record, leaderboard, opt-out, forget, wipe, retention', () => {
  const dir = mkdtempSync(join(tmpdir(), 'games-'));
  const store = new ScoreStore(dir);
  // Every scored game needs a second player; 'x' plays along with 0 points.
  const x = { userId: 'x', points: 0, won: false };
  try {
    store.record('g1', 'trivia', [
      { userId: 'u1', points: 300, won: true },
      { userId: 'u2', points: 100, won: false },
    ]);
    store.record('g1', 'trivia', [{ userId: 'u1', points: 50, won: false }, x]);
    store.record('g2', 'royale', [{ userId: 'u1', points: 120, won: true }, x]);

    const lb = store.leaderboard('g1', 'trivia');
    assert.deepEqual(lb.map((r) => [r.user_id, r.points, r.wins, r.games_played]), [['u1', 350, 1, 2], ['u2', 100, 0, 1], ['x', 0, 0, 1]]);
    assert.equal(store.leaderboard('g2', null).length, 2);

    store.setOptOut('u2', true);
    assert.equal(store.userData('u2').rows.length, 0, 'opt-out deletes existing rows');
    assert.equal(store.userData('u2').days.length, 0, 'opt-out deletes daily rows');
    store.record('g1', 'trivia', [{ userId: 'u2', points: 999, won: true }, x]);
    assert.equal(store.userData('u2').rows.length, 0, 'opted-out users are not recorded');
    store.setOptOut('u2', false);
    assert.equal(store.userData('u2').optedOut, false);

    assert.equal(store.forgetUser('u1'), 2);
    assert.equal(store.userData('u1').days.length, 0);
    assert.equal(store.wipeGuild('g1'), 1);
    assert.equal(store.leaderboard('g1', null, 10, 'day').length, 0, 'wipe clears daily rows');

    store.record('g3', 'drawing', [{ userId: 'u4', points: 10, won: false }, x]);
    assert.equal(store.purgeOlderThan(1), 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('score store: solo games and duplicate players do not count', () => {
  const dir = mkdtempSync(join(tmpdir(), 'games-'));
  const store = new ScoreStore(dir);
  try {
    assert.equal(store.record('g1', 'quiz', [{ userId: 'u1', points: 500, won: true }]), false);
    assert.equal(store.record('g1', 'quiz', [{ userId: 'u1', points: 500, won: true }, { userId: 'u1', points: 500, won: true }]), false);
    assert.equal(store.record(null, 'quiz', [{ userId: 'u1', points: 1, won: true }, { userId: 'u2', points: 1, won: false }]), false);
    assert.equal(store.leaderboard('g1', null).length, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('score store: daily, weekly and monthly boards', () => {
  const dir = mkdtempSync(join(tmpdir(), 'games-'));
  const store = new ScoreStore(dir);
  const at = (iso: string) => Date.parse(iso);
  const game = (who: string, points: number, when: string) => store.record('g', 'trivia', [{ userId: who, points, won: true }, { userId: 'x', points: 0, won: false }], at(when));
  try {
    game('old', 900, '2026-10-30T12:00:00Z'); // last month
    game('mon', 50, '2026-11-16T09:00:00Z'); // Monday, this week
    game('sun', 70, '2026-11-15T23:00:00Z'); // Sunday, last week but this month
    game('today', 30, '2026-11-18T08:00:00Z');
    game('today', 30, '2026-11-18T09:00:00Z');
    const now = at('2026-11-18T20:00:00Z'); // a Wednesday
    const ids = (p: Period) => store.leaderboard('g', null, 10, p, now).filter((r) => r.user_id !== 'x').map((r) => `${r.user_id}:${r.points}`);
    assert.deepEqual(ids('day'), ['today:60']);
    assert.deepEqual(ids('week'), ['today:60', 'mon:50']);
    assert.deepEqual(ids('month'), ['sun:70', 'today:60', 'mon:50']);
    assert.deepEqual(ids('all'), ['old:900', 'sun:70', 'today:60', 'mon:50']);
    assert.equal(store.rankOf('g', 'mon', null, 'month', now)?.rank, 3);
    assert.equal(store.rankOf('g', 'old', null, 'week', now), null);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('periodRange: UTC days, Monday weeks, calendar months', () => {
  const wed = Date.parse('2026-11-18T20:00:00Z');
  assert.deepEqual(periodRange('day', wed), { from: '2026-11-18', resetsAt: Date.parse('2026-11-19T00:00:00Z') });
  assert.deepEqual(periodRange('week', wed), { from: '2026-11-16', resetsAt: Date.parse('2026-11-23T00:00:00Z') });
  assert.deepEqual(periodRange('week', Date.parse('2026-11-22T23:59:00Z')).from, '2026-11-16', 'Sunday is the last day of the week');
  assert.deepEqual(periodRange('month', Date.parse('2026-12-31T23:00:00Z')), { from: '2026-12-01', resetsAt: Date.parse('2027-01-01T00:00:00Z') });
});

test('duels: the same pair scores at most 5 games of one duel per day', () => {
  const now = Date.parse('2026-11-18T10:00:00Z');
  const pair = ['a', 'b'] as const;
  for (let i = 0; i < PAIR_DAILY_LIMIT; i++) assert.equal(takePairSlot('g', 'tictactoe', pair, now), true);
  assert.equal(takePairSlot('g', 'tictactoe', ['b', 'a'], now), false, 'order does not matter');
  assert.equal(takePairSlot('g', 'mancala', pair, now), true, 'other games are separate');
  assert.equal(takePairSlot('g', 'tictactoe', pair, now + 86_400_000), true, 'resets the next day');
});

test('help text fits in one message and carries the disclaimer', () => {
  const text = helpText();
  assert.ok(text.length < 3800, `help is ${text.length} chars`);
  assert.ok(text.includes(JUST_FOR_FUN));
});

test('/menu fits Discord limits and only names commands that exist', async () => {
  const { GUIDE, guideCard } = await import('../src/commands/menu.js');
  const { commands } = await import('../src/commands/index.js');
  const { GAMES } = await import('../src/shared/protocol.js');
  assert.ok(GUIDE.length + 1 <= 25, `${GUIDE.length} dropdown options`);
  assert.equal(new Set(GUIDE.map((g) => g.id)).size, GUIDE.length);
  const names = new Set(commands.map((c) => c.name));
  for (const g of GUIDE) {
    assert.ok(g.name.length <= 100 && g.short.length <= 90, g.id);
    const { body } = guideCard(g.id);
    assert.ok(body.length > 40 && body.length < 3500, g.id);
    for (const [, cmd] of g.start.matchAll(/`\/([a-z-]+)/g)) assert.ok(names.has(cmd!), `${g.id} mentions /${cmd}`);
  }
  // Every Activity game is in the menu.
  for (const game of GAMES) assert.ok(GUIDE.some((g) => g.name === game.name), `${game.name} missing from /menu`);
  assert.ok(names.has('menu'));
  assert.ok(guideCard(null).body.includes('Pick a game'));
});
