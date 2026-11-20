import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyResult, pairUp, rankEntries } from '../src/activity/chess/arena.js';
import { ChessGame } from '../src/activity/chess/game.js';
import { ChessService, type ChessListener, type TourneyEvent } from '../src/activity/chess/service.js';
import { ChessRoom } from '../src/activity/games/chess.js';
import { Hub } from '../src/activity/hub.js';
import { gameFactory } from '../src/activity/games/index.js';
import { parseOffset, parseStart } from '../src/commands/tournament.js';
import { arenaPoints, checkTourneySettings, FIRST_MOVE_MS, type MyBoardView } from '../src/shared/chess.js';
import { ScoreStore, type GameResult } from '../src/store.js';

type Msg = { t: string } & Record<string, any>;

function fakeClock(start = Date.UTC(2026, 10, 20, 12)) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function newGame(clock = fakeClock(), tc: '1+0' | '3+2' = '3+2', tourneyId: string | null = null) {
  const ends: ChessGame[] = [];
  const game = new ChessGame({
    id: 'g1',
    white: { id: 'W', name: 'White' },
    black: { id: 'B', name: 'Black' },
    tc,
    tourneyId,
    now: clock.now,
    timers: false,
    onChange: () => {},
    onEnd: (g) => ends.push(g),
  });
  return { game, ends, clock };
}

function play(game: ChessGame, ...moves: string[]) {
  for (const m of moves) assert.equal(game.move(game.turn === 'w' ? 'W' : 'B', m), null, `move ${m}`);
}

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'chess-test-'));
  const store = new ScoreStore(dir);
  return { store, dir, done: () => (store.close(), rmSync(dir, { recursive: true, force: true })) };
}

// ── Game ───────────────────────────────────────────────────────────────────

test('chess: legal moves, turn order and checkmate', () => {
  const { game, ends } = newGame();
  assert.match(game.move('B', 'e7e5')!, /not your turn/);
  assert.match(game.move('W', 'e2e5')!, /not legal/);
  assert.match(game.move('X', 'e2e4')!, /not playing/);
  play(game, 'f2f3', 'e7e5', 'g2g4', 'd8h4');
  assert.equal(game.result, '0-1');
  assert.equal(game.reason, 'checkmate');
  assert.equal(ends.length, 1);
  assert.match(game.move('W', 'a2a3')!, /over/);
});

test('chess: legal moves are only sent to the player to move, with promotions', () => {
  const { game } = newGame();
  const w = game.viewFor('W') as MyBoardView;
  assert.equal(w.color, 'w');
  assert.equal(w.legal.length, 20);
  assert.equal((game.viewFor('B') as MyBoardView).legal.length, 0);
  assert.equal('legal' in game.viewFor('someone'), false, 'spectators get no move list');
});

test('chess: clocks start after both first moves, with increment, and flag on time', () => {
  const clock = fakeClock();
  const { game } = newGame(clock, '1+0');
  clock.advance(10_000);
  play(game, 'e2e4');
  clock.advance(10_000);
  play(game, 'e7e5');
  assert.equal(game.clock('w'), 60_000, 'no time used before the clocks run');
  clock.advance(59_000);
  assert.equal(game.check(), false);
  clock.advance(2000);
  assert.equal(game.check(), true);
  assert.equal(game.result, '0-1');
  assert.equal(game.reason, 'timeout');
  assert.equal(game.clock('w'), 0);
});

test('chess: increment is added after each timed move', () => {
  const clock = fakeClock();
  const { game } = newGame(clock, '3+2');
  play(game, 'e2e4', 'e7e5');
  clock.advance(5000);
  play(game, 'g1f3');
  assert.equal(game.clock('w'), 180_000 - 5000 + 2000);
});

test('chess: no first move aborts a casual game but loses a tournament game', () => {
  const c1 = newGame();
  c1.clock.advance(FIRST_MOVE_MS + 1);
  c1.game.check();
  assert.equal(c1.game.result, '*');
  assert.equal(c1.game.reason, 'aborted');

  const c2 = newGame(fakeClock(), '3+2', 't1');
  play(c2.game, 'e2e4');
  c2.clock.advance(FIRST_MOVE_MS + 1);
  c2.game.check();
  assert.equal(c2.game.result, '1-0', 'black never moved');
  assert.equal(c2.game.reason, 'nostart');
});

