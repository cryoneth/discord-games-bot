import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { TRIVIA } from '../src/games/data/trivia.js';
import { simulate } from '../src/games/royale.js';
import { ScoreStore } from '../src/store.js';

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
});

test('score store: record, leaderboard, opt-out, forget, wipe, retention', () => {
  const dir = mkdtempSync(join(tmpdir(), 'games-'));
  const store = new ScoreStore(dir);
  try {
    store.record('g1', 'trivia', [
      { userId: 'u1', points: 300, won: true },
      { userId: 'u2', points: 100, won: false },
    ]);
    store.record('g1', 'trivia', [{ userId: 'u1', points: 50, won: false }]);
    store.record('g2', 'royale', [{ userId: 'u1', points: 120, won: true }]);

    const lb = store.leaderboard('g1', 'trivia');
    assert.deepEqual(lb.map((r) => [r.user_id, r.points, r.wins, r.games_played]), [['u1', 350, 1, 2], ['u2', 100, 0, 1]]);
    assert.equal(store.leaderboard('g2', null).length, 1);

    store.setOptOut('u2', true);
    assert.equal(store.userData('u2').rows.length, 0, 'opt-out deletes existing rows');
    store.record('g1', 'trivia', [{ userId: 'u2', points: 999, won: true }]);
    assert.equal(store.userData('u2').rows.length, 0, 'opted-out users are not recorded');
    store.setOptOut('u2', false);
    assert.equal(store.userData('u2').optedOut, false);

    assert.equal(store.forgetUser('u1'), 2);
    store.record('g1', 'drawing', [{ userId: 'u3', points: 10, won: false }]);
    assert.equal(store.wipeGuild('g1'), 1);

    store.record('g3', 'drawing', [{ userId: 'u4', points: 10, won: false }]);
    assert.equal(store.purgeOlderThan(1), 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
