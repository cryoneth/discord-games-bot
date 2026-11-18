import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { GameRoom, RoomContext, RoomResult } from '../src/activity/base.js';
import { ForbiddenRoom, usesForbidden } from '../src/activity/games/forbidden.js';
import { gameFactory } from '../src/activity/games/index.js';
import { MarketRoom } from '../src/activity/games/market.js';
import {
  checkTriggers,
  closePosition,
  deposit,
  exploitFarm,
  fundingRate,
  makePlan,
  newAccount,
  openPosition,
  PriceModel,
  seeded,
  settleFunding,
} from '../src/activity/games/market-engine.js';
import { OddOneOutRoom, revealsWord } from '../src/activity/games/oddoneout.js';
import { QuizRoom } from '../src/activity/games/quiz.js';
import { Hub } from '../src/activity/hub.js';
import type { ForbiddenStateMessage } from '../src/shared/forbidden.js';
import { equityOf, MARKET } from '../src/shared/market.js';
import type { OddStateMessage } from '../src/shared/oddoneout.js';
import type { ServerMessage } from '../src/shared/protocol.js';
import { answerPoints, sanitizeQuiz, streakBonus, type QuizStateMessage } from '../src/shared/quiz.js';
import { ScoreStore } from '../src/store.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Msg = { t: string } & Record<string, any>;

function client() {
  const inbox: Msg[] = [];
  return {
    conn: { send: (m: unknown) => inbox.push(m as Msg) },
    inbox,
    last: <T>(t: string) => [...inbox].reverse().find((m) => m.t === t) as T | undefined,
    texts: () => inbox.filter((m) => m.t === 'chat').map((m) => m.text as string),
  };
}

function ctx(onGameEnd: (r: RoomResult[]) => void = () => {}): RoomContext {
  return { instanceId: 'i', guildId: 'g', channelId: null, onGameEnd };
}

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'games-test-'));
  const store = new ScoreStore(dir);
  return { store, done: () => (store.close(), rmSync(dir, { recursive: true, force: true })) };
}

// ── Hub ────────────────────────────────────────────────────────────────────

test('hub: only the host picks games, and only between games', () => {
  const made: string[] = [];
  let idle = true;
  const fake = (): GameRoom => ({
    get idle() {
      return idle;
    },
    lastActivity: 0,
    join: (_u, conn) => (conn.send({ t: 'state', hello: true }), true),
    leave: () => {},
    handle: () => {},
    dispose: () => {},
  });
  const hub = new Hub('i', 'g', null, (game) => (made.push(game), fake()));
  const a = client();
  const b = client();
  hub.join({ id: 'A', name: 'Alice' }, a.conn as never);
  hub.join({ id: 'B', name: 'Bob' }, b.conn as never);
  assert.equal(a.last<Msg>('welcome')?.you, 'A');

  hub.handle('B', { t: 'choose', game: 'quiz' });
  assert.deepEqual(made, [], 'non-host cannot choose');
  hub.handle('A', { t: 'choose', game: 'nope' as never });
  assert.deepEqual(made, [], 'unknown game ignored');

  hub.handle('A', { t: 'choose', game: 'quiz' });
  assert.deepEqual(made, ['quiz']);
  assert.equal(b.last<Extract<ServerMessage, { t: 'hub' }>>('hub')?.game, 'quiz');
  // Game messages arrive wrapped in the envelope, after the hub update.
  const hubIdx = b.inbox.findLastIndex((m) => m.t === 'hub');
  const gIdx = b.inbox.findLastIndex((m) => m.t === 'g');
  assert.ok(gIdx > hubIdx);
  assert.equal(b.inbox[gIdx]!.m.t, 'state');

  idle = false;
  hub.handle('A', { t: 'menu' });
  assert.equal(hub.currentGame, 'quiz', 'cannot leave mid-game');
  idle = true;
  hub.handle('A', { t: 'menu' });
  assert.equal(hub.currentGame, null);

  // Late joiners are seated in the running game.
  hub.handle('A', { t: 'choose', game: 'market' });
  const c = client();
  hub.join({ id: 'C', name: 'Cara' }, c.conn as never);
  assert.equal(c.last<Msg>('g')?.m.t, 'state');
});