test('chess: draw offers, declines by moving, and agreement', () => {
  const { game } = newGame();
  assert.match(game.draw('W')!, /move first/i);
  play(game, 'e2e4', 'e7e5');
  assert.equal(game.draw('W'), null);
  assert.equal(game.view().drawOffer, 'w');
  play(game, 'g1f3', 'b8c6'); // black moving declines it
  assert.equal(game.view().drawOffer, null);
  game.draw('B');
  game.draw('W', true);
  assert.equal(game.result, '1/2-1/2');
  assert.equal(game.reason, 'agreement');
});

test('chess: resigning before both moved aborts casual games', () => {
  const a = newGame();
  a.game.resign('W');
  assert.equal(a.game.result, '*');
  const b = newGame();
  play(b.game, 'e2e4', 'e7e5');
  b.game.resign('W');
  assert.equal(b.game.result, '0-1');
});

test('chess: berserk halves the clock, only in tournaments before your first move', () => {
  const casual = newGame();
  casual.game.berserk('W');
  assert.equal(casual.game.clock('w'), 180_000);
  const t = newGame(fakeClock(), '3+2', 't1');
  t.game.berserk('W');
  assert.equal(t.game.clock('w'), 90_000);
  play(t.game, 'e2e4');
  t.game.berserk('W');
  assert.equal(t.game.clock('w'), 90_000, 'only once');
  t.game.berserk('B');
  assert.equal(t.game.clock('b'), 90_000);
});

test('chess: moderator decisions', () => {
  const { game } = newGame();
  play(game, 'e2e4', 'e7e5');
  game.decide('0-1');
  assert.equal(game.result, '0-1');
  assert.equal(game.reason, 'moderator');
});

// ── Arena rules ────────────────────────────────────────────────────────────

test('arena: scoring with streaks, berserk and early draws', () => {
  assert.deepEqual(arenaPoints('win', 0, { plies: 30 }), { points: 2, streak: 1 });
  assert.deepEqual(arenaPoints('win', 2, { plies: 30 }), { points: 4, streak: 3 }, 'on fire');
  assert.deepEqual(arenaPoints('draw', 2, { plies: 30 }), { points: 2, streak: 0 });
  assert.deepEqual(arenaPoints('draw', 0, { plies: 10 }), { points: 0, streak: 0 }, 'early draw');
  assert.deepEqual(arenaPoints('win', 0, { plies: 14, berserk: true }), { points: 3, streak: 1 });
  assert.deepEqual(arenaPoints('win', 0, { plies: 8, berserk: true }), { points: 2, streak: 1 }, 'too short for the berserk point');
  assert.deepEqual(arenaPoints('loss', 5, { plies: 30 }), { points: 0, streak: 0 });

  const e = { score: 0, wins: 0, draws: 0, losses: 0, games: 0, streak: 0, sheet: [] as number[] };
  for (let i = 0; i < 3; i++) applyResult(e, 'win', { berserk: false, plies: 40 });
  applyResult(e, 'loss', { berserk: false, plies: 40 });
  assert.deepEqual(e.sheet, [2, 2, 4, 0]);
  assert.equal(e.score, 8);
});

test('arena: pairing by score, avoiding instant rematches, fair colours', () => {
  const rnd = () => 0.3;
  const pairs = pairUp(
    [
      { id: 'a', score: 10, lastOpp: 'b', colorBalance: 1 },
      { id: 'b', score: 9, lastOpp: 'a', colorBalance: -1 },
      { id: 'c', score: 8, lastOpp: null, colorBalance: 0 },
      { id: 'd', score: 1, lastOpp: null, colorBalance: 0 },
    ],
    rnd,
  );
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs[0], ['c', 'a'], 'a avoids b; c has played white less');
  assert.deepEqual(new Set(pairs[1]), new Set(['b', 'd']));
  // Only two people waiting: they may play again.
  assert.equal(pairUp([{ id: 'a', score: 0, lastOpp: 'b', colorBalance: 0 }, { id: 'b', score: 0, lastOpp: 'a', colorBalance: 0 }]).length, 1);
  const ranked = rankEntries([
    { id: 'x', score: 4, wins: 2, games: 3, joinedAt: 1, draws: 0, losses: 0, streak: 0, sheet: [] },
    { id: 'y', score: 4, wins: 2, games: 2, joinedAt: 2, draws: 0, losses: 0, streak: 0, sheet: [] },
  ]);
  assert.equal(ranked[0]!.id, 'y', 'same points in fewer games ranks higher');
});

