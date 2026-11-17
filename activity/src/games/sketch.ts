import { icon } from '../icons';
import {
  CANVAS_H,
  CANVAS_W,
  COLORS,
  describeGoal,
  estimateMinutes,
  LIMITS,
  SETTING_OPTIONS,
  WIDTHS,
  type GameSettings,
  type GoalMode,
  type ServerMessage,
  type StateMessage,
  type StrokeChunk,
} from '../../../src/shared/sketch';
import { avatar, card, Chat, chips, el, podium, renderPlayers, topLeft, waiting, type Ctx, type View } from '../core';

export function createSketch(ctx: Ctx): View {
  const timers: number[] = [];
  let root: HTMLElement;
  let canvas: HTMLCanvasElement;
  let c2d: CanvasRenderingContext2D;
  let overlay: HTMLElement;
  let toolbar: HTMLElement;
  let playersEl: HTMLOListElement;
  let hintEl: HTMLElement;
  let roundEl: HTMLElement;
  let timerEl: HTMLElement;
  let colorsEl: HTMLElement;
  let widthsEl: HTMLElement;
  let chat: Chat;

  let state: StateMessage | null = null;
  let choices: { words: string[]; endsAt: number } | null = null;
  let strokes: StrokeChunk[] = [];
  let color = 0;
  let width = 1;
  let turnStartScores = new Map<string, number>();
  let settingsOpen = false;

  const me = () => ctx.me();
  const send = (m: { t: string } & Record<string, unknown>) => ctx.send(m);
  const amDrawing = () => state?.phase === 'drawing' && state.drawerId === me();

  function showOverlay(...children: Node[]) {
    const first = children[0];
    const wrapped = first instanceof HTMLElement && first.classList.contains('card') ? children : [card(...children)];
    overlay.replaceChildren(...wrapped);
    overlay.classList.remove('peek');
    overlay.classList.remove('hidden');
  }
  const hideOverlay = () => overlay.classList.add('hidden');

  // ── Canvas ───────────────────────────────────────────────────────────────

  function drawChunk(s: StrokeChunk) {
    const p = s.p;
    c2d.strokeStyle = c2d.fillStyle = COLORS[s.c] ?? '#000';
    c2d.lineWidth = WIDTHS[s.w] ?? 4;
    c2d.lineCap = c2d.lineJoin = 'round';
    if (p.length === 2) {
      c2d.beginPath();
      c2d.arc(p[0]!, p[1]!, c2d.lineWidth / 2, 0, Math.PI * 2);
      c2d.fill();
      return;
    }
    c2d.beginPath();
    c2d.moveTo(p[0]!, p[1]!);
    for (let i = 2; i < p.length; i += 2) c2d.lineTo(p[i]!, p[i + 1]!);
    c2d.stroke();
  }

  function redraw() {
    c2d.fillStyle = '#fff';
    c2d.fillRect(0, 0, CANVAS_W, CANVAS_H);
    for (const s of strokes) drawChunk(s);
  }

  let strokeId = Math.floor(Math.random() * 1e6);
  let pending: number[] = [];
  let lastPoint: [number, number] | null = null;
  let drawing = false;

  function toCanvas(e: PointerEvent): [number, number] {
    const r = canvas.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * CANVAS_W), Math.round(((e.clientY - r.top) / r.height) * CANVAS_H)];
  }

  function flush() {
    if (pending.length === 0) return;
    const p = lastPoint && pending.length >= 2 && (pending[0] !== lastPoint[0] || pending[1] !== lastPoint[1]) ? [...lastPoint, ...pending] : pending;
    for (let i = 0; i < p.length; i += LIMITS.maxPointsPerChunk * 2 - 2) {
      const chunk: StrokeChunk = { id: strokeId, c: color, w: width, p: p.slice(i, i + LIMITS.maxPointsPerChunk * 2) };
      strokes.push(chunk);
      send({ t: 'stroke', s: chunk });
    }
    lastPoint = [pending[pending.length - 2]!, pending[pending.length - 1]!];
    pending = [];
  }

  const endStroke = () => {
    if (!drawing) return;
    flush();
    drawing = false;
    lastPoint = null;
  };

  function bindCanvas() {
    canvas.addEventListener('pointerdown', (e) => {
      if (!amDrawing()) return;
      canvas.setPointerCapture(e.pointerId);
      drawing = true;
      strokeId = (strokeId + 1) % 1e9;
      lastPoint = null;
      const [x, y] = toCanvas(e);
      pending = [x, y];
      drawChunk({ id: strokeId, c: color, w: width, p: [x, y] });
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const [x, y] = toCanvas(e);
      const px = pending.length ? pending[pending.length - 2]! : lastPoint?.[0];
      const py = pending.length ? pending[pending.length - 1]! : lastPoint?.[1];
      if (px !== undefined && py !== undefined) {
        if (Math.hypot(x - px, y - py) < 2) return;
        drawChunk({ id: strokeId, c: color, w: width, p: [px, py, x, y] });
      }
      pending.push(x, y);
    });
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
  }

  function renderTools() {
    colorsEl.replaceChildren(
      ...COLORS.map((c, i) => {
        const b = el('button', { type: 'button', className: `swatch${i === color ? ' active' : ''}`, title: i === 1 ? 'Eraser' : c });
        b.style.background = c;
        b.onclick = () => ((color = i), renderTools());
        return b;
      }),
    );
    widthsEl.replaceChildren(
      ...WIDTHS.map((w, i) => {
        const dot = el('span');
        dot.style.width = dot.style.height = `${Math.max(4, Math.min(24, w * 0.6))}px`;
        const b = el('button', { type: 'button', className: `width${i === width ? ' active' : ''}`, title: `${w}px` }, dot);
        b.onclick = () => ((width = i), renderTools());
        return b;
      }),
    );
  }

  // ── Rendering game state ───────────────────────────────────────────────

  function render() {
    if (!state) return;
    const s = state;
    ctx.setPlaying(s.phase !== 'lobby' && s.phase !== 'finished');
    const drawer = s.players.find((p) => p.id === s.drawerId);
    const meP = s.players.find((p) => p.id === me());

    renderProgress();
    hintEl.textContent = s.hint;

    const inGame = s.phase !== 'lobby';
    renderPlayers(
      playersEl,
      [...s.players]
        .sort((a, b) => b.score - a.score)
        .map((p) => {
          const isDrawer = p.id === s.drawerId && s.phase !== 'finished';
          const guessed = p.guessed && (s.phase === 'drawing' || s.phase === 'reveal');
          return {
            ...p,
            score: String(p.score),
            cls: [guessed && 'guessed', isDrawer && 'drawing'].filter(Boolean).join(' '),
            status: isDrawer ? '✏️ drawing' : p.guessed && s.phase === 'drawing' ? '✓ guessed' : '',
          };
        }),
      me(),
      inGame,
    );

    toolbar.classList.toggle('hidden', !amDrawing());
    canvas.classList.toggle('can-draw', amDrawing());
    const canGuess = s.phase !== 'drawing' || (s.drawerId !== me() && !meP?.guessed);
    chat.setInput(
      s.phase === 'drawing' ? (s.drawerId === me() ? "You're drawing!" : canGuess ? 'Type your guess…' : 'Chat with others who guessed…') : 'Say something…',
      !(s.phase === 'drawing' && s.drawerId === me()),
    );

    const isHost = meP?.host ?? false;
    const connected = s.players.filter((p) => p.connected).length;
    if (s.phase === 'lobby' || s.phase === 'finished') {
      const host = s.players.find((p) => p.host);
      const ranking = [...s.players].sort((a, b) => b.score - a.score);
      const head: Node[] = [];
      if (s.phase === 'finished') {
        const tie = ranking.length > 1 && ranking[0]!.score === ranking[1]!.score;
        head.push(el('div', { className: 'eyebrow', textContent: 'Game over' }), el('h1', { textContent: tie ? 'It’s a tie!' : `${ranking[0]?.name ?? ''} wins!` }), podium(ranking, me()));
      } else {
        head.push(
          el('div', { className: 'logo' }, icon('palette')),
          el('h1', { textContent: 'Sketch Party' }),
          el('p', { className: 'sub', textContent: 'Take turns drawing a secret word while everyone else races to guess it.' }),
        );
      }
      let footer: Node;
      if (connected < 2) {
        footer = waiting('Waiting for one more player to join…');
      } else if (isHost) {
        const start = el('button', { type: 'button', className: 'primary', textContent: s.phase === 'finished' ? 'Play again' : `Start game · ${connected} players` });
        start.onclick = () => send({ t: 'start' });
        footer = start;
      } else {
        footer = waiting(`Waiting for ${host?.name ?? 'the host'} to start…`);
      }
      const menu = ctx.menuButton();
      showOverlay(card(...head, settingsPanel(s.settings, isHost, connected, s.phase === 'finished'), footer, ...(menu ? [menu] : [])));
    } else if (s.phase === 'choosing') {
      if (s.drawerId === me() && choices) {
        showOverlay(
          card(
            el('div', { className: 'eyebrow', textContent: 'Your turn' }),
            el('h1', { textContent: 'Pick a word to draw' }),
            el(
              'div',
              { className: 'choices' },
              ...choices.words.map((w, i) => {
                const b = el('button', { type: 'button', className: 'word', textContent: w });
                b.onclick = () => send({ t: 'pick', index: i });
                return b;
              }),
            ),
          ),
        );
      } else {
        showOverlay(
          card(
            ...(drawer ? [avatar(drawer.name, 'lg')] : []),
            el('h1', { className: 'small', textContent: `${drawer?.name ?? 'Someone'} is choosing a word` }),
            waiting('Get ready to guess'),
          ),
        );
      }
    } else if (s.phase === 'reveal') {
      showOverlay(
        card(
          el('div', { className: 'eyebrow', textContent: s.word ? 'The word was' : 'Time’s up!' }),
          ...(s.word ? [el('div', { className: 'reveal-word', textContent: s.word })] : []),
          roundScores(s),
        ),
      );
      overlay.classList.add('peek');
    } else {
      hideOverlay();
    }
  }

  // ── Game length settings ───────────────────────────────────────────────

  const MODE_LABELS: Record<GoalMode, string> = { time: '⏳ Time limit', points: '🎯 Points', rounds: '🔁 Rounds' };
  const valueLabel = (mode: GoalMode, v: number) => (mode === 'time' ? `${v} min` : mode === 'points' ? `${v} pts` : `${v}`);
  const formatEstimate = (minutes: number) => (minutes < 1.5 ? '≈ 1 min' : `≈ ${Math.round(minutes)} min`);

  function settingsPanel(settings: GameSettings, isHost: boolean, players: number, next: boolean) {
    const estimate = estimateMinutes(settings, players);
    const timeNote = settings.mode === 'time' ? ' (last turn finishes after time is up)' : '';
    // Non-hosts can't change anything, so a row of disabled chips is just noise. Show one line instead.
    if (!isHost) {
      return el(
        'div',
        { className: 'settings summary' },
        el('span', { className: 'label', textContent: next ? 'Next game' : 'Game' }),
        el('span', { textContent: `${describeGoal(settings)} · ${settings.drawSeconds}s per drawing · ${formatEstimate(estimate)}${timeNote}` }),
      );
    }
    const update = (nextS: Partial<GameSettings>) => {
      const merged = { ...settings, ...nextS };
      // Switching mode picks a sensible value for that mode.
      if (nextS.mode && nextS.mode !== settings.mode) merged.value = nextS.mode === 'time' ? 10 : nextS.mode === 'points' ? 500 : 1;
      send({ t: 'settings', settings: merged });
    };
    const summary = `${describeGoal(settings)} · ${settings.drawSeconds}s per drawing · ${formatEstimate(estimate)}`;
    // After a game the host mostly wants "Play again", so the controls start collapsed there.
    if (next && !settingsOpen) {
      const edit = el('button', { type: 'button', className: 'link', textContent: 'Change' });
      edit.onclick = () => ((settingsOpen = true), render());
      return el('div', { className: 'settings summary' }, el('span', { className: 'label', textContent: 'Next game' }), el('span', { textContent: summary }), edit);
    }
    return el(
      'div',
      { className: 'settings' },
      el('div', { className: 'settings-title', textContent: next ? 'Next game' : 'Game settings' }),
      el('div', { className: 'row' }, el('span', { className: 'label', textContent: 'Ends by' }), chips(['time', 'points', 'rounds'] as GoalMode[], settings.mode, (m) => MODE_LABELS[m], isHost, (mode) => update({ mode }))),
      el(
        'div',
        { className: 'row' },
        el('span', { className: 'label', textContent: settings.mode === 'time' ? 'Length' : settings.mode === 'points' ? 'Target' : 'Rounds' }),
        chips(SETTING_OPTIONS[settings.mode] as readonly number[], settings.value, (v) => valueLabel(settings.mode, v), isHost, (value) => update({ value })),
      ),
      el(
        'div',
        { className: 'row' },
        el('span', { className: 'label', textContent: 'Draw time' }),
        chips(SETTING_OPTIONS.drawSeconds as readonly number[], settings.drawSeconds, (v) => `${v}s`, isHost, (drawSeconds) => update({ drawSeconds })),
      ),
      el('div', { className: 'estimate', textContent: `${describeGoal(settings)} · ${formatEstimate(estimate)} with ${Math.max(2, players)} players${timeNote}` }),
    );
  }

  /** Points each player picked up this turn. */
  function roundScores(s: StateMessage) {
    const gains = s.players
      .map((p) => ({ p, d: p.score - (turnStartScores.get(p.id) ?? p.score) }))
      .filter((g) => g.d > 0)
      .sort((a, b) => b.d - a.d);
    if (!gains.length) return el('p', { className: 'sub', textContent: 'Nobody got it this time.' });
    return el(
      'ul',
      { className: 'gains' },
      ...gains.map(({ p, d }) =>
        el('li', { className: p.id === me() ? 'me' : '' }, avatar(p.name), el('span', { className: 'name', textContent: p.name }, p.id === s.drawerId ? icon('pencil', 'inline') : null), el('span', { className: 'plus', textContent: `+${d}` })),
      ),
    );
  }

  function renderProgress() {
    const s = state;
    if (!s) return;
    if (s.phase === 'lobby') roundEl.textContent = 'Lobby';
    else if (s.phase === 'finished') roundEl.textContent = 'Game over';
    else if (s.settings.mode === 'rounds') roundEl.textContent = `Round ${s.round}/${s.totalRounds}`;
    else if (s.settings.mode === 'points') roundEl.replaceChildren(icon('target', 'inline'), ` First to ${s.settings.value} · turn ${s.turn}`);
    else if (s.gameEndsAt) {
      const left = Math.max(0, Math.ceil((s.gameEndsAt - ctx.now()) / 1000));
      roundEl.replaceChildren(icon('hourglass', 'inline'), left > 0 ? ` ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left` : ' Last turn!');
    }
  }

  function tick() {
    if (state?.settings.mode === 'time') renderProgress();
    if (state?.endsAt) {
      const left = Math.max(0, Math.ceil((state.endsAt - ctx.now()) / 1000));
      timerEl.replaceChildren(icon('clock', 'inline'), ` ${left}s`);
      timerEl.classList.toggle('low', left <= 10 && state.phase === 'drawing');
    } else {
      timerEl.textContent = '';
      timerEl.classList.remove('low');
    }
  }

  return {
    mount(r) {
      root = r;
      chat = new Chat('Guesses', (text) => send({ t: 'guess', text: text.slice(0, LIMITS.maxGuessLength) }), LIMITS.maxGuessLength);
      chat.setInput('Type your guess…');
      roundEl = el('div', { className: 'pill', textContent: 'Lobby' });
      hintEl = el('div', { className: 'hint' });
      timerEl = el('div', { className: 'pill timer' });
      playersEl = el('ol', { className: 'plist' });
      canvas = el('canvas', { width: CANVAS_W, height: CANVAS_H });
      overlay = el('div', { className: 'overlay' });
      colorsEl = el('div', { className: 'colors' });
      widthsEl = el('div', { className: 'widths' });
      const undo = el('button', { type: 'button', className: 'tool', title: 'Undo', textContent: '↶ Undo' });
      const clear = el('button', { type: 'button', className: 'tool danger', title: 'Clear' }, icon('trash', 'inline'), ' Clear');
      undo.onclick = () => send({ t: 'undo' });
      clear.onclick = () => send({ t: 'clear' });
      toolbar = el('div', { className: 'toolbar hidden' }, colorsEl, widthsEl, undo, clear);
      root.replaceChildren(
        el(
          'div',
          { className: 'app' },
          el('header', { className: 'topbar' }, topLeft(roundEl), hintEl, timerEl),
          el(
            'main',
            { className: 'layout' },
            el('aside', { className: 'panel players' }, el('h2', { textContent: 'Players' }), playersEl),
            el('section', { className: 'stage' }, el('div', { className: 'canvas-wrap' }, el('div', { className: 'board' }, canvas, overlay)), toolbar),
            chat.root,
          ),
        ),
      );
      c2d = canvas.getContext('2d')!;
      bindCanvas();
      renderTools();
      redraw();
      showOverlay(el('h1', { textContent: 'Joining…' }));
      timers.push(window.setInterval(() => drawing && flush(), 50), window.setInterval(tick, 250));
    },
    unmount() {
      for (const t of timers) clearInterval(t);
      timers.length = 0;
    },
    onMessage(raw) {
      const msg = raw as ServerMessage;
      switch (msg.t) {
        case 'state': {
          const prevPhase = state?.phase;
          state = msg;
          ctx.setClock(msg.now);
          if (msg.phase !== 'choosing') choices = null;
          if (prevPhase === 'drawing' && msg.phase !== 'drawing') endStroke();
          if (msg.phase !== prevPhase) settingsOpen = false;
          if (msg.phase === 'choosing' || (msg.phase === 'drawing' && prevPhase !== 'drawing' && prevPhase !== 'choosing')) {
            turnStartScores = new Map(msg.players.map((p) => [p.id, p.score]));
          }
          render();
          tick();
          break;
        }
        case 'choices':
          choices = { words: msg.words, endsAt: msg.endsAt };
          render();
          break;
        case 'stroke':
          strokes.push(msg.s);
          drawChunk(msg.s);
          break;
        case 'canvas':
          strokes = msg.strokes;
          redraw();
          break;
        case 'chat':
          chat.add(msg.kind, msg.text, msg.name);
          break;
      }
    },
  };
}