test('hub: moderators can stop a running game and take over as host', () => {
  let idle = false;
  let disposed = 0;
  const fake = (): GameRoom => ({
    get idle() {
      return idle;
    },
    lastActivity: 0,
    join: () => true,
    leave: () => {},
    handle: () => {},
    dispose: () => void disposed++,
  });
  const hub = new Hub('i', 'g', null, fake);
  const a = client();
  const b = client();
  const m = client();
  hub.join({ id: 'A', name: 'Alice' }, a.conn as never);
  hub.join({ id: 'B', name: 'Bob' }, b.conn as never);
  hub.join({ id: 'M', name: 'Mod', mod: true }, m.conn as never);
  assert.equal(m.last<Msg>('welcome')?.mod, true);
  assert.equal(b.last<Msg>('welcome')?.mod, false);

  idle = true;
  hub.handle('A', { t: 'choose', game: 'quiz' });
  idle = false;

  // Regular players can't stop someone else's game or take over.
  hub.handle('B', { t: 'menu' });
  hub.handle('B', { t: 'takeover' });
  assert.equal(hub.currentGame, 'quiz');
  assert.equal(hub.hostId(), 'A');

  // A moderator can stop it mid-game, and everyone is told.
  hub.handle('M', { t: 'menu' });
  assert.equal(hub.currentGame, null);
  assert.equal(disposed, 1);
  assert.match(a.last<Msg>('notice')?.text ?? '', /Mod \(moderator\) stopped the game/);

  // Moderators can pick games without being host, and take over as host.
  hub.handle('M', { t: 'choose', game: 'market' });
  assert.equal(hub.currentGame, 'market');
  hub.handle('M', { t: 'takeover' });
  assert.equal(hub.hostId(), 'M');
  assert.equal(a.last<Extract<ServerMessage, { t: 'hub' }>>('hub')?.players.find((p) => p.host)?.id, 'M');

  // `/mod stop` from Discord.
  hub.forceStop('A moderator stopped the game.');
  assert.equal(hub.currentGame, null);
  assert.equal(b.last<Msg>('notice')?.text, 'A moderator stopped the game.');
});

// ── Quiz ───────────────────────────────────────────────────────────────────

test('quiz: sanitizeQuiz validates and cleans', () => {
  assert.equal(typeof sanitizeQuiz({}), 'string');
  assert.match(sanitizeQuiz({ title: 'T', questions: [{ q: 'Q', answers: ['a'], correct: 0 }] }) as string, /2 to 4/);
  assert.match(sanitizeQuiz({ title: 'T', questions: [{ q: 'Q', answers: ['a', 'b'], correct: 2 }] }) as string, /correct/);
  assert.match(sanitizeQuiz({ title: 'T', questions: [{ q: 'Q', answers: ['a', 'A'], correct: 0 }] }) as string, /same answer/);
  const ok = sanitizeQuiz({ title: '  Hi\u0000 ', questions: [{ q: 'Q?', answers: ['a', 'b'], correct: 1, seconds: 999 }] });
  assert.deepEqual(ok, { title: 'Hi', questions: [{ q: 'Q?', answers: ['a', 'b'], correct: 1, seconds: 20 }] });
  assert.equal(answerPoints(0, 1000), 1000);
  assert.equal(answerPoints(1000, 1000), 500);
  assert.equal(streakBonus(1), 0);
  assert.equal(streakBonus(3), 200);
  assert.equal(streakBonus(50), 500);
});