test('tournament settings are validated', () => {
  const now = Date.now();
  const ok = { name: 'Friday Blitz', startsAt: now + 3_600_000, durationMin: 60, tc: '3+2' as const, maxPlayers: 50 };
  assert.equal(checkTourneySettings(ok, now), null);
  assert.match(checkTourneySettings({ ...ok, maxPlayers: 51 }, now)!, /between/);
  assert.match(checkTourneySettings({ ...ok, startsAt: now - 3_600_000 }, now)!, /past/);
  assert.match(checkTourneySettings({ ...ok, durationMin: 7 }, now)!, /Duration/);
  assert.match(checkTourneySettings({ ...ok, name: '   ' }, now)!, /name/);
  assert.match(checkTourneySettings({ tc: '5+0' }, now, { running: true })!, /started/);
  assert.match(checkTourneySettings({ maxPlayers: 4 }, now, { entries: 6 })!, /already joined/);
});

test('start times: relative, clock, date, offsets', () => {
  const now = Date.UTC(2026, 10, 20, 12, 0);
  assert.equal(parseStart('now', 0, now), now);
  assert.equal(parseStart('in 2h', 0, now), now + 7_200_000);
  assert.equal(parseStart('1h30m', 0, now), now + 5_400_000);
  assert.equal(parseStart('18:30', 0, now), Date.UTC(2026, 10, 20, 18, 30));
  assert.equal(parseStart('09:00', 0, now), Date.UTC(2026, 10, 21, 9, 0), 'already past today: tomorrow');
  assert.equal(parseStart('18:30', 60, now), Date.UTC(2026, 10, 20, 17, 30), 'UTC+1');
  assert.equal(parseStart('2026-12-01 18:30', -300, now), Date.UTC(2026, 11, 1, 23, 30), 'UTC-5');
  assert.equal(parseStart('<t:1795000000:F>', 0, now), 1_795_000_000_000);
  assert.equal(parseStart('tomorrowish', 0, now), null);
  assert.equal(parseStart('25:00', 0, now), null);
  assert.equal(parseOffset('+5:30'), 330);
  assert.equal(parseOffset('UTC-5'), -300);
  assert.equal(parseOffset(null), 0);
  assert.equal(parseOffset('+20'), null);
});

// ── Tournaments ────────────────────────────────────────────────────────────

function listener(scope: string, online: string[]): ChessListener & { games: ChessGame[]; notes: string[] } {
  const games: ChessGame[] = [];
  const notes: string[] = [];
  return { scope, has: (id) => online.includes(id), gameChanged: (g) => games.push(g), lobbyChanged: () => {}, notify: (_u, t) => notes.push(t), games, notes };
}

function service(store: ScoreStore, clock: ReturnType<typeof fakeClock>) {
  const events: TourneyEvent[] = [];
  const recorded: GameResult[][] = [];
  const svc = new ChessService({
    repo: store.chess(),
    record: (_g, r) => (recorded.push(r), true),
    announce: (ev) => events.push(ev),
    now: clock.now,
    timers: false,
    rnd: () => 0.5,
  });
  return { svc, events, recorded };
}

test('tournament: schedule, join, start, auto-pair, score, finish and record', () => {
  const { store, done } = tempStore();
  const clock = fakeClock();
  const { svc, events, recorded } = service(store, clock);
  const online = ['A', 'B', 'C'];
  const l = listener('guild', online);
  svc.attach(l);

  const res = svc.create('guild', 'chan', 'MOD', { name: 'Arena', startsAt: clock.now() + 60_000, durationMin: 20, tc: '1+0', maxPlayers: 2 });
  assert.ok('row' in res);
  const id = res.row.id;
  assert.equal(events[0]!.kind, 'created');
  assert.equal(svc.join('guild', id, 'A'), null);
  assert.equal(svc.join('guild', id, 'B'), null);
  assert.match(svc.join('guild', id, 'C')!, /full/);
  assert.equal(svc.edit('guild', id, { maxPlayers: 3 }), null);
  assert.equal(svc.join('guild', id, 'C'), null);

  svc.tick();
  assert.equal(svc.liveGames('guild').length, 0, 'not started yet');
  clock.advance(60_000);
  svc.tick();
  assert.equal(events.at(-1)!.kind, 'started');
  const [g] = svc.liveGames('guild');
  assert.ok(g, 'two of the three were paired');
  assert.equal(g!.tourneyId, id);

  // White mates quickly-ish: scholar's mate.
  const w = g!.white.id;
  const b = g!.black.id;
  for (const [i, m] of ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'].entries()) assert.equal(g!.move(i % 2 ? b : w, m), null);
  assert.equal(g!.result, '1-0');
  assert.deepEqual(g!.points, { w: 2, b: 0 });

  const view = svc.views('guild', w).find((v) => v.id === id)!;
  assert.equal(view.standings[0]!.id, w);
  assert.equal(view.standings[0]!.score, 2);
  assert.equal(view.joined, true);

  // Time runs out; the tournament ends once no games are left.
  clock.advance(20 * 60_000);
  svc.tick();
  assert.equal(events.at(-1)!.kind, 'finished');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]![0]!.userId, w);
  assert.equal(recorded[0]![0]!.won, true);
  assert.equal(store.chess().getTourney(id)!.status, 'finished');
  assert.match(svc.join('guild', id, 'D')!, /over/);
  svc.dispose();
  done();
});

