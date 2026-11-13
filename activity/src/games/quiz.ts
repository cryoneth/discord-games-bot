import { MAX_CHAT_LENGTH } from '../../../src/shared/protocol';
import {
  QUESTION_SECONDS,
  QUIZ_LIMITS,
  sanitizeQuiz,
  type Quiz,
  type QuizQuestion,
  type QuizStateMessage,
  type QuizSummary,
} from '../../../src/shared/quiz';
import { avatar, button, chips, el, podium, renderPlayers, secondsLeft, setTimer, shell, stageCard, startFooter, waiting, type Ctx, type Shell, type View } from '../core';

const SHAPES = ['▲', '◆', '●', '■'];

interface Draft {
  id?: string;
  title: string;
  questions: QuizQuestion[];
}

const blankQuestion = (): QuizQuestion => ({ q: '', answers: ['', '', '', ''], correct: 0, seconds: 20 });

export function createQuiz(ctx: Ctx): View {
  let ui: Shell;
  let root: HTMLElement;
  let state: QuizStateMessage | null = null;
  let quizzes: QuizSummary[] = [];
  let ticker = 0;
  let editor: HTMLElement | null = null;
  let draft: Draft | null = null;
  let editorError = '';

  const meP = () => state?.players.find((p) => p.id === ctx.me());

  // ── Lobby ────────────────────────────────────────────────────────────────

  function quizPicker(s: QuizStateMessage, isHost: boolean) {
    const list = el(
      'div',
      { className: 'quiz-list' },
      ...quizzes.map((q) => {
        const selected = s.settings.quizId === q.id;
        const row = el(
          'div',
          { className: `quiz-row${selected ? ' selected' : ''}` },
          el('span', { className: 'quiz-title', textContent: q.title }),
          el('span', { className: 'quiz-meta', textContent: `${q.count} Q${q.builtin ? ' · built-in' : q.mine ? ' · yours' : ''}` }),
          button(q.mine ? 'Edit' : 'Copy', () => ctx.send({ t: 'load', id: q.id }), 'small'),
        );
        if (isHost) {
          row.classList.add('pickable');
          row.onclick = (e) => {
            if ((e.target as HTMLElement).tagName === 'BUTTON') return;
            ctx.send({ t: 'settings', settings: { ...s.settings, quizId: q.id } });
          };
        }
        return row;
      }),
    );
    return el(
      'div',
      { className: 'settings' },
      el('div', { className: 'settings-title', textContent: isHost ? 'Pick a quiz' : 'Quizzes' }),
      list,
      el(
        'div',
        { className: 'quiz-tools' },
        button('＋ New quiz', () => openEditor({ title: '', questions: [blankQuestion()] })),
        isHost ? el('label', { className: 'toggle' }, (() => {
          const cb = el('input', { type: 'checkbox', checked: s.settings.shuffle });
          cb.onchange = () => ctx.send({ t: 'settings', settings: { ...s.settings, shuffle: cb.checked } });
          return cb;
        })(), 'Shuffle questions') : null,
      ),
    );
  }

  function lobby(s: QuizStateMessage) {
    const isHost = meP()?.host ?? false;
    const connected = s.players.filter((p) => p.connected).length;
    const ranking = [...s.players].sort((a, b) => b.score - a.score);
    const head =
      s.phase === 'finished'
        ? [el('div', { className: 'eyebrow', textContent: 'Final scores' }), el('h1', { textContent: ranking[0] && ranking[0].score > 0 ? `${ranking[0].name} wins!` : 'Quiz over' }), podium(ranking, ctx.me())]
        : [el('div', { className: 'logo', textContent: '⚡' }), el('h1', { textContent: 'Quiz Arena' }), el('p', { className: 'sub', textContent: 'Answer fast for more points. Streaks earn a bonus.' })];
    stageCard(
      ui.stage,
      ...head,
      quizPicker(s, isHost),
      s.quiz ? el('div', { className: 'settings summary' }, el('span', { className: 'label', textContent: 'Up next' }), el('span', { textContent: `${s.quiz.title} · ${s.quiz.count} question${s.quiz.count === 1 ? '' : 's'}${s.settings.shuffle ? ' · shuffled' : ''}` })) : null,
      startFooter({
        isHost,
        connected,
        min: 1,
        hostName: s.players.find((p) => p.host)?.name,
        label: s.phase === 'finished' ? 'Play again' : connected === 1 ? 'Start solo' : `Start · ${connected} players`,
        onStart: () => ctx.send({ t: 'start' }),
      }),
      ctx.menuButton(),
    );
  }

  // ── Questions ────────────────────────────────────────────────────────────

  function answerTiles(s: QuizStateMessage) {
    const q = s.question!;
    const reveal = s.reveal;
    const total = reveal ? reveal.counts.reduce((a, b) => a + b, 0) : 0;
    return el(
      'div',
      { className: `answers n${q.answers.length}` },
      ...q.answers.map((a, i) => {
        const cls = ['answer', `a${i}`, s.myAnswer === i && 'mine', reveal && (i === reveal.correct ? 'correct' : 'wrong'), s.myAnswer !== null && !reveal && s.myAnswer !== i && 'dim'].filter(Boolean).join(' ');
        const b = el(
          'button',
          { type: 'button', className: cls, disabled: s.phase !== 'question' || s.myAnswer !== null },
          el('span', { className: 'shape', textContent: SHAPES[i]! }),
          el('span', { className: 'answer-text', textContent: a }),
          reveal ? el('span', { className: 'count', textContent: String(reveal.counts[i] ?? 0) }) : null,
        );
        if (reveal && total) b.style.setProperty('--fill', `${((reveal.counts[i] ?? 0) / total) * 100}%`);
        b.onclick = () => ctx.send({ t: 'answer', index: i });
        return b;
      }),
    );
  }

  function live(s: QuizStateMessage) {
    const q = s.question;
    if (!q) return;
    const head = el('div', { className: 'q-head' }, el('span', { className: 'eyebrow', textContent: `Question ${s.index + 1} of ${s.total}` }), el('div', { className: 'q-text', textContent: q.q }));
    const parts: (Node | null)[] = [head];
    if (s.phase === 'intro') {
      parts.push(el('div', { className: 'intro-bar' }, el('span')), waiting('Get ready…'));
    } else if (s.phase === 'question') {
      const online = s.players.filter((p) => p.connected);
      parts.push(answerTiles(s), el('div', { className: 'sub center', textContent: s.myAnswer !== null ? `Answer locked in · ${online.filter((p) => p.answered).length}/${online.length} answered` : `${online.filter((p) => p.answered).length}/${online.length} answered` }));
    } else if (s.phase === 'reveal' && s.reveal) {
      const gain = s.reveal.gains[ctx.me()];
      const me = meP();
      parts.push(
        answerTiles(s),
        el(
          'div',
          { className: `my-result ${gain ? 'right' : 'wrong'}` },
          gain ? `✓ +${gain}${me && me.streak > 1 ? `  🔥 ${me.streak} in a row` : ''}` : s.myAnswer === null ? '⌛ No answer' : '✗ Not this time',
        ),
        miniBoard(s),
        me?.host ? button(s.index + 1 >= s.total ? 'Final results ▸' : 'Next ▸', () => ctx.send({ t: 'next' }), 'small next') : null,
      );
    }
    ui.stage.replaceChildren(el('div', { className: 'quiz-live' }, ...parts));
    if (s.phase === 'intro') {
      const bar = ui.stage.querySelector<HTMLElement>('.intro-bar span');
      if (bar) bar.style.animationDuration = `${Math.max(0.5, ((s.endsAt ?? 0) - ctx.now()) / 1000)}s`;
    }
  }

  function miniBoard(s: QuizStateMessage) {
    const top = [...s.players].sort((a, b) => b.score - a.score).slice(0, 5);
    return el(
      'ol',
      { className: 'mini-board' },
      ...top.map((p) => el('li', { className: p.id === ctx.me() ? 'me' : '' }, avatar(p.name), el('span', { className: 'name', textContent: p.name }), s.reveal?.gains[p.id] ? el('span', { className: 'plus', textContent: `+${s.reveal.gains[p.id]}` }) : null, el('span', { className: 'score', textContent: String(p.score) }))),
    );
  }

  // ── Editor ───────────────────────────────────────────────────────────────

  function openEditor(d: Draft) {
    draft = structuredClone(d);
    for (const q of draft.questions) while (q.answers.length < 2) q.answers.push('');
    editorError = '';
    renderEditor();
  }

  function closeEditor() {
    editor?.remove();
    editor = null;
    draft = null;
  }

  /** Two-step delete (dialogs like confirm() are blocked inside Discord). */
  function deleteButton(id: string) {
    let armed = false;
    const b = button('Delete quiz', () => {
      if (!armed) {
        armed = true;
        b.textContent = 'Click again to delete';
        return;
      }
      ctx.send({ t: 'remove', id });
      closeEditor();
    }, 'small danger');
    return b;
  }

  function renderEditor() {
    if (!draft) return;
    const d = draft;
    const scroll = editor?.querySelector('.editor-body')?.scrollTop ?? 0;
    const title = el('input', { className: 'field', maxLength: QUIZ_LIMITS.titleLength, placeholder: 'Quiz title', value: d.title });
    title.oninput = () => (d.title = title.value);

    const questions = d.questions.map((q, qi) => {
      const qInput = el('textarea', { className: 'field', maxLength: QUIZ_LIMITS.questionLength, placeholder: `Question ${qi + 1}`, value: q.q, rows: 2 });
      qInput.oninput = () => (q.q = qInput.value);
      const answers = q.answers.map((a, ai) => {
        const input = el('input', { className: 'field', maxLength: QUIZ_LIMITS.answerLength, placeholder: `Answer ${ai + 1}`, value: a });
        input.oninput = () => (q.answers[ai] = input.value);
        const mark = el('button', { type: 'button', className: `mark${q.correct === ai ? ' on' : ''}`, title: 'Correct answer', textContent: q.correct === ai ? '✓' : '' });
        mark.onclick = () => ((q.correct = ai), renderEditor());
        const remove =
          q.answers.length > QUIZ_LIMITS.minAnswers
            ? button('×', () => {
                q.answers.splice(ai, 1);
                if (q.correct >= q.answers.length) q.correct = 0;
                else if (q.correct > ai) q.correct--;
                renderEditor();
              }, 'icon')
            : null;
        return el('div', { className: `ed-answer a${ai}` }, el('span', { className: 'shape', textContent: SHAPES[ai]! }), input, mark, remove);
      });
      return el(
        'div',
        { className: 'ed-question' },
        el(
          'div',
          { className: 'ed-q-head' },
          el('span', { className: 'eyebrow', textContent: `Question ${qi + 1}` }),
          chips(QUESTION_SECONDS, (QUESTION_SECONDS as readonly number[]).includes(q.seconds) ? (q.seconds as (typeof QUESTION_SECONDS)[number]) : 20, (v) => `${v}s`, true, (v) => ((q.seconds = v), renderEditor())),
          d.questions.length > 1 ? button('Delete', () => (d.questions.splice(qi, 1), renderEditor()), 'small danger') : null,
        ),
        qInput,
        ...answers,
        q.answers.length < QUIZ_LIMITS.maxAnswers ? button('＋ Answer', () => (q.answers.push(''), renderEditor()), 'link') : null,
      );
    });

    const importBox = el('textarea', { className: 'field mono', rows: 4, placeholder: '{"title": "…", "questions": [{"q": "…", "answers": ["…", "…"], "correct": 0, "seconds": 20}]}' });
    const io = el(
      'details',
      { className: 'io' },
      el('summary', { textContent: 'Import / export JSON' }),
      el('p', { className: 'sub', textContent: 'Paste a quiz to import it, or copy this one to prepare offline. "correct" is the index of the right answer (0 = first).' }),
      importBox,
      el(
        'div',
        { className: 'row' },
        button('Import', () => {
          try {
            const parsed = sanitizeQuiz(JSON.parse(importBox.value));
            if (typeof parsed === 'string') editorError = parsed;
            else {
              d.title = parsed.title;
              d.questions = parsed.questions;
              editorError = '';
            }
          } catch {
            editorError = 'That isn’t valid JSON.';
          }
          renderEditor();
        }),
        button('Export', () => {
          importBox.value = JSON.stringify({ title: d.title, questions: d.questions }, null, 2);
          importBox.select();
        }),
      ),
    );

    const save = button(d.id ? 'Save changes' : 'Save quiz', () => {
      // Empty answer boxes are dropped; the correct answer itself must be filled in.
      const blankCorrect = d.questions.findIndex((q) => !q.answers[q.correct]?.trim());
      const clean =
        blankCorrect >= 0
          ? `The correct answer for question ${blankCorrect + 1} is empty.`
          : sanitizeQuiz({
              ...d,
              questions: d.questions.map((q) => ({ ...q, answers: q.answers.filter((a) => a.trim()), correct: q.answers.slice(0, q.correct).filter((a) => a.trim()).length })),
            });
      if (typeof clean === 'string') {
        editorError = clean;
        return renderEditor();
      }
      ctx.send({ t: 'save', ...(d.id ? { id: d.id } : {}), quiz: clean });
    }, 'primary');

    const panel = el(
      'div',
      { className: 'editor' },
      el(
        'header',
        { className: 'editor-head' },
        el('h2', { textContent: d.id ? 'Edit quiz' : 'New quiz' }),
        d.id ? deleteButton(d.id) : null,
        button('✕', closeEditor, 'icon'),
      ),
      el(
        'div',
        { className: 'editor-body' },
        title,
        ...questions,
        d.questions.length < QUIZ_LIMITS.maxQuestions ? button('＋ Add question', () => (d.questions.push(blankQuestion()), renderEditor())) : null,
        io,
        el('p', { className: 'sub small', textContent: 'Quizzes are saved for this server so anyone here can play them. Only you can edit or delete yours. Unused quizzes are deleted automatically after a while.' }),
      ),
      el('footer', { className: 'editor-foot' }, editorError ? el('div', { className: 'error', textContent: editorError }) : null, save),
    );
    const next = el('div', { className: 'editor-backdrop' }, panel);
    if (editor) editor.replaceWith(next);
    else root.append(next);
    editor = next;
    const body = editor.querySelector('.editor-body');
    if (body) body.scrollTop = scroll;
  }

  // ── Wiring ───────────────────────────────────────────────────────────────

  function render() {
    const s = state;
    if (!s) return;
    const active = s.phase !== 'lobby' && s.phase !== 'finished';
    ctx.setPlaying(active);
    ui.status.textContent = active ? `Q ${s.index + 1}/${s.total}` : s.phase === 'finished' ? 'Final' : 'Lobby';
    ui.center.textContent = active && s.quiz ? s.quiz.title : '';
    renderPlayers(
      ui.players,
      [...s.players]
        .sort((a, b) => b.score - a.score)
        .map((p) => ({
          ...p,
          score: String(p.score),
          cls: s.phase === 'question' && p.answered ? 'guessed' : '',
          status: s.phase === 'question' && p.answered ? '✓ answered' : p.streak > 1 ? `🔥 ${p.streak} streak` : '',
        })),
      ctx.me(),
      s.phase !== 'lobby',
    );
    if (active) live(s);
    else lobby(s);
    tick();
  }

  function tick() {
    if (!state) return;
    setTimer(ui.timer, state.phase === 'question' && state.endsAt ? secondsLeft(ctx, state.endsAt) : null, 5);
  }

  return {
    mount(r) {
      root = r;
      ui = shell(root, 'Chat', (text) => ctx.send({ t: 'chat', text: text.slice(0, MAX_CHAT_LENGTH) }), 'quiz');
      stageCard(ui.stage, el('h1', { textContent: 'Joining…' }));
      ticker = window.setInterval(tick, 250);
      ctx.send({ t: 'list' });
    },
    unmount() {
      clearInterval(ticker);
      closeEditor();
    },
    onMessage(m) {
      switch (m.t) {
        case 'state': {
          const prev = state?.phase;
          state = m as QuizStateMessage;
          ctx.setClock(state.now);
          if ((state.phase === 'lobby' || state.phase === 'finished') && prev !== state.phase) ctx.send({ t: 'list' });
          render();
          break;
        }
        case 'quizzes':
          quizzes = m.items as QuizSummary[];
          if (state && (state.phase === 'lobby' || state.phase === 'finished')) render();
          break;
        case 'quiz': {
          const q = m.quiz as Quiz;
          // Someone else's quiz opens as a copy you can save under your name.
          openEditor(m.mine ? { id: q.id, title: q.title, questions: q.questions } : { title: `${q.title} (copy)`.slice(0, QUIZ_LIMITS.titleLength), questions: q.questions });
          break;
        }
        case 'saved':
          closeEditor();
          break;
        case 'chat':
          if (editor && m.kind === 'private' && draft) {
            editorError = m.text.startsWith('Saved') ? '' : m.text;
            renderEditor();
          }
          ui.chat.add(m.kind, m.text, m.name);
          break;
      }
    },
  };
}