test('quiz: saved quizzes are per server, author-only, and covered by privacy tools', () => {
  const { store, done } = tempStore();
  try {
    const repo = store.quizzes('g1');
    const draft = { title: 'Mine', questions: [{ q: 'Q', answers: ['a', 'b'], correct: 0, seconds: 20 }] };
    const res = repo.save('alice', draft);
    assert.ok('id' in res);
    assert.equal(repo.list('alice')[0]!.mine, true);
    assert.equal(repo.list('bob')[0]!.mine, false);
    assert.equal(store.quizzes('g2').list('alice').length, 0, 'other servers cannot see it');
    assert.ok('error' in repo.save('bob', draft, res.id), 'only the author edits');
    assert.equal(repo.remove('bob', res.id), false);
    assert.equal(store.userData('alice').quizzes.length, 1);
    assert.equal(store.forgetUser('alice'), 1);
    assert.equal(repo.list('alice').length, 0);
    repo.save('carol', draft);
    assert.equal(store.wipeGuild('g1'), 1);
    repo.save('dave', draft);
    assert.equal(store.purgeOlderThan(-1), 1, 'unused quizzes expire');
  } finally {
    done();
  }
});

test('quiz: full game with speed scoring, early reveal and no answer leaks', async () => {
  const { store, done } = tempStore();
  let results: RoomResult[] = [];
  try {
    const room = new QuizRoom(ctx((r) => (results = r)), store.quizzes('g'), { introMs: 10, revealMs: 10, secondMs: 20 });
    const a = client();
    const b = client();
    room.join({ id: 'A', name: 'Alice' }, a.conn);
    room.join({ id: 'B', name: 'Bob' }, b.conn);
    room.handle('A', { t: 'settings', settings: { quizId: 'builtin:crypto-basics', shuffle: false } });
    room.handle('A', { t: 'start' });
    assert.equal(room.currentPhase, 'intro');
    await wait(20);
    assert.equal(room.currentPhase, 'question');
    const st = a.last<QuizStateMessage>('state')!;
    assert.equal(st.question!.answers.length, 4);
    assert.equal(st.reveal, null);
    assert.ok(!JSON.stringify(st).includes('"correct"'), 'correct answer not sent during the question');

    room.handle('A', { t: 'answer', index: 1 }); // right (21 million)
    room.handle('A', { t: 'answer', index: 0 }); // second answer ignored
    assert.equal(room.currentPhase, 'question');
    room.handle('B', { t: 'answer', index: 0 }); // wrong; everyone answered → reveal
    assert.equal(room.currentPhase, 'reveal');
    const rev = b.last<QuizStateMessage>('state')!.reveal!;
    assert.equal(rev.correct, 1);
    assert.deepEqual(rev.counts, [1, 1, 0, 0]);
    assert.ok(rev.gains.A! > 900, 'fast answer scores near 1000');
    assert.equal(rev.gains.B, undefined);

    room.handle('B', { t: 'next' });
    assert.equal(room.currentPhase, 'reveal', 'only the host skips');
    room.handle('A', { t: 'next' });
    assert.equal(room.currentPhase, 'intro');

    // Let the rest time out.
    await wait(12 * (10 + 20 * 20 + 10) + 200);
    assert.equal(room.currentPhase, 'finished');
    assert.equal(results[0]!.userId, 'A');
    assert.ok(results[0]!.won);
    room.dispose();
  } finally {
    done();
  }
});

test('quiz: the author of a custom quiz plays for fun but does not score', async () => {
  const { store, done } = tempStore();
  let results: RoomResult[] = [];
  try {
    const repo = store.quizzes('g');
    const saved = repo.save('A', { title: 'Mine', questions: [{ q: 'Two plus two?', answers: ['4', '5'], correct: 0, seconds: 5 }] });
    assert.ok('id' in saved);
    const room = new QuizRoom(ctx((r) => (results = r)), repo, { introMs: 5, revealMs: 5, secondMs: 20 });
    for (const id of ['A', 'B', 'C']) room.join({ id, name: id }, client().conn);
    room.handle('A', { t: 'settings', settings: { quizId: saved.id, shuffle: false } });
    room.handle('A', { t: 'start' });
    await wait(15);
    room.handle('A', { t: 'answer', index: 0 });
    room.handle('B', { t: 'answer', index: 0 });
    room.handle('C', { t: 'answer', index: 1 });
    await wait(30);
    assert.equal(room.currentPhase, 'finished');
    assert.deepEqual(results.map((r) => r.userId).sort(), ['B', 'C']);
    assert.equal(results.find((r) => r.userId === 'B')?.won, true);
    room.dispose();
  } finally {
    done();
  }
});