test('tournament: standings survive a restart; kick and remove', () => {
  const { store, done } = tempStore();
  const clock = fakeClock();
  const first = service(store, clock);
  const res = first.svc.create('guild', '', 'MOD', { name: 'Keep', startsAt: clock.now(), durationMin: 60, tc: '3+2', maxPlayers: 10 });
  assert.ok('row' in res);
  first.svc.join('guild', res.row.id, 'A');
  first.svc.join('guild', res.row.id, 'B');
  first.svc.tick();
  first.svc.dispose();

  const second = service(store, clock);
  const row = second.svc.get('guild', res.row.id)!;
  assert.equal(row.status, 'running');
  assert.equal(second.svc.views('guild', 'A')[0]!.standings.length, 2);
  assert.equal(second.svc.kick('guild', row.id, 'B'), null);
  assert.match(second.svc.join('guild', row.id, 'B')!, /removed/);
  assert.equal(second.svc.views('guild', 'A')[0]!.standings.length, 1);
  assert.equal(second.svc.views('other', 'A').length, 0, 'tournaments belong to one server');
  assert.equal(second.svc.remove('guild', row.id), 'Keep');
  assert.equal(store.chess().getTourney(row.id), null);
  assert.equal(second.events.at(-1)!.kind, 'cancelled');
  second.svc.dispose();
  done();
});

test('tournament: players who are offline or paused are not paired', () => {
  const { store, done } = tempStore();
  const clock = fakeClock();
  const { svc } = service(store, clock);
  const online = ['A', 'B'];
  svc.attach(listener('guild', online));
  const res = svc.create('guild', '', 'MOD', { name: 'P', startsAt: clock.now(), durationMin: 30, tc: '3+2', maxPlayers: 10 });
  assert.ok('row' in res);
  for (const u of ['A', 'B', 'C']) svc.join('guild', res.row.id, u);
  svc.pause('guild', res.row.id, 'B', true);
  svc.tick();
  assert.equal(svc.liveGames('guild').length, 0, 'C is offline and B paused');
  svc.pause('guild', res.row.id, 'B', false);
  svc.tick();
  assert.equal(svc.liveGames('guild').length, 1);
  svc.dispose();
  done();
});

test('forget-me and server wipe remove tournament data', () => {
  const { store, done } = tempStore();
  const clock = fakeClock();
  const { svc } = service(store, clock);
  const res = svc.create('guild', '', 'MOD', { name: 'W', startsAt: clock.now() + 60_000, durationMin: 30, tc: '3+2', maxPlayers: 10 });
  assert.ok('row' in res);
  svc.join('guild', res.row.id, 'A');
  assert.equal(store.userData('A').tournamentEntries.length, 1);
  assert.equal(store.userData('MOD').tournamentsCreated.length, 1);
  store.forgetUser('A');
  store.forgetUser('MOD');
  assert.equal(store.userData('A').tournamentEntries.length, 0);
  assert.equal(store.chess().getTourney(res.row.id)!.created_by, '');
  store.wipeGuild('guild');
  assert.equal(store.chess().getTourney(res.row.id), null);
  svc.dispose();
  done();
});

// ── Activity room ──────────────────────────────────────────────────────────

function client() {
  const inbox: Msg[] = [];
  return {
    conn: { send: (m: unknown) => inbox.push(m as Msg) },
    inbox,
    last: (t: string) => [...inbox].reverse().find((m) => m.t === t),
  };
}

