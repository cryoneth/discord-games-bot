import {
  DECK_LABELS,
  FORBIDDEN_OPTIONS,
  MAX_FORBIDDEN_CLUE,
  TEAM_EMOJI,
  TEAM_NAMES,
  type ForbiddenPlayerView,
  type ForbiddenSettings,
  type ForbiddenStateMessage,
  type Team,
} from '../../../src/shared/forbidden';
import { MAX_CHAT_LENGTH } from '../../../src/shared/protocol';
import { avatar, button, chips, el, renderPlayers, secondsLeft, setTimer, settingRow, shell, stageCard, startFooter, waiting, type Ctx, type Shell, type View } from '../core';

const RESULT_LABEL = { got: '✓', guessed: '✓', skip: '⏭', buzz: '🚨', said: '🚨' } as const;

export function createForbidden(ctx: Ctx): View {
  let ui: Shell;
  let state: ForbiddenStateMessage | null = null;
  let ticker = 0;
  let clues: string[] = [];

  const clueInput = el('input', { className: 'field', maxLength: MAX_FORBIDDEN_CLUE, placeholder: 'Type a clue (optional in voice)…', autocomplete: 'off' });
  const clueForm = el('form', { className: 'inline-form', autocomplete: 'off' }, clueInput, el('button', { type: 'submit', className: 'go', textContent: 'Send' }));
  clueForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = clueInput.value.trim();
    if (!text) return;
    ctx.send({ t: 'clue', text });
    clueInput.value = '';
  });

  const meP = () => state?.players.find((p) => p.id === ctx.me());
  const nameOf = (id: string | null) => state?.players.find((p) => p.id === id)?.name ?? 'Someone';
  const teamLabel = (t: Team) => `${TEAM_EMOJI[t]} ${TEAM_NAMES[t]}`;

  function settingsPanel(s: ForbiddenSettings, isHost: boolean) {
    const summary = `${s.rounds} rounds · ${s.turnSeconds}s turns · ${DECK_LABELS[s.deck]}`;
    if (!isHost) return el('div', { className: 'settings summary' }, el('span', { className: 'label', textContent: 'Game' }), el('span', { textContent: summary }));
    const update = (patch: Partial<ForbiddenSettings>) => ctx.send({ t: 'settings', settings: { ...s, ...patch } });
    return el(
      'div',
      { className: 'settings' },
      el('div', { className: 'settings-title', textContent: 'Game settings' }),
      settingRow('Cards', chips(FORBIDDEN_OPTIONS.deck, s.deck, (d) => DECK_LABELS[d], true, (deck) => update({ deck }))),
      settingRow('Rounds', chips(FORBIDDEN_OPTIONS.rounds, s.rounds, String, true, (rounds) => update({ rounds }))),
      settingRow('Turn', chips(FORBIDDEN_OPTIONS.turnSeconds, s.turnSeconds, (v) => `${v}s`, true, (turnSeconds) => update({ turnSeconds }))),
    );
  }

  function teamColumns(s: ForbiddenStateMessage, canSwitch: boolean) {
    const mine = meP()?.team;
    return el(
      'div',
      { className: 'teams' },
      ...([0, 1] as Team[]).map((t) => {
        const members = s.players.filter((p) => p.team === t && p.connected);
        return el(
          'div',
          { className: `team-col team-${t}${mine === t ? ' mine' : ''}` },
          el('div', { className: 'team-head' }, el('span', { textContent: teamLabel(t) }), el('span', { className: 'team-score', textContent: s.phase === 'lobby' ? `${members.length}` : String(s.teamScores[t]) })),
          el('ul', {}, ...members.map((p) => el('li', { className: p.id === ctx.me() ? 'me' : '' }, avatar(p.name), el('span', { textContent: p.name })))),
          canSwitch && mine !== t ? button('Join', () => ctx.send({ t: 'team', team: t }), 'small') : null,
        );
      }),
    );
  }

  function lobby(s: ForbiddenStateMessage) {
    const isHost = meP()?.host ?? false;
    const connected = s.players.filter((p) => p.connected).length;
    const counts = [0, 1].map((t) => s.players.filter((p) => p.team === t && p.connected).length);
    const unbalanced = counts.some((n) => n < 2) ? 'Each team needs at least 2 players.' : null;
    const [a, b] = s.teamScores;
    const winner = a === b ? null : a > b ? 0 : 1;
    const head =
      s.phase === 'finished'
        ? [
            el('div', { className: 'eyebrow', textContent: 'Game over' }),
            el('h1', { textContent: winner === null ? 'It’s a tie!' : `${teamLabel(winner as Team)} wins!` }),
            el('div', { className: 'big-score', textContent: `${a} – ${b}` }),
          ]
        : [
            el('div', { className: 'logo', textContent: '🚫' }),
            el('h1', { textContent: 'Forbidden Words' }),
            el(
              'ol',
              { className: 'howto' },
              el('li', { textContent: 'Your describer gets a word and five words they can’t say. Describe it in voice, or type clues.' }),
              el('li', { textContent: 'Teammates guess out loud (describer taps “Got it”) or type guesses in chat.' }),
              el('li', { textContent: 'The other team sees the card. Hit 🚨 Buzz if a banned word slips out: −1.' }),
            ),
          ];
    stageCard(
      ui.stage,
      ...head,
      teamColumns(s, true),
      isHost ? button('🔀 Shuffle teams', () => ctx.send({ t: 'shuffle' }), 'link') : null,
      settingsPanel(s.settings, isHost),
      startFooter({
        isHost,
        connected,
        min: 4,
        hostName: s.players.find((p) => p.host)?.name,
        label: s.phase === 'finished' ? 'Play again' : `Start · ${connected} players`,
        onStart: () => ctx.send({ t: 'start' }),
        ready: unbalanced,
      }),
      ctx.menuButton(),
    );
  }

  function taboo(card: { word: string; banned: string[] }) {
    return el('div', { className: 'taboo' }, el('div', { className: 'taboo-word', textContent: card.word }), el('ul', { className: 'taboo-banned' }, ...card.banned.map((b) => el('li', { textContent: b }))));
  }

  function turnLog(s: ForbiddenStateMessage) {
    if (!s.log.length) return null;
    return el('div', { className: 'turn-log' }, ...s.log.map((l) => el('span', { className: `log-chip ${l.result}`, textContent: `${RESULT_LABEL[l.result]} ${l.word}` })));
  }

  function clueFeed() {
    if (!clues.length) return null;
    return el('div', { className: 'clue-feed' }, el('div', { className: 'eyebrow', textContent: 'Typed clues' }), ...clues.slice(-6).map((c) => el('div', { className: 'clue-line', textContent: c })));
  }

  function live(s: ForbiddenStateMessage) {
    const me = meP();
    const describing = s.describerId === ctx.me();
    const myTeamUp = me?.team === s.activeTeam;
    const head = el('div', { className: 'phase-title', textContent: `${teamLabel(s.activeTeam)} · ${nameOf(s.describerId)} describing` });
    const focused = document.activeElement === clueInput;
    if (s.phase === 'ready') {
      stageCard(
        ui.stage,
        el('div', { className: 'eyebrow', textContent: `Round ${s.round}/${s.settings.rounds}` }),
        el('h1', { textContent: describing ? 'You’re describing!' : `${nameOf(s.describerId)} is up for ${TEAM_NAMES[s.activeTeam]}` }),
        el('p', {
          className: 'sub',
          textContent: describing
            ? 'Explain each word without saying it or any banned word. Talk in voice or type clues. Tap Got it when your team says it.'
            : myTeamUp
              ? 'Your team is up! Shout guesses in voice or type them in chat.'
              : 'You’ll see the card. Hit Buzz if they say a banned word.',
        }),
        describing ? button('Start turn', () => ctx.send({ t: 'go' }), 'primary') : waiting('Starting soon…'),
      );
      return;
    }
    if (s.phase === 'between') {
      const got = s.log.filter((l) => l.result === 'got' || l.result === 'guessed').length;
      const lost = s.log.filter((l) => l.result === 'buzz' || l.result === 'said').length;
      stageCard(
        ui.stage,
        el('div', { className: 'eyebrow', textContent: 'Time!' }),
        el('h1', { textContent: `${teamLabel(s.activeTeam)}: +${got}${lost ? ` −${lost}` : ''}` }),
        turnLog(s) ?? el('p', { className: 'sub', textContent: 'No cards this turn.' }),
        teamColumns(s, false),
      );
      return;
    }
    // Turn in progress.
    const parts: (Node | null)[] = [head];
    if (s.card) parts.push(taboo(s.card));
    if (describing) {
      parts.push(el('div', { className: 'actions' }, button('✓ Got it', () => ctx.send({ t: 'got' }), 'good'), button('⏭ Skip', () => ctx.send({ t: 'skip' }))), clueForm);
    } else if (myTeamUp) {
      parts.push(el('div', { className: 'guess-prompt', textContent: '🗣️ Guess! Say it out loud or type it in chat.' }), clueFeed());
    } else {
      parts.push(button('🚨 Buzz', () => ctx.send({ t: 'buzz' }), 'buzz'), clueFeed());
    }
    parts.push(turnLog(s));
    ui.stage.replaceChildren(el('div', { className: 'forbidden-live' }, ...parts));
    if (describing && (focused || !matchMedia('(pointer: coarse)').matches)) clueInput.focus();
  }

  function render() {
    const s = state;
    if (!s) return;
    const active = s.phase !== 'lobby' && s.phase !== 'finished';
    ctx.setPlaying(active);
    ui.status.textContent = s.phase === 'lobby' ? 'Lobby' : s.phase === 'finished' ? 'Game over' : `Round ${s.round}/${s.settings.rounds}`;
    ui.center.textContent = s.phase === 'lobby' ? '' : `${TEAM_EMOJI[0]} ${s.teamScores[0]}  –  ${s.teamScores[1]} ${TEAM_EMOJI[1]}`;
    ui.playersTitle.textContent = 'Teams';
    renderPlayers(
      ui.players,
      [...s.players]
        .sort((a, b) => a.team - b.team || b.score - a.score)
        .map((p: ForbiddenPlayerView) => ({
          ...p,
          score: s.phase === 'lobby' ? undefined : String(p.score),
          cls: `team-${p.team}${active && p.id === s.describerId ? ' drawing' : ''}`,
          status: active && p.id === s.describerId ? '🎙️ describing' : TEAM_NAMES[p.team],
        })),
      ctx.me(),
      false,
    );
    const me = meP();
    const describing = s.phase === 'turn' && s.describerId === ctx.me();
    ui.chat.setInput(describing ? 'Use the clue box instead' : s.phase === 'turn' && me?.team === s.activeTeam ? 'Type your guess…' : 'Say something…', !describing);
    if (!active) lobby(s);
    else live(s);
    tick();
  }

  function tick() {
    if (!state) return;
    setTimer(ui.timer, state.endsAt ? secondsLeft(ctx, state.endsAt) : null, 10);
  }

  return {
    mount(root) {
      ui = shell(root, 'Guesses & chat', (text) => ctx.send({ t: 'chat', text: text.slice(0, MAX_CHAT_LENGTH) }), 'forbidden');
      stageCard(ui.stage, el('h1', { textContent: 'Joining…' }));
      ticker = window.setInterval(tick, 250);
    },
    unmount() {
      clearInterval(ticker);
    },
    onMessage(m) {
      if (m.t === 'state') {
        const prev = state;
        state = m as ForbiddenStateMessage;
        ctx.setClock(state.now);
        // Typed clues belong to the current card.
        if (state.phase !== 'turn' || prev?.phase !== 'turn' || prev.log.length !== state.log.length) clues = [];
        render();
      } else if (m.t === 'clue') {
        clues.push(m.text);
        if (state) render();
      } else if (m.t === 'chat') ui.chat.add(m.kind, m.text, m.name);
    },
  };
}