// ── Odd One Out ────────────────────────────────────────────────────────────

test('odd one out: clues can’t give the word away', () => {
  assert.ok(revealsWord('coffees', 'coffee'));
  assert.ok(revealsWord('cofee', 'coffee'));
  assert.ok(revealsWord('ice-cream', 'ice cream'));
  assert.ok(!revealsWord('morning', 'coffee'));
});

function oddRoom(timing = { secondMs: 5, voteMs: 200, guessMs: 100, revealMs: 10 }) {
  let results: RoomResult[] = [];
  const room = new OddOneOutRoom(ctx((r) => (results = r)), timing);
  const cs = ['A', 'B', 'C', 'D'].map((id) => {
    const c = client();
    room.join({ id, name: id }, c.conn);
    return c;
  });
  room.handle('A', { t: 'settings', settings: { rounds: 3, clueRounds: 1, clueSeconds: 20, deck: 'general' } });
  return { room, cs, results: () => results };
}

test('odd one out: one player gets a different word, caught odd one can steal', () => {
  const { room, cs } = oddRoom();
  room.handle('A', { t: 'start' });
  assert.equal(room.currentPhase, 'clues');
  const odd = room.currentOdd!;
  const words = cs.map((c) => c.last<OddStateMessage>('state')!.word);
  const ids = ['A', 'B', 'C', 'D'];
  const oddWord = words[ids.indexOf(odd)];
  const majority = words.find((w, i) => ids[i] !== odd)!;
  assert.equal(words.filter((w) => w === majority).length, 3);
  assert.notEqual(oddWord, majority);

  // Everyone gives a clue in turn; out of turn is ignored.
  for (let i = 0; i < 4; i++) {
    const s = cs[0]!.last<OddStateMessage>('state')!;
    const other = ids.find((id) => id !== s.turnId)!;
    room.handle(other, { t: 'clue', text: 'nope' });
    const word = s.turnId === odd ? oddWord! : majority;
    room.handle(s.turnId!, { t: 'clue', text: word }); // rejected: gives it away
    assert.equal(cs[0]!.last<OddStateMessage>('state')!.turnId, s.turnId);
    room.handle(s.turnId!, { t: 'clue', text: `clue${i}` });
  }
  assert.equal(room.currentPhase, 'vote');
  assert.equal(cs[0]!.last<OddStateMessage>('state')!.clues.length, 4);

  for (const id of ids) room.handle(id, { t: 'vote', target: id === odd ? ids.find((x) => x !== odd)! : odd });
  assert.equal(room.currentPhase, 'guess');
  room.handle(ids.find((x) => x !== odd)!, { t: 'guess', text: majority });
  assert.equal(room.currentPhase, 'guess', 'only the odd one guesses');
  room.handle(odd, { t: 'guess', text: majority });
  assert.equal(room.currentPhase, 'reveal');
  const r = cs[0]!.last<OddStateMessage>('state')!.reveal!;
  assert.ok(r.caught && r.stole);
  assert.equal(r.gains[odd], 150);
  assert.equal(r.gains[ids.find((x) => x !== odd)!], 150, 'caught (+100) and voted right (+50)');
  room.dispose();
});

