import { icon } from '../icons';
import { MAX_CHAT_LENGTH } from '../../../src/shared/protocol';
import {
  DEFAULT_TC,
  REASON_TEXT,
  TIME_CONTROLS,
  tcName,
  TOURNEY_LIMITS,
  type BoardSummary,
  type BoardView,
  type ChessLobby,
  type Color,
  type ModVerdict,
  type MyBoardView,
  type TimeControl,
  type TourneySettings,
  type TourneyView,
} from '../../../src/shared/chess';
import { button, chips, el, renderPlayers, settingRow, shell, type Ctx, type Shell, type View } from '../core';

// Solid glyphs for both colours (styled white or black); U+FE0E keeps them from turning into emoji.
const GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const PIECE_NAME: Record<string, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const FILES = 'abcdefgh';

type Piece = { type: string; color: Color };

/** Piece placement from the first field of a FEN. */
function parseFen(fen: string): Map<string, Piece> {
  const out = new Map<string, Piece>();
  const rows = fen.split(' ')[0]!.split('/');
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else {
        out.set(`${FILES[f]}${8 - r}`, { type: ch.toLowerCase(), color: ch === ch.toUpperCase() ? 'w' : 'b' });
        f++;
      }
    }
  });
  return out;
}

function fmtClock(ms: number): string {
  const t = Math.max(0, ms);
  if (t < 10_000) return `${Math.floor(t / 1000)}.${Math.floor((t % 1000) / 100)}`;
  const s = Math.ceil(t / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function fmtIn(ms: number): string {
  if (ms <= 0) return 'now';
  const m = Math.ceil(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
  return `${Math.round(h / 24)} days`;
}

const localTime = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** "YYYY-MM-DDTHH:MM" in local time, for <input type=datetime-local>. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const isMine = (b: BoardView | MyBoardView | null): b is MyBoardView => Boolean(b && 'color' in b);

/** Tap twice within 3 s to confirm. */
function confirmButton(label: string, armedLabel: string, onConfirm: () => void, className = ''): HTMLButtonElement {
  const b = button(label, () => {
    if (b.dataset.armed) return onConfirm();
    b.dataset.armed = '1';
    b.textContent = armedLabel;
    setTimeout(() => {
      delete b.dataset.armed;
      b.textContent = label;
    }, 3000);
  }, className);
  return b;
}

export function createChess(ctx: Ctx): View {
  let ui: Shell;
  let lobby: ChessLobby | null = null;
  let board: BoardView | MyBoardView | null = null;
  /** Server time when the current board arrived, mapped to our clock. */
  let boardAt = 0;
  let ticker = 0;
  let selected: string | null = null;
  let promo: { from: string; to: string } | null = null;
  let flipped = false;
  // Lobby choices, kept across re-renders.
  let tc: TimeControl = DEFAULT_TC;
  let color: 'random' | Color = 'random';
  let form: HTMLElement | null = null;
  let expanded = new Set<string>();
  const clockEls: { el: HTMLElement; side: Color }[] = [];

  const send = (m: { t: string } & Record<string, unknown>) => ctx.send(m);

  // ── Lobby ────────────────────────────────────────────────────────────────

  function renderLobby() {
    const l = lobby;
    if (!l) return;
    const prevScroll = ui.stage.querySelector('.chess-lobby')?.scrollTop ?? 0;
    const me = ctx.me();
    const myChallenge = l.challenges.find((c) => c.byId === me);

    const sections: Node[] = [];

    // Tournaments
    const tHead = el('div', { className: 'cl-head' }, el('h2', {}, icon('trophy', 'inline'), ' Tournaments'));
    if (l.mod && !form) tHead.append(button('+ New tournament', () => openForm(null), 'small'));
    sections.push(tHead);
    if (form) sections.push(form);
    if (l.tourneys.length === 0 && !form) {
      sections.push(el('p', { className: 'cl-empty', textContent: l.mod ? 'No tournaments yet. Create one, and players can sign up ahead of time.' : 'No tournaments scheduled. A moderator can create one.' }));
    }
    for (const t of l.tourneys) sections.push(tourneyCard(t, l));

    // Casual
    sections.push(el('div', { className: 'cl-head' }, el('h2', {}, icon('pawn', 'inline'), ' Play someone here')));
    const create = el(
      'div',
      { className: 'cl-box' },
      settingRow('Clock', chips(TIME_CONTROLS, tc, (v) => v, !myChallenge, (v) => ((tc = v), renderLobby()))),
      settingRow('You play', chips(['random', 'w', 'b'] as const, color, (v) => (v === 'random' ? 'Random' : v === 'w' ? 'White' : 'Black'), !myChallenge, (v) => ((color = v), renderLobby()))),
      myChallenge
        ? el('div', { className: 'cl-row' }, el('span', { className: 'waiting', textContent: `Waiting for someone to accept your ${myChallenge.tc} game…` }), button('Cancel', () => send({ t: 'cancelChallenge' }), 'small'))
        : button(`Create a ${tcName(tc)} challenge`, () => send({ t: 'challenge', tc, color }), 'primary'),
    );
    sections.push(create);
    const others = l.challenges.filter((c) => c.byId !== me);
    if (others.length) {
      sections.push(
        el(
          'ul',
          { className: 'cl-list' },
          ...others.map((c) =>
            el(
              'li',
              {},
              el('span', { className: 'cl-name', textContent: c.byName }),
              el('span', { className: 'cl-meta', textContent: `${tcName(c.tc)}${c.color === 'random' ? '' : ` · they play ${c.color === 'w' ? 'white' : 'black'}`}` }),
              button('Accept', () => send({ t: 'accept', id: c.id }), 'small accent'),
            ),
          ),
        ),
      );
    }
    if (l.boards.length) {
      sections.push(el('h3', { className: 'cl-sub', textContent: 'Games in this call' }), boardList(l.boards, l.mod));
    }
    sections.push(el('p', { className: 'cl-note', textContent: 'Casual wins count for the chess leaderboard (up to 5 games per pair per day). All games and leaderboards are just for fun.' }));
    const menu = ctx.menuButton();
    if (menu) sections.push(menu);

    const wrap = el('div', { className: 'chess-lobby' }, ...sections);
    ui.stage.replaceChildren(wrap);
    wrap.scrollTop = prevScroll;
    tick();
  }

  function boardList(boards: BoardSummary[], mod: boolean) {
    return el(
      'ul',
      { className: 'cl-list' },
      ...boards.map((b) =>
        el(
          'li',
          {},
          el('span', { className: 'cl-name', textContent: `${b.white} – ${b.black}` }),
          el('span', { className: 'cl-meta', textContent: `${b.tc} · move ${Math.max(1, b.moves)}` }),
          button(mod ? 'Watch / moderate' : 'Watch', () => send({ t: 'watch', id: b.id }), 'small'),
        ),
      ),
    );
  }

  function tourneyCard(t: TourneyView, l: ChessLobby) {
    const me = ctx.me();
    const now = ctx.now();
    const status = el('span', { className: `t-status ${t.status}` });
    const when = el('span', { className: 't-when' });
    if (t.status === 'scheduled') {
      status.textContent = 'Upcoming';
      when.append(`${localTime(t.startsAt)} · starts in `, countdown(t.startsAt, 'in'));
    } else if (t.status === 'running') {
      status.textContent = now >= t.endsAt ? 'Last games' : 'Live';
      when.append(now >= t.endsAt ? 'Finishing the last games…' : 'Ends in ', now >= t.endsAt ? '' : countdown(t.endsAt, 'clock'));
    } else {
      status.textContent = 'Finished';
      when.textContent = localTime(t.endsAt);
    }
    const playing = t.standings.find((s) => s.id === me)?.playing ?? false;
    const actions = el('div', { className: 't-actions' });
    if (t.status !== 'finished') {
      if (!t.joined) {
        const full = t.standings.length >= t.maxPlayers;
        const b = button(full ? 'Full' : t.status === 'running' ? 'Join now' : 'Join', () => send({ t: 'tjoin', id: t.id }), 'small accent');
        b.disabled = full;
        actions.append(b);
      } else if (t.status === 'scheduled') {
        actions.append(el('span', { className: 't-joined' }, icon('check', 'inline'), " You're in"), button('Leave', () => send({ t: 'tleave', id: t.id }), 'small'));
      } else if (t.paused) {
        actions.append(el('span', { className: 't-joined', textContent: 'Paused' }), button('Resume', () => send({ t: 'tpause', id: t.id, paused: false }), 'small accent'));
      } else {
        actions.append(
          playing ? el('span', { className: 't-joined', textContent: 'Playing' }) : el('span', { className: 'waiting t-waiting' }, el('span', { className: 'dots' }, el('i'), el('i'), el('i')), 'Finding an opponent…'),
          button('Pause', () => send({ t: 'tpause', id: t.id, paused: true }), 'small'),
        );
      }
    }
    if (l.mod) {
      const mod = el('div', { className: 't-mod' });
      if (t.status !== 'finished') mod.append(button('Edit', () => openForm(t), 'small'));
      if (t.status === 'scheduled') mod.append(confirmButton('Start now', 'Tap to start', () => send({ t: 'tstart', id: t.id }), 'small'));
      mod.append(confirmButton('Remove', 'Tap to remove', () => send({ t: 'tdelete', id: t.id }), 'small danger'));
      actions.append(mod);
    }

    const all = expanded.has(t.id);
    const rows = all ? t.standings : t.standings.slice(0, 10);
    const table = rows.length
      ? el(
          'ol',
          { className: 't-standings' },
          ...rows.map((s, i) =>
            el(
              'li',
              { className: [s.id === me && 'me', !s.online && t.status === 'running' && 'away', s.paused && 'paused'].filter(Boolean).join(' ') },
              el('span', { className: 'rank', textContent: String(i + 1) }),
              el('span', { className: 'name', textContent: s.name, title: s.name }, s.fire ? icon('flame', 'inline') : '', s.playing ? el('span', { className: 'tag', textContent: 'playing' }) : ''),
              el('span', { className: 'sheet', textContent: s.sheet.join('') }),
              el('span', { className: 'score', textContent: String(s.score) }),
              l.mod && t.status !== 'finished' ? confirmButton('✕', 'Kick?', () => send({ t: 'tkick', id: t.id, user: s.id }), 'tiny') : '',
            ),
          ),
        )
      : el('p', { className: 'cl-empty', textContent: t.status === 'scheduled' ? 'Nobody has signed up yet.' : 'Nobody played.' });
    const more =
      t.standings.length > 10
        ? button(all ? 'Show top 10' : `Show all ${t.standings.length}`, () => {
            if (all) expanded.delete(t.id);
            else expanded.add(t.id);
            renderLobby();
          }, 'link')
        : null;

    return el(
      'div',
      { className: `t-card ${t.status}` },
      el('div', { className: 't-top' }, el('div', { className: 't-name', textContent: t.name }), status),
      el('div', { className: 't-info', textContent: `${tcName(t.tc)} arena · ${t.durationMin} min · ${t.standings.length}/${t.maxPlayers} players` }),
      el('div', { className: 't-info' }, when),
      actions,
      table,
      more,
      t.boards.length ? el('h3', { className: 'cl-sub', textContent: 'Top boards' }) : null,
      t.boards.length ? boardList(t.boards, l.mod) : null,
      t.status !== 'finished' ? el('p', { className: 'cl-note', textContent: 'Win 2, draw 1. Two wins in a row and you’re on fire: points double. Berserk halves your clock for +1 on a win. Stay on this screen to get paired.' }) : null,
    );
  }

  function countdown(at: number, style: 'in' | 'clock') {
    const s = el('span', { className: 'countdown' });
    s.dataset.at = String(at);
    s.dataset.style = style;
    return s;
  }

  /** Create or edit a tournament (moderators). */
  function openForm(t: TourneyView | null) {
    const running = t?.status === 'running';
    const nextQuarter = Math.ceil((Date.now() + 3_600_000) / 900_000) * 900_000;
    const state: TourneySettings = {
      name: t?.name ?? '',
      startsAt: t?.startsAt ?? nextQuarter,
      durationMin: t?.durationMin ?? 60,
      tc: t?.tc ?? DEFAULT_TC,
      maxPlayers: t?.maxPlayers ?? TOURNEY_LIMITS.maxPlayers,
    };
    const name = el('input', { className: 'field', maxLength: TOURNEY_LIMITS.nameLength, placeholder: 'Friday Night Blitz', value: state.name });
    const start = el('input', { className: 'field', type: 'datetime-local', value: toLocalInput(state.startsAt) });
    start.disabled = running;
    const max = el('input', { className: 'field', type: 'number', min: String(TOURNEY_LIMITS.minPlayers), max: String(TOURNEY_LIMITS.maxPlayers), value: String(state.maxPlayers) });
    const tcSlot = el('div');
    const durSlot = el('div');
    const drawChips = () => {
      tcSlot.replaceChildren(chips(TIME_CONTROLS, state.tc, (v) => v, !running, (v) => ((state.tc = v), drawChips())));
      durSlot.replaceChildren(chips(TOURNEY_LIMITS.durations, state.durationMin, (v) => (v < 60 ? `${v}m` : `${v / 60}h`), true, (v) => ((state.durationMin = v), drawChips())));
    };
    drawChips();
    const save = button(t ? 'Save changes' : 'Create tournament', () => {
      const startsAt = new Date(start.value).getTime();
      const settings: Partial<TourneySettings> = { name: name.value, durationMin: state.durationMin, maxPlayers: Number(max.value) };
      if (!running) {
        settings.tc = state.tc;
        settings.startsAt = startsAt;
      }
      if (t) send({ t: 'tedit', id: t.id, settings });
      else send({ t: 'tcreate', settings: settings as TourneySettings });
      closeForm();
    }, 'primary');
    form = el(
      'div',
      { className: 'cl-box t-form' },
      el('div', { className: 'settings-title', textContent: t ? `Edit “${t.name}”` : 'New arena tournament' }),
      settingRow('Name', name),
      settingRow('Starts', start),
      el('div', { className: 't-hint', textContent: `In your local time (${Intl.DateTimeFormat().resolvedOptions().timeZone}). Players see it in theirs.` }),
      settingRow('Clock', tcSlot),
      settingRow('Length', durSlot),
      settingRow('Max players', max),
      el('div', { className: 'cl-row' }, save, button('Cancel', closeForm, 'small')),
    );
    renderLobby();
    name.focus();
  }

  function closeForm() {
    form = null;
    renderLobby();
  }

  // ── Board ────────────────────────────────────────────────────────────────

  function myColor(): Color | null {
    return isMine(board) ? board.color : null;
  }

  function bottomColor(): Color {
    const c = myColor() ?? 'w';
    return flipped ? (c === 'w' ? 'b' : 'w') : c;
  }

  function legalFrom(sq: string): string[] {
    return isMine(board) ? board.legal.filter((m) => m.startsWith(sq)) : [];
  }

  function tryMove(from: string, to: string) {
    const moves = legalFrom(from).filter((m) => m.slice(2, 4) === to);
    if (!moves.length) return false;
    if (moves.length > 1 || moves[0]!.length === 5) {
      promo = { from, to };
      selected = null;
      renderBoard();
      return true;
    }
    send({ t: 'move', uci: moves[0]! });
    selected = null;
    return true;
  }

  function onSquare(sq: string) {
    const b = board;
    if (!b || !isMine(b) || b.result !== '*' || b.reason) return;
    if (selected && selected !== sq && tryMove(selected, sq)) return;
    selected = selected === sq || legalFrom(sq).length === 0 ? null : sq;
    renderBoard();
  }

  function sideBar(c: Color) {
    const b = board!;
    const s = c === 'w' ? b.white : b.black;
    const clock = el('div', { className: 'cp-clock' });
    clockEls.push({ el: clock, side: c });
    const active = b.result === '*' && !b.reason && b.turn === c;
    return el(
      'div',
      { className: `cp-bar${active ? ' active' : ''}` },
      el('span', { className: `cp-dot ${c}` }),
      el('span', { className: 'cp-name', textContent: s.name, title: s.name }),
      s.berserk ? el('span', { className: 'cp-tag', title: 'Berserk' }, icon('bolt', 'inline')) : '',
      !s.online && b.result === '*' ? el('span', { className: 'cp-tag away', textContent: 'left' }) : '',
      b.points ? el('span', { className: 'cp-tag pts', textContent: `+${b.points[c]}` }) : '',
      clock,
    );
  }

  function renderBoard() {
    const b = board;
    if (!b) return renderLobby();
    clockEls.length = 0;
    const pieces = parseFen(b.fen);
    const bottom = bottomColor();
    const top: Color = bottom === 'w' ? 'b' : 'w';
    const mine = isMine(b) ? b : null;
    const targets = new Set(selected ? legalFrom(selected).map((m) => m.slice(2, 4)) : []);
    const kingInCheck = b.check ? [...pieces].find(([, p]) => p.type === 'k' && p.color === b.turn)?.[0] : undefined;

    const grid = el('div', { className: 'cb', role: 'grid' });
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const file = bottom === 'w' ? f : 7 - f;
        const rank = bottom === 'w' ? 8 - r : r + 1;
        const sq = `${FILES[file]}${rank}`;
        const p = pieces.get(sq);
        const cls = ['sq', (file + rank) % 2 === 1 ? 'dark' : 'light'];
        if (b.last && (b.last[0] === sq || b.last[1] === sq)) cls.push('last');
        if (selected === sq) cls.push('sel');
        if (targets.has(sq)) cls.push(p ? 'cap' : 'dot');
        if (kingInCheck === sq) cls.push('check');
        if (mine && p?.color === mine.color && mine.legal.some((m) => m.startsWith(sq))) cls.push('movable');
        const cell = el('div', { className: cls.join(' ') });
        cell.dataset.sq = sq;
        if (p) cell.append(el('span', { className: `pc ${p.color}`, textContent: GLYPH[p.type]! + '︎', title: `${p.color === 'w' ? 'White' : 'Black'} ${PIECE_NAME[p.type]}` }));
        if (f === 0) cell.append(el('span', { className: 'coord rank', textContent: String(rank) }));
        if (r === 7) cell.append(el('span', { className: 'coord file', textContent: FILES[file]! }));
        grid.append(cell);
      }
    }
    // Tap to select then tap a target, or press on a piece and release on the target.
    let downSq: string | null = null;
    grid.addEventListener('pointerdown', (e) => {
      const sq = (e.target as HTMLElement).closest<HTMLElement>('.sq')?.dataset.sq;
      if (!sq) return;
      downSq = sq;
      onSquare(sq);
    });
    grid.addEventListener('pointerup', (e) => {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.sq')?.dataset.sq;
      if (downSq && target && target !== downSq && selected === downSq) tryMove(downSq, target);
      downSq = null;
    });

    const boardWrap = el('div', { className: 'cb-wrap' }, grid);
    if (promo) {
      const p = promo;
      boardWrap.append(
        el(
          'div',
          { className: 'cb-promo' },
          el('div', { className: 'cb-promo-box' }, el('span', { textContent: 'Promote to' }),
            ...(['q', 'r', 'b', 'n'] as const).map((t) =>
              button(GLYPH[t]! + '︎', () => {
                send({ t: 'move', uci: p.from + p.to + t });
                promo = null;
                renderBoard();
              }, `promo-pick ${mine?.color ?? 'w'}`),
            ),
            button('Cancel', () => ((promo = null), renderBoard()), 'small'),
          ),
        ),
      );
    }

    // Side panel: result, moves, actions.
    const over = b.result !== '*' || Boolean(b.reason);
    const side: Node[] = [];
    if (over) {
      const res = b.result === '*' ? 'Aborted' : b.result === '1/2-1/2' ? '½–½' : b.result.replace('-', '–');
      let line = b.reason ? REASON_TEXT[b.reason] : '';
      if (mine && b.result !== '*') {
        const won = (b.result === '1-0') === (mine.color === 'w');
        line = `${b.result === '1/2-1/2' ? 'Draw' : won ? 'You won!' : 'You lost'} · ${line}`;
      }
      side.push(el('div', { className: 'cp-result' }, el('div', { className: 'big', textContent: res }), el('div', { textContent: line })));
      if (b.tourneyId && mine) side.push(el('p', { className: 'cl-note', textContent: 'Your next tournament game starts by itself in a few seconds, unless you pause.' }));
    } else if (b.firstMoveBy) {
      const c = el('span', { className: 'countdown' });
      c.dataset.at = String(b.firstMoveBy);
      c.dataset.style = 'secs';
      side.push(el('div', { className: 'cp-first' }, `${b.turn === 'w' ? 'White' : 'Black'} to make a first move: `, c));
    }
    if (b.drawOffer && !over) {
      if (mine && b.drawOffer !== mine.color) {
        side.push(
          el('div', { className: 'cp-offer' }, el('span', { textContent: 'Your opponent offers a draw.' }),
            button('Accept', () => send({ t: 'draw', accept: true }), 'small accent'),
            button('Decline', () => send({ t: 'draw', accept: false }), 'small')),
        );
      } else side.push(el('div', { className: 'cp-offer', textContent: `${b.drawOffer === 'w' ? 'White' : 'Black'} offered a draw.` }));
    }
    const moves = el('ol', { className: 'cp-moves' });
    for (let i = 0; i < b.moves.length; i += 2) {
      moves.append(el('li', {}, el('span', { className: 'mw', textContent: b.moves[i]! }), el('span', { className: 'mb', textContent: b.moves[i + 1] ?? '' })));
    }
    side.push(moves);
    const actions = el('div', { className: 'cp-actions' });
    if (mine && !over) {
      if (mine.canBerserk) actions.append(button('⚡ Berserk', () => send({ t: 'berserk' }), 'small'));
      if (!b.drawOffer) actions.append(button('Offer draw', () => send({ t: 'draw' }), 'small'));
      actions.append(confirmButton(b.moves.length < 2 && !b.tourneyId ? 'Abort' : 'Resign', 'Tap to confirm', () => send({ t: 'resign' }), 'small danger'));
    }
    actions.append(button('Flip', () => ((flipped = !flipped), renderBoard()), 'small'));
    if (!mine || over) actions.append(button(over && mine ? '← Lobby' : '← Back', () => send({ t: 'watch', id: null }), 'small'));
    side.push(actions);
    if (lobby?.mod && !over) {
      const verdict = (v: ModVerdict, label: string) => confirmButton(label, 'Confirm?', () => send({ t: 'decide', game: b.id, verdict: v }), 'small');
      side.push(el('div', { className: 'cp-mod' }, el('div', { className: 'settings-title', textContent: 'Moderator' }), el('div', { className: 'cp-actions' }, verdict('abort', 'Abort'), verdict('1-0', 'White wins'), verdict('0-1', 'Black wins'), verdict('draw', 'Draw'))));
    }

    ui.stage.replaceChildren(
      el(
        'div',
        { className: 'chess-play' },
        el('div', { className: 'cp-board-area' }, el('div', { className: 'cp-col' }, sideBar(top), boardWrap, sideBar(bottom))),
        el('div', { className: 'cp-side' }, ...side),
      ),
    );
    moves.scrollTop = moves.scrollHeight;
    tick();
  }

  // ── Wiring ───────────────────────────────────────────────────────────────

  function render() {
    renderTop();
    if (board) renderBoard();
    else renderLobby();
  }

  function renderTop() {
    const b = board;
    if (b) {
      const mine = isMine(b);
      const over = b.result !== '*' || Boolean(b.reason);
      ui.status.textContent = over ? 'Game over' : mine ? (b.turn === myColor() ? 'Your move' : 'Their move') : 'Watching';
      ui.center.textContent = `${b.white.name} vs ${b.black.name}`;
    } else {
      ui.status.textContent = 'Chess';
      const live = lobby?.tourneys.find((t) => t.status === 'running');
      ui.center.textContent = live ? live.name : 'Lobby';
    }
    if (lobby) {
      const here = lobby.players.filter((p) => p.connected).length;
      ui.playersTitle.textContent = `Here · ${here}`;
      renderPlayers(
        ui.players,
        lobby.players.map((p) => ({ ...p, status: p.playing ? 'playing' : '' })),
        ctx.me(),
        false,
      );
    }
  }

  function tick() {
    const now = ctx.now();
    const b = board;
    if (b) {
      const over = b.result !== '*' || Boolean(b.reason);
      for (const { el: c, side } of clockEls) {
        const s = side === 'w' ? b.white : b.black;
        const live = b.running && !over && b.turn === side;
        const ms = live ? s.clock - (now - boardAt) : s.clock;
        c.textContent = fmtClock(ms);
        c.classList.toggle('low', ms < 20_000 && b.running);
      }
    }
    for (const c of ui.stage.querySelectorAll<HTMLElement>('.countdown')) {
      const left = Number(c.dataset.at) - now;
      c.textContent = c.dataset.style === 'secs' ? `${Math.max(0, Math.ceil(left / 1000))}s` : c.dataset.style === 'clock' ? fmtClock(left) : fmtIn(left);
    }
    // The tournament clock in the top bar.
    const live = lobby?.tourneys.find((t) => t.status === 'running' && t.joined);
    ui.timer.replaceChildren();
    if (live && live.endsAt > now) ui.timer.append(icon('trophy', 'inline'), ` ${fmtClock(live.endsAt - now)}`);
  }

  return {
    mount(root) {
      ui = shell(root, 'Chat', (text) => ctx.send({ t: 'chat', text: text.slice(0, MAX_CHAT_LENGTH) }), 'chess');
      ui.stage.replaceChildren(el('div', { className: 'chess-lobby' }, el('h1', { textContent: 'Joining…' })));
      ctx.setPlaying(false);
      ticker = window.setInterval(tick, 100);
    },
    unmount() {
      clearInterval(ticker);
    },
    onMessage(m) {
      switch (m.t) {
        case 'lobby': {
          lobby = m as ChessLobby;
          ctx.setClock(lobby.now);
          renderTop();
          // Don't redraw the board for lobby news; it would drop a half-made move.
          if (!board) renderLobby();
          break;
        }
        case 'board': {
          const next = m.board as BoardView | MyBoardView | null;
          if (!next || next.id !== board?.id) {
            selected = null;
            promo = null;
            flipped = false;
          } else if (selected && !(isMine(next) && next.legal.some((x) => x.startsWith(selected!)))) selected = null;
          board = next;
          if (board) {
            ctx.setClock(board.now);
            boardAt = ctx.now();
          }
          render();
          break;
        }
        case 'chat':
          ui.chat.add(m.kind, m.text, m.name);
          break;
      }
    },
  };
}