test('chess room: challenge, accept, play, watch and moderator decisions', async () => {
  const { store, done } = tempStore();
  const svc = new ChessService({ repo: store.chess(), record: () => true, timers: false });
  const mods = new Set(['M']);
  const room = new ChessRoom({ instanceId: 'i', guildId: 'guild', channelId: null, onGameEnd: () => {}, isMod: (id) => mods.has(id) }, svc);
  const a = client();
  const b = client();
  const m = client();
  room.join({ id: 'A', name: 'Alice' }, a.conn);
  room.join({ id: 'B', name: 'Bob' }, b.conn);
  room.join({ id: 'M', name: 'Mia' }, m.conn);
  assert.equal(room.idle, true);

  room.handle('A', { t: 'challenge', tc: '5+0', color: 'w' });
  await new Promise((r) => setTimeout(r, 200));
  const lobby = b.last('lobby')!;
  assert.equal(lobby.challenges.length, 1);
  room.handle('B', { t: 'accept', id: lobby.challenges[0].id });
  const board = a.last('board')!.board as MyBoardView;
  assert.equal(board.color, 'w');
  assert.equal(board.white.name, 'Alice');
  assert.equal(room.idle, false, 'a live game keeps the host from switching games');

  room.handle('A', { t: 'move', uci: 'e2e4' });
  assert.equal(b.last('board')!.board.moves[0], 'e4');

  room.handle('M', { t: 'watch', id: board.id });
  assert.equal(m.last('board')!.board.id, board.id);
  assert.equal('legal' in m.last('board')!.board, false);

  room.handle('A', { t: 'decide', game: board.id, verdict: 'draw' });
  assert.equal(b.last('board')!.board.result, '*', 'players cannot decide games');
  room.handle('M', { t: 'decide', game: board.id, verdict: '1-0' });
  assert.equal(b.last('board')!.board.result, '1-0');
  assert.equal(b.last('board')!.board.reason, 'moderator');
  assert.equal(room.idle, true);

  room.handle('A', { t: 'tcreate', settings: { name: 'Nope', startsAt: Date.now() + 60_000, durationMin: 30, tc: '3+2', maxPlayers: 10 } });
  assert.equal(svc.list('guild').length, 0, 'only moderators create tournaments');
  room.handle('M', { t: 'tcreate', settings: { name: 'Mods Cup', startsAt: Date.now() + 60_000, durationMin: 30, tc: '3+2', maxPlayers: 10 } });
  assert.equal(svc.list('guild').length, 1);
  room.handle('M', { t: 'tedit', id: svc.list('guild')[0]!.id, settings: { name: 'Mods Cup II' } });
  assert.equal(svc.list('guild')[0]!.name, 'Mods Cup II');
  room.handle('M', { t: 'tdelete', id: svc.list('guild')[0]!.id });
  assert.equal(svc.list('guild').length, 0);

  room.dispose();
  svc.dispose();
  done();
});

test('hub: chess is in the factory and a moderator stop aborts games there', () => {
  const { store, done } = tempStore();
  const svc = new ChessService({ repo: store.chess(), record: () => true, timers: false });
  const hub = new Hub('i', 'guild', null, gameFactory({ store, chess: svc, onGameEnd: () => {} }));
  const a = client();
  const b = client();
  hub.join({ id: 'A', name: 'Alice' }, a.conn as never);
  hub.join({ id: 'B', name: 'Bob' }, b.conn as never);
  hub.handle('A', { t: 'choose', game: 'chess' });
  assert.equal(hub.currentGame, 'chess');
  hub.handle('A', { t: 'g', m: { t: 'challenge', tc: '3+2', color: 'random' } });
  const lobby = [...b.inbox].reverse().find((m) => m.t === 'g' && m.m.t === 'lobby');
  assert.ok(lobby);
  // The lobby is throttled; ask the room directly for the challenge id via a fresh accept attempt.
  const ch = (hub as any).room.challenges.values().next().value;
  hub.handle('B', { t: 'g', m: { t: 'accept', id: ch.id } });
  assert.equal(svc.liveGames('guild').length, 1);
  hub.forceStop('A moderator stopped the game.');
  assert.equal(svc.liveGames('guild').length, 0);
  assert.equal(hub.currentGame, null);
  hub.dispose();
  svc.dispose();
  done();
});
