import { icon, rich } from '../icons';
import { MAX_CHAT_LENGTH } from '../../../src/shared/protocol';
import {
  DECK_LABELS,
  MAX_CLUE_LENGTH,
  ODD_OPTIONS,
  ODD_POINTS,
  type OddPlayerView,
  type OddSettings,
  type OddStateMessage,
} from '../../../src/shared/oddoneout';
import { avatar, button, chips, el, podium, renderPlayers, secondsLeft, setTimer, settingRow, shell, stageCard, startFooter, waiting, type Ctx, type Shell, type View } from '../core';

export function createOddOneOut(ctx: Ctx): View {
  let ui: Shell;
  let state: OddStateMessage | null = null;
  let ticker = 0;
  const clueInput = el('input', { className: 'field big', maxLength: MAX_CLUE_LENGTH, placeholder: 'One word or a short clue…', autocomplete: 'off' });
  const guessInput = el('input', { className: 'field big', maxLength: 40, placeholder: 'Their word was…', autocomplete: 'off' });

  const submitOn = (input: HTMLInputElement, t: 'clue' | 'guess') => {
    const form = el('form', { className: 'inline-form', autocomplete: 'off' }, input, el('button', { type: 'submit', className: 'go', textContent: t === 'clue' ? 'Give clue' : 'Guess' }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      ctx.send({ t, text });
      input.value = '';
    });
    return form;
  };
  const clueForm = submitOn(clueInput, 'clue');
  const guessForm = submitOn(guessInput, 'guess');

  const nameOf = (id: string | null) => state?.players.find((p) => p.id === id)?.name ?? 'Someone';

  function settingsPanel(s: OddSettings, isHost: boolean) {
    const summary = `${s.rounds} rounds · ${s.clueRounds} clue${s.clueRounds === 1 ? '' : 's'} each · ${s.clueSeconds}s per clue · ${DECK_LABELS[s.deck]}`;
    if (!isHost) return el('div', { className: 'settings summary' }, el('span', { className: 'label', textContent: 'Game' }), el('span', {}, ...rich(summary)));
    const update = (patch: Partial<OddSettings>) => ctx.send({ t: 'settings', settings: { ...s, ...patch } });
    return el(
      'div',
      { className: 'settings' },
      el('div', { className: 'settings-title', textContent: 'Game settings' }),
      settingRow('Words', chips(ODD_OPTIONS.deck, s.deck, (d) => DECK_LABELS[d], true, (deck) => update({ deck }))),
      settingRow('Rounds', chips(ODD_OPTIONS.rounds, s.rounds, String, true, (rounds) => update({ rounds }))),
      settingRow('Clues each', chips(ODD_OPTIONS.clueRounds, s.clueRounds, String, true, (clueRounds) => update({ clueRounds }))),
      settingRow('Clue time', chips(ODD_OPTIONS.clueSeconds, s.clueSeconds, (v) => `${v}s`, true, (clueSeconds) => update({ clueSeconds }))),
    );
  }

  function lobby(s: OddStateMessage) {
    const meP = s.players.find((p) => p.id === ctx.me());
    const isHost = meP?.host ?? false;
    const connected = s.players.filter((p) => p.connected).length;
    const ranking = [...s.players].sort((a, b) => b.score - a.score);
    const head =
      s.phase === 'finished'
        ? [el('div', { className: 'eyebrow', textContent: 'Game over' }), el('h1', { textContent: ranking[0] && ranking[0].score > 0 ? `${ranking[0].name} wins!` : 'Game over' }), podium(ranking, ctx.me())]
        : [
            el('div', { className: 'logo' }, icon('magnifier')),
            el('h1', { textContent: 'Odd One Out' }),
            el(
              'ol',
              { className: 'howto' },
              el('li', { textContent: 'Everyone gets the same secret word, except one player who gets a similar one. They don’t know they’re different.' }),
              el('li', { textContent: 'Take turns giving a short clue about your word. Too vague looks suspicious, too exact helps the odd one.' }),
              el('li', { textContent: `Vote out the odd one (+${ODD_POINTS.caught} each). If they slip away they score +${ODD_POINTS.escaped}. If they’re caught, they can still steal +${ODD_POINTS.stoleWord} by guessing your word.` }),
            ),
          ];
    stageCard(
      ui.stage,
      ...head,
      settingsPanel(s.settings, isHost),
      startFooter({
        isHost,
        connected,
        min: 3,
        hostName: s.players.find((p) => p.host)?.name,
        label: s.phase === 'finished' ? 'Play again' : `Start · ${connected} players`,
        onStart: () => ctx.send({ t: 'start' }),
      }),
      ctx.menuButton(),
    );
  }

  /** Each player's clues so far, in turn order. */
  function clueBoard(s: OddStateMessage, voting: boolean) {
    const round = s.players.filter((p) => p.inRound);
    const order = [...new Set([...s.clues.map((c) => c.id), ...(s.turnId ? [s.turnId] : []), ...round.map((p) => p.id)])];
    return el(
      'div',
      { className: 'clue-board' },
      ...order.map((id) => {
        const p = round.find((x) => x.id === id);
        if (!p) return null;
        const clues = s.clues.filter((c) => c.id === id);
        const turn = s.turnId === id;
        const row = el(
          'div',
          { className: `clue-row${turn ? ' turn' : ''}${s.myVote === id ? ' picked' : ''}${!p.connected ? ' offline' : ''}` },
          avatar(p.name),
          el('span', { className: 'clue-name', textContent: p.name + (p.id === ctx.me() ? ' (you)' : '') }),
          el(
            'span',
            { className: 'clue-words' },
            ...clues.map((c) => el('span', { className: `clue${c.text === '…' ? ' passed' : ''}`, textContent: c.text })),
            turn ? el('span', { className: 'clue typing', textContent: '…' }) : null,
          ),
        );
        if (voting && p.id !== ctx.me() && s.players.find((x) => x.id === ctx.me())?.inRound) {
          row.append(button(s.myVote === id ? '✓ Voted' : 'Vote', () => ctx.send({ t: 'vote', target: id }), `vote${s.myVote === id ? ' active' : ''}`));
        }
        return row;
      }),
    );
  }

  function wordBadge(s: OddStateMessage) {
    if (!s.word) return el('div', { className: 'word-badge out', textContent: 'You’re watching this round' });
    return el('div', { className: 'word-badge' }, el('span', { className: 'label', textContent: 'Your word' }), el('span', { className: 'word', textContent: s.word }));
  }

  function live(s: OddStateMessage) {
    const children: (Node | null)[] = [wordBadge(s)];
    if (s.phase === 'clues') {
      const mine = s.turnId === ctx.me();
      children.push(
        el('div', { className: 'phase-title', textContent: s.settings.clueRounds > 1 ? `Clues · pass ${s.pass} of ${s.settings.clueRounds}` : 'Clues' }),
        clueBoard(s, false),
        mine ? el('div', { className: 'your-turn' }, el('div', { className: 'eyebrow', textContent: 'Your turn' }), clueForm) : waiting(`${nameOf(s.turnId)} is thinking of a clue…`),
      );
    } else if (s.phase === 'vote') {
      const voters = s.players.filter((p) => p.inRound && p.connected);
      children.push(
        el('div', { className: 'phase-title' }, ...rich(`🗳️ Who has a different word? · ${voters.filter((p) => p.voted).length}/${voters.length} voted`)),
        clueBoard(s, true),
        el('p', { className: 'sub', textContent: 'Talk it over in voice or chat. You can change your vote until time runs out.' }),
      );
    } else if (s.phase === 'guess') {
      const mine = s.guesserId === ctx.me();
      children.push(
        el('div', { className: 'phase-title', textContent: mine ? 'You were caught!' : `${nameOf(s.guesserId)} was caught!` }),
        clueBoard(s, false),
        mine
          ? el('div', { className: 'your-turn' }, el('p', { className: 'sub', textContent: `Your word was the odd one. Guess everyone else’s word to steal ${ODD_POINTS.stoleWord} points.` }), guessForm)
          : waiting(`${nameOf(s.guesserId)} gets one guess at your word…`),
      );
    }
    const focused = document.activeElement;
    ui.stage.replaceChildren(el('div', { className: 'odd-live' }, ...children));
    if (focused === clueInput || focused === guessInput) (focused as HTMLInputElement).focus();
    else if (s.phase === 'clues' && s.turnId === ctx.me()) clueInput.focus();
    else if (s.phase === 'guess' && s.guesserId === ctx.me()) guessInput.focus();
  }

  function reveal(s: OddStateMessage) {
    const r = s.reveal!;
    const odd = s.players.find((p) => p.id === r.oddId);
    const votes = Object.entries(r.votes);
    const gains = Object.entries(r.gains).sort((a, b) => b[1] - a[1]);
    stageCard(
      ui.stage,
      el('div', { className: 'eyebrow', textContent: r.caught ? 'Caught!' : 'Got away!' }),
      odd ? avatar(odd.name, 'xl') : null,
      el('h1', { textContent: `${odd?.name ?? 'Someone'} ${r.caught ? 'was the odd one out' : 'was the odd one, and nobody caught them'}` }),
      el(
        'div',
        { className: 'word-pair' },
        el('div', {}, el('span', { className: 'label', textContent: 'Everyone' }), el('span', { className: 'word', textContent: r.majorityWord })),
        el('div', { className: 'odd' }, el('span', { className: 'label', textContent: odd?.name ?? 'Odd one' }), el('span', { className: 'word', textContent: r.oddWord })),
      ),
      r.guess ? el('p', { className: 'sub', textContent: r.stole ? `They guessed "${r.guess}" and stole the points!` : `They guessed "${r.guess}". Nope!` }) : null,
      votes.length
        ? el('div', { className: 'votes' }, ...votes.map(([voter, target]) => el('span', { className: `vote-chip${target === r.oddId ? ' right' : ''}`, textContent: `${nameOf(voter)} → ${nameOf(target)}` })))
        : el('p', { className: 'sub', textContent: 'Nobody voted.' }),
      gains.length ? el('ul', { className: 'gains' }, ...gains.map(([id, n]) => el('li', { className: id === ctx.me() ? 'me' : '' }, avatar(nameOf(id)), el('span', { className: 'name', textContent: nameOf(id) }), el('span', { className: 'plus', textContent: `+${n}` })))) : null,
    );
  }

  function render() {
    const s = state;
    if (!s) return;
    const active = s.phase !== 'lobby' && s.phase !== 'finished';
    ctx.setPlaying(active);
    ui.status.textContent = s.phase === 'lobby' ? 'Lobby' : s.phase === 'finished' ? 'Game over' : `Round ${s.round}/${s.settings.rounds}`;
    ui.center.textContent = '';
    renderPlayers(
      ui.players,
      [...s.players]
        .sort((a, b) => b.score - a.score)
        .map((p: OddPlayerView) => ({
          ...p,
          score: String(p.score),
          cls: active && p.id === s.turnId ? 'drawing' : s.phase === 'vote' && p.voted ? 'guessed' : '',
          status: active && !p.inRound ? 'watching' : p.id === s.turnId ? '💬 giving a clue' : s.phase === 'vote' && p.voted ? '✓ voted' : '',
        })),
      ctx.me(),
      s.phase !== 'lobby',
    );
    if (!active) lobby(s);
    else if (s.phase === 'reveal') reveal(s);
    else live(s);
    tick();
  }

  function tick() {
    if (!state) return;
    setTimer(ui.timer, state.endsAt ? secondsLeft(ctx, state.endsAt) : null, 5);
  }

  return {
    mount(root) {
      ui = shell(root, 'Discussion', (text) => ctx.send({ t: 'chat', text: text.slice(0, MAX_CHAT_LENGTH) }), 'odd');
      stageCard(ui.stage, el('h1', { textContent: 'Joining…' }));
      ticker = window.setInterval(tick, 250);
    },
    unmount() {
      clearInterval(ticker);
    },
    onMessage(m) {
      if (m.t === 'state') {
        state = m as OddStateMessage;
        ctx.setClock(state.now);
        render();
      } else if (m.t === 'chat') ui.chat.add(m.kind, m.text, m.name);
    },
  };
}