test('odd one out: a tied vote lets the odd one escape', async () => {
  const { room, cs } = oddRoom({ secondMs: 1, voteMs: 300, guessMs: 50, revealMs: 10 });
  room.handle('A', { t: 'start' });
  await wait(150); // every clue times out
  assert.equal(room.currentPhase, 'vote');
  const odd = room.currentOdd!;
  const others = ['A', 'B', 'C', 'D'].filter((x) => x !== odd);
  // 2 votes for the odd one, 2 for someone else.
  room.handle(others[0]!, { t: 'vote', target: odd });
  room.handle(others[1]!, { t: 'vote', target: odd });
  room.handle(others[2]!, { t: 'vote', target: others[0]! });
  room.handle(odd, { t: 'vote', target: others[0]! });
  assert.equal(room.currentPhase, 'reveal');
  const r = cs[0]!.last<OddStateMessage>('state')!.reveal!;
  assert.equal(r.caught, false);
  assert.equal(r.gains[odd], 300);
  room.dispose();
});

// ── Forbidden Words ────────────────────────────────────────────────────────

test('forbidden: banned word detection is whole-word and plural-aware', () => {
  const card = { word: 'coffee', banned: ['cup', 'morning', 'drink', 'beans', 'caffeine'] };
  assert.equal(usesForbidden('you drink it hot', card), 'drink');
  assert.equal(usesForbidden('Cups of it', card), 'cup');
  assert.equal(usesForbidden('COFFEE!', card), 'coffee');
  assert.equal(usesForbidden('a hot brown beverage', card), null);
  assert.equal(usesForbidden('cupboard', card), null);
  assert.equal(usesForbidden('first thing in the a.m.', { word: 'alarm clock', banned: ['wake'] }), null);
  assert.equal(usesForbidden('set the alarm clock', { word: 'alarm clock', banned: ['wake'] }), 'alarm clock');
});

test('forbidden: teams, card visibility and scoring', () => {
  const room = new ForbiddenRoom(ctx(), { secondMs: 50, readyMs: 1000, betweenMs: 1000 });
  const cs = new Map<string, ReturnType<typeof client>>();
  for (const id of ['A', 'B', 'C']) {
    const c = client();
    room.join({ id, name: id }, c.conn);
    cs.set(id, c);
  }
  room.handle('A', { t: 'start' });
  assert.equal(room.currentPhase, 'lobby', 'needs 2 per team');
  const d = client();
  room.join({ id: 'D', name: 'D' }, d.conn);
  cs.set('D', d);
  room.handle('A', { t: 'start' });
  assert.equal(room.currentPhase, 'ready');

  const s = cs.get('A')!.last<ForbiddenStateMessage>('state')!;
  const describer = s.describerId!;
  const teamOf = (id: string) => s.players.find((p) => p.id === id)!.team;
  const mate = s.players.find((p) => p.team === s.activeTeam && p.id !== describer)!.id;
  const opp = s.players.find((p) => p.team !== s.activeTeam)!.id;
  room.handle(opp, { t: 'go' });
  assert.equal(room.currentPhase, 'ready', 'only the describer starts');
  room.handle(describer, { t: 'go' });
  assert.equal(room.currentPhase, 'turn');

  assert.ok(cs.get(describer)!.last<ForbiddenStateMessage>('state')!.card);
  assert.ok(cs.get(opp)!.last<ForbiddenStateMessage>('state')!.card, 'other team polices the card');
  assert.equal(cs.get(mate)!.last<ForbiddenStateMessage>('state')!.card, null, 'guessers never see it');
  assert.notEqual(teamOf(opp), teamOf(mate));

  // Teammate guesses in chat.
  room.handle(mate, { t: 'chat', text: room.currentCard!.word });
  assert.deepEqual(room.scores[s.activeTeam], 1);
  // Describer types a banned word.
  room.handle(describer, { t: 'clue', text: `think ${room.currentCard!.banned[0]}` });
  assert.equal(room.scores[s.activeTeam], 0);
  // Opponent buzzes once per card.
  room.handle(opp, { t: 'buzz' });
  assert.equal(room.scores[s.activeTeam], -1);
  room.handle(describer, { t: 'got' });
  room.handle(describer, { t: 'skip' });
  room.handle(mate, { t: 'buzz' });
  assert.equal(room.scores[s.activeTeam], 0, 'own team cannot buzz');
  room.dispose();
});

