import { icon } from '../icons';
import { MAX_CHAT_LENGTH } from '../../../src/shared/protocol';
import { CUT_LABELS, MASS_OPTIONS, type MassPlayerView, type MassStateMessage, type TapStatus } from '../../../src/shared/massreaction';
import { chips, el, podium, renderPlayers, secondsLeft, setTimer, settingRow, shell, stageCard, startFooter, type Ctx, type Shell, type View } from '../core';

const STATUS_TEXT: Record<TapStatus, string> = { safe: 'Safe!', slow: 'Too slow', early: 'False start', missed: 'Missed it' };

export function createMassReaction(ctx: Ctx): View {
  let ui: Shell;
  let state: MassStateMessage | null = null;
  let ticker = 0;
  /** Round whose green arrived (the `go` message beats the next state). */
  let goRound = 0;
  let goAt = 0;
  let myTap: { ms: number | null; early: boolean } | null = null;
  let tapRound = 0;

  const pad = el('button', { type: 'button', className: 'mr-pad' });
  const padBig = el('div', { className: 'mr-big' });
  const padSub = el('div', { className: 'mr-sub' });
  pad.append(padBig, padSub);
  // pointerdown fires on touch-start, well before click.
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    tap();
  });
  const onKey = (e: KeyboardEvent) => {
    if ((e.code === 'Space' || e.code === 'Enter') && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      if (!e.repeat) tap();
    }
  };

  const meP = (): MassPlayerView | undefined => state?.players.find((p) => p.id === ctx.me());
  const phase = () => (state?.phase === 'wait' && goRound === state.round ? 'go' : state?.phase);

  function tap() {
    const s = state;
    if (!s || !meP()?.alive || myTap) return;
    const p = phase();
    if (p === 'wait') {
      myTap = { ms: null, early: true };
      ctx.send({ t: 'tap', early: true });
    } else if (p === 'go') {
      const ms = Math.round(performance.now() - goAt);
      myTap = { ms, early: false };
      ctx.send({ t: 'tap', ms });
    } else return;
    tapRound = s.round;
    drawPad();
  }

  // ── Lobby / results ──────────────────────────────────────────────────────

  function lobby(s: MassStateMessage) {
    const me = meP();
    const isHost = me?.host ?? false;
    const connected = s.players.filter((p) => p.connected).length;
    const played = s.players.filter((p) => p.alive || p.outRound !== null);
    const ranking = [...played].sort((a, b) => Number(b.alive) - Number(a.alive) || (b.outRound ?? 0) - (a.outRound ?? 0) || (a.best ?? Infinity) - (b.best ?? Infinity));
    const winner = ranking[0]?.alive ? ranking[0] : null;
    const head =
      s.phase === 'finished'
        ? [
            el('div', { className: 'eyebrow', textContent: `Game over · ${s.round} rounds` }),
            el('h1', { textContent: winner ? `${winner.name} wins!` : 'Game over' }),
            podium(ranking, ctx.me()),
          ]
        : [
            el('div', { className: 'logo' }, icon('target')),
            el('h1', { textContent: 'Mass Reaction' }),
            el(
              'ol',
              { className: 'howto' },
              el('li', { textContent: 'The pad turns red. Wait for it…' }),
              el('li', { textContent: 'The moment it turns green, tap it (or press Space).' }),
              el('li', { textContent: 'Tap too early, miss it, or be among the slowest, and you’re out. Last one left wins.' }),
            ),
          ];
    const settings = isHost
      ? el('div', { className: 'settings' }, el('div', { className: 'settings-title', textContent: 'Game settings' }), settingRow('Cut each round', chips(MASS_OPTIONS.cut, s.settings.cut as 20 | 30 | 50, (v) => CUT_LABELS[v]!, true, (cut) => ctx.send({ t: 'settings', settings: { cut } }))))
      : el('div', { className: 'settings summary' }, el('span', { className: 'label', textContent: 'Slowest cut' }), el('span', { textContent: CUT_LABELS[s.settings.cut] ?? `${s.settings.cut}%` }));
    stageCard(
      ui.stage,
      ...head,
      settings,
      startFooter({
        isHost,
        connected,
        min: 2,
        hostName: s.players.find((p) => p.host)?.name,
        label: s.phase === 'finished' ? 'Play again' : `Start · ${connected} players`,
        onStart: () => ctx.send({ t: 'start' }),
      }),
      ctx.menuButton(),
    );
  }

  // ── Live rounds ──────────────────────────────────────────────────────────

  function drawPad() {
    const s = state;
    if (!s) return;
    const p = phase();
    const alive = meP()?.alive ?? false;
    const left = s.players.filter((x) => x.alive).length;
    let cls = 'ready';
    let big = '';
    let sub = '';
    const mine = myTap && tapRound === s.round ? myTap : null;
    if (p === 'ready') {
      big = `Round ${s.round}`;
      sub = `${left} players left · get ready`;
    } else if (p === 'wait') {
      cls = mine?.early ? 'early' : 'red';
      big = mine?.early ? 'Too soon!' : 'Wait…';
      sub = mine?.early ? 'False start' : alive ? 'Tap when it turns green' : 'Watching';
    } else if (p === 'go') {
      cls = mine?.early ? 'early' : 'green';
      big = mine ? (mine.early ? 'Too soon!' : `${mine.ms} ms`) : alive ? 'TAP!' : 'GO!';
      sub = mine ? 'Waiting for the others…' : alive ? '' : 'Watching';
    } else if (p === 'result' && s.last) {
      const entry = s.last.entries.find((e) => e.id === ctx.me());
      if (s.last.replay) {
        cls = 'ready';
        big = 'Replay!';
        sub = 'Nobody made a clean tap';
      } else if (entry) {
        cls = entry.status === 'safe' ? 'safe' : 'out';
        big = STATUS_TEXT[entry.status];
        sub = entry.ms !== null ? `${entry.ms} ms${s.last.fastestId === ctx.me() ? ' · fastest this round!' : ''}` : entry.status === 'safe' ? '' : 'You’re out. Watch the rest!';
      } else {
        big = `Round ${s.round}`;
        sub = 'Watching';
      }
    }
    pad.className = `mr-pad ${cls}${alive ? '' : ' spectating'}`;
    padBig.textContent = big;
    padSub.textContent = sub;
  }

  function live(s: MassStateMessage) {
    const parts: Node[] = [pad];
    if (s.phase === 'result' && s.last) {
      const fast = s.last.entries.filter((e) => e.ms !== null).slice(0, 5);
      const out = s.last.entries.filter((e) => e.status !== 'safe').length;
      const name = (id: string) => s.players.find((p) => p.id === id)?.name ?? 'Someone';
      parts.push(
        el(
          'div',
          { className: 'mr-results' },
          el('div', { className: 'eyebrow', textContent: s.last.replay ? 'Replay' : `${out} out · ${s.last.entries.length - out} left` }),
          el(
            'ol',
            { className: 'mr-fast' },
            ...fast.map((e) => el('li', { className: `${e.status}${e.id === ctx.me() ? ' me' : ''}` }, el('span', { className: 'name', textContent: name(e.id) }), el('span', { className: 'ms', textContent: `${e.ms} ms` }))),
          ),
        ),
      );
    }
    ui.stage.replaceChildren(el('div', { className: 'mr-live' }, ...parts));
    drawPad();
  }

  // ── Wiring ───────────────────────────────────────────────────────────────

  function render() {
    const s = state;
    if (!s) return;
    const active = s.phase !== 'lobby' && s.phase !== 'finished';
    ctx.setPlaying(active);
    const left = s.players.filter((p) => p.alive).length;
    ui.status.textContent = active ? `Round ${s.round}` : s.phase === 'finished' ? 'Final' : 'Lobby';
    ui.center.textContent = active ? `${left} left` : '';
    ui.playersTitle.textContent = active ? `Players · ${left} left` : `Players · ${s.players.filter((p) => p.connected).length}`;
    renderPlayers(
      ui.players,
      [...s.players]
        .sort((a, b) => Number(b.alive) - Number(a.alive) || (b.outRound ?? 0) - (a.outRound ?? 0) || (a.best ?? Infinity) - (b.best ?? Infinity))
        .map((p) => ({
          ...p,
          score: p.best !== null ? `${p.best} ms` : '',
          cls: p.alive && active ? 'guessed' : '',
          status: p.alive ? (active ? 'in' : '') : p.outRound !== null ? `out in round ${p.outRound}` : active ? 'watching' : '',
        })),
      ctx.me(),
      false,
    );
    if (active) live(s);
    else lobby(s);
    tick();
  }

  function tick() {
    if (!state) return;
    const counting = state.phase === 'ready' || state.phase === 'result';
    setTimer(ui.timer, counting && state.endsAt ? secondsLeft(ctx, state.endsAt) : null, 0);
  }

  return {
    mount(root) {
      ui = shell(root, 'Chat', (text) => ctx.send({ t: 'chat', text: text.slice(0, MAX_CHAT_LENGTH) }), 'mass');
      stageCard(ui.stage, el('h1', { textContent: 'Joining…' }));
      ticker = window.setInterval(tick, 250);
      window.addEventListener('keydown', onKey);
    },
    unmount() {
      clearInterval(ticker);
      window.removeEventListener('keydown', onKey);
    },
    onMessage(m) {
      switch (m.t) {
        case 'state': {
          const next = m as MassStateMessage;
          if (!state || next.round !== state.round) {
            myTap = null;
            goRound = 0;
          }
          // After a reconnect, trust the server about this round.
          if (next.me.tapped && !myTap) {
            myTap = { ms: next.me.ms, early: next.me.early };
            tapRound = next.round;
          }
          if (next.phase === 'go' && goRound !== next.round) {
            goRound = next.round;
            goAt = performance.now();
          }
          state = next;
          ctx.setClock(state.now);
          render();
          break;
        }
        case 'go':
          if (state && m.round === state.round && goRound !== m.round) {
            goRound = m.round as number;
            goAt = performance.now();
            drawPad();
          }
          break;
        case 'chat':
          ui.chat.add(m.kind, m.text, m.name);
          break;
      }
    },
  };
}