// ── Perp Arena ─────────────────────────────────────────────────────────────

test('market: price paths are deterministic per seed and follow the scenario', () => {
  const run = (seed: number, scenario: 'bull' | 'crash') => {
    const rng = seeded(seed);
    const plan = makePlan(scenario, 600, rng);
    const m = new PriceModel(plan, 600, rng);
    const out: number[] = [];
    for (let i = 0; i < 600; i++) out.push(m.step().price);
    return out;
  };
  assert.deepEqual(run(7, 'bull'), run(7, 'bull'));
  assert.notDeepEqual(run(7, 'bull'), run(8, 'bull'));
  // Over many seeds, bull runs end higher than crashes on average.
  let bull = 0;
  let crash = 0;
  for (let s = 1; s <= 30; s++) {
    bull += run(s, 'bull').at(-1)!;
    crash += run(s, 'crash').at(-1)!;
  }
  assert.ok(bull / 30 > MARKET.startPrice * 1.1, `bull avg ${bull / 30}`);
  assert.ok(crash / 30 < MARKET.startPrice, `crash avg ${crash / 30}`);
});

test('market: leverage, liquidation, stops, funding and vaults', () => {
  const a = newAccount();
  assert.match(openPosition(a, 100, { side: 'long', size: 50, leverage: 50, stop: 0, take: 0 }, 25)!, /capped/);
  assert.equal(openPosition(a, 100, { side: 'long', size: 50, leverage: 10, stop: 0, take: 0 }, 25), null);
  const p = a.position!;
  assert.ok(Math.abs(p.margin * 10 - p.qty * 100) < 1e-6);
  assert.ok(p.liq > 90 && p.liq < 91, `10x long liq ≈ 90.5, got ${p.liq}`);
  assert.ok(Math.abs(equityOf(a, 100) - MARKET.startCash + p.qty * 100 * MARKET.takerFee) < 1e-6, 'only the fee is lost at entry');
  assert.match(openPosition(a, 100, { side: 'short', size: 10, leverage: 2, stop: 0, take: 0 }, 25)!, /Close/);

  // Positive funding: longs pay.
  const paid = settleFunding(a, 100, 0.001);
  assert.ok(paid > 0 && a.position!.funding === paid);
  assert.ok(a.position!.liq > p.liq - 1e-9, 'funding moves liquidation closer');

  assert.equal(checkTriggers(a, 95), null);
  const liq = checkTriggers(a, 85);
  assert.equal(liq?.kind, 'liquidated');
  assert.equal(a.position, null);
  assert.equal(a.stats.liquidations, 1);
  assert.ok(a.cash < MARKET.startCash / 2 + 1, 'lost the margin, nothing more');

  // Short with a stop-loss.
  const b = newAccount();
  openPosition(b, 100, { side: 'short', size: 100, leverage: 3, stop: 5, take: 0 }, 25);
  assert.ok(Math.abs(b.position!.stop! - 105) < 1e-9);
  assert.equal(checkTriggers(b, 104), null);
  assert.equal(checkTriggers(b, 106)?.kind, 'stop');
  assert.equal(b.stats.stopsHit, 1);
  assert.ok(b.cash < MARKET.startCash && b.cash > MARKET.startCash * 0.8);

  // Take profit closes in profit.
  const c = newAccount();
  openPosition(c, 100, { side: 'long', size: 100, leverage: 2, stop: 0, take: 10 }, 25);
  const tp = checkTriggers(c, 111);
  assert.equal(tp?.kind, 'take');
  assert.ok(tp!.kind === 'take' && tp.net > 0);
  assert.equal(c.stats.wins, 1);

  // Crowded longs push funding positive.
  const longs = [newAccount(), newAccount()];
  for (const acc of longs) openPosition(acc, 100, { side: 'long', size: 100, leverage: 5, stop: 0, take: 0 }, 25);
  assert.ok(fundingRate(longs, 100, 0) > 0);
  assert.ok(fundingRate(longs, 100, 0) <= MARKET.maxFundingRate);

  // Farm exploit.
  const f = newAccount();
  assert.equal(deposit(f, 'farm', 50, false), null);
  assert.equal(exploitFarm(f), MARKET.startCash * 0.5 * MARKET.exploitLoss);
  assert.match(deposit(f, 'farm', 25, true)!, /exploited/);
  closePosition(f, 100); // no-op without a position
});

test('market: a full fast game finishes, ranks by balance and reports results', async () => {
  let results: RoomResult[] = [];
  const room = new MarketRoom(ctx((r) => (results = r)), 1, seeded(42));
  const a = client();
  const b = client();
  room.join({ id: 'A', name: 'Alice' }, a.conn);
  room.join({ id: 'B', name: 'Bob' }, b.conn);
  room.handle('A', { t: 'settings', settings: { minutes: 3, scenario: 'chop', maxLeverage: 10 } });
  room.handle('A', { t: 'start' });
  assert.equal(room.currentPhase, 'running');
  assert.ok(a.last<Msg>('history'));
  room.handle('A', { t: 'open', side: 'long', size: 50, leverage: 50, stop: 0, take: 0 });
  assert.equal(room.accountOf('A')!.position, null, 'over the leverage cap');
  room.handle('A', { t: 'open', side: 'long', size: 50, leverage: 2, stop: 0, take: 0 });
  assert.ok(room.accountOf('A')!.position);
  room.handle('B', { t: 'deposit', vault: 'lend', size: 100 });
  assert.equal(room.accountOf('B')!.cash, 0);
  for (let i = 0; i < 400 && room.currentPhase === 'running'; i++) await wait(5);
  assert.equal(room.currentPhase, 'finished');
  const st = a.last<Msg>('state')!;
  assert.equal(st.results.length, 2);
  assert.ok(st.scenario, 'scenario revealed');
  assert.equal(room.accountOf('A')!.position, null, 'positions closed at the bell');
  assert.ok(room.accountOf('B')!.cash > MARKET.startCash, 'lending earned a little');
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.points >= 0));
  room.dispose();
});

test('hub: games always agree with the hub about who the host is', () => {
  const { store, done } = tempStore();
  try {
    const hub = new Hub('i', 'g', null, gameFactory({ store, onGameEnd: () => {} }));
    const conns = new Map<string, ReturnType<typeof client>>();
    const join = (id: string) => {
      const c = client();
      conns.set(id, c);
      hub.join({ id, name: id }, c.conn as never);
    };
    for (const id of ['A', 'B', 'C', 'D']) join(id);
    hub.handle('A', { t: 'choose', game: 'forbidden' });
    hub.handle('A', { t: 'g', m: { t: 'start' } });
    // Everyone drops mid-game (e.g. a reload) and comes back in a different order.
    for (const id of ['A', 'B', 'C', 'D']) hub.leave(id, conns.get(id)!.conn as never);
    for (const id of ['D', 'C', 'B', 'A']) join(id);
    const hubHost = conns.get('D')!.last<Extract<ServerMessage, { t: 'hub' }>>('hub')!.players.find((p) => p.host)!.id;
    const roomState = [...conns.get('D')!.inbox].reverse().find((m) => m.t === 'g' && m.m.t === 'state')!.m as ForbiddenStateMessage;
    assert.equal(roomState.players.find((p) => p.host)?.id, hubHost);
    // And that host can both end the game and go back to the menu.
    hub.handle(hubHost, { t: 'g', m: { t: 'end' } });
    hub.handle(hubHost, { t: 'menu' });
    assert.equal(hub.currentGame, null);
  } finally {
    done();
  }
});
