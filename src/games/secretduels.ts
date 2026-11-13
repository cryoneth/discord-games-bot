/**
 * Duels where each player hides a secret for the other to find: hangman and the
 * number duel. Both go: lock in secrets through a pop-up → take turns guessing
 * through a pop-up → equal turns, so if the first player solves it the second
 * still gets one last try for a draw.
 */
import {
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  InteractionContextType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Message,
} from 'discord.js';
import { hangmanScene, numberScene, type HangmanBoard, type NumberTrack } from '../render/duels.js';
import type { Scene } from '../render/boards.js';
import type { GameId, ScoreStore } from '../store.js';
import { card, nonce, ROW, sceneImage, type Card } from '../ui/card.js';
import { pick, rand } from '../util/random.js';
import { WORDS } from './data/words.js';
import { opponentOption, runDuel, statusLine, TURN_SECONDS, type DuelGame, type Ending, type Seat } from './duel.js';
import { isSolved, maskWord } from './logic.js';

const SETUP_SECONDS = 90;
const MODAL_SECONDS = 120;
const MARKS: [string, string] = ['🔴', '🟢'];

interface TextInput {
  label: string;
  placeholder: string;
  min: number;
  max: number;
}

type Outcome = { error: string } | { note: string };

/** One game's rules and state. Seat `s` hunts the secret that seat `1 - s` set. */
export interface SecretRules {
  /** Shown while both players pick their secret. */
  setupText: string;
  secretInput: TextInput & { required: false };
  guessInput: TextInput;
  /** Validates a typed secret, or picks one at random when `raw` is empty. */
  parseSecret(raw: string): { value: string } | { error: string };
  setSecret(seat: Seat, value: string): void;
  guess(seat: Seat, raw: string): Outcome;
  solved(seat: Seat): boolean;
  /** Out of lives: the opponent wins straight away. */
  failed(seat: Seat): boolean;
  scene(turn: number, winner: number, reveal: boolean, celebrate: boolean): Scene;
}

export function secretDuel(def: { id: GameId; title: string; color: number; create: () => SecretRules }): DuelGame {
  return {
    id: def.id,
    title: def.title,
    color: def.color,
    async play(message, invited) {
      const rules = def.create();
      const players: [string, string] = Math.random() < 0.5 ? [invited[0], invited[1]] : [invited[1], invited[0]];
      const vs = `${MARKS[0]} <@${players[0]}>  vs  ${MARKS[1]} <@${players[1]}>`;
      const edit = (c: Card) => message.edit(card(c)).catch(() => {});

      // ── Setup: both lock in a secret ──
      const setId = `${def.id}:${nonce()}`;
      const locked: [boolean, boolean] = [false, false];
      const randomFor: string[] = [];
      const setupEnds = Math.floor(Date.now() / 1000) + SETUP_SECONDS;
      const setupCard = (): Card => ({
        color: def.color,
        title: def.title,
        body:
          `${vs}\n${rules.setupText}\nSetup ends <t:${setupEnds}:R>.\n` +
          players.map((p, s) => `${locked[s] ? '🔒' : '⏳'} <@${p}>`).join('   '),
        rows: [ROW().addComponents(new ButtonBuilder().setCustomId(`${setId}:set`).setLabel('Set your secret').setEmoji('🔒').setStyle(ButtonStyle.Primary))],
      });
      await edit(setupCard());

      const setupDone = await new Promise<boolean>((resolve) => {
        const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: SETUP_SECONDS * 1000 });
        collector.on('collect', async (btn) => {
          if (btn.customId !== `${setId}:set`) return;
          const seat = players.indexOf(btn.user.id) as Seat | -1;
          if (seat === -1) return void (await btn.reply({ content: "You're not playing in this game.", flags: MessageFlags.Ephemeral }).catch(() => {}));
          if (locked[seat]) return void (await btn.reply({ content: 'Your secret is already locked in.', flags: MessageFlags.Ephemeral }).catch(() => {}));
          const submit = await askText(btn, `${setId}:m:${btn.id}`, 'Your secret', rules.secretInput);
          if (!submit) return;
          const parsed = rules.parseSecret(submit.value);
          if ('error' in parsed) return void (await submit.modal.reply({ content: parsed.error, flags: MessageFlags.Ephemeral }).catch(() => {}));
          if (locked[seat] || collector.ended) return void (await submit.modal.deferUpdate().catch(() => {}));
          rules.setSecret(seat, parsed.value);
          locked[seat] = true;
          await submit.modal
            .reply({ content: `🔒 Locked in: **${parsed.value}**${submit.value.trim() ? '' : ' (picked at random)'}. Keep it secret!`, flags: MessageFlags.Ephemeral })
            .catch(() => {});
          if (locked[0] && locked[1]) collector.stop('ready');
          else await edit(setupCard());
        });
        collector.once('end', (_c, reason) => resolve(reason === 'ready' || locked.some(Boolean)));
      });
      if (!setupDone) {
        await edit({ color: 0x4e5058, title: def.title, body: `${vs}\nNobody set a secret, so the game was called off.` });
        return null;
      }
      // Anyone who didn't make it in time gets a random secret.
      for (const s of [0, 1] as const) {
        if (locked[s]) continue;
        const r = rules.parseSecret('');
        if ('value' in r) rules.setSecret(s, r.value);
        randomFor.push(`<@${players[s]}>`);
      }

      // ── Guessing: alternate turns ──
      const id = `${def.id}:${nonce()}`;
      let turn: Seat = 0;
      let ending: Ending = null;
      let lastChance = false;
      let note = randomFor.length ? `🎲 Secret picked at random for ${randomFor.join(' and ')}.` : 'Secrets locked in. Let the hunt begin!';
      let renders = 0;
      const winnerSeat = () => (ending && ending.kind !== 'draw' ? ending.winner : -1);
      const view = (rows: boolean, celebrate = false): Card => ({
        color: ending && ending.kind !== 'draw' ? 0xfee75c : def.color,
        title: def.title,
        body: `${vs}\n${note}\n${lastChance && !ending ? `⚡ **Last chance** for <@${players[turn]}> to draw level!\n` : ''}${statusLine(players, turn, ending, MARKS)}`,
        image: sceneImage(rules.scene(ending ? -1 : turn, winnerSeat(), Boolean(ending), celebrate), `${def.id}-${renders++}`, `${def.title} board`, celebrate),
        footer: ending ? undefined : `Turns time out after ${TURN_SECONDS / 60} min of inactivity`,
        rows: rows
          ? [
              ROW().addComponents(
                new ButtonBuilder().setCustomId(`${id}:guess`).setLabel('Guess').setEmoji('✏️').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`${id}:forfeit`).setLabel('Forfeit').setEmoji('🏳️').setStyle(ButtonStyle.Secondary),
              ),
            ]
          : [],
      });
      await edit(view(true));

      await new Promise<void>((resolve) => {
        const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, idle: TURN_SECONDS * 1000, time: 30 * 60 * 1000 });
        collector.on('collect', async (btn) => {
          if (!btn.customId.startsWith(`${id}:`) || ending) return;
          const seat = players.indexOf(btn.user.id) as Seat | -1;
          if (seat === -1) return void (await btn.reply({ content: "You're not playing in this game.", flags: MessageFlags.Ephemeral }).catch(() => {}));
          if (btn.customId === `${id}:forfeit`) {
            ending = { kind: 'forfeit', winner: (1 - seat) as Seat };
            await btn.deferUpdate().catch(() => {});
            return void collector.stop('done');
          }
          if (seat !== turn) return void (await btn.reply({ content: `It's <@${players[turn]}>'s turn.`, flags: MessageFlags.Ephemeral }).catch(() => {}));

          const submit = await askText(btn, `${id}:m:${btn.id}`, 'Your guess', rules.guessInput);
          if (!submit) return;
          collector.resetTimer();
          if (ending || seat !== turn) return void (await submit.modal.reply({ content: "It's not your turn any more.", flags: MessageFlags.Ephemeral }).catch(() => {}));
          const out = rules.guess(seat, submit.value);
          if ('error' in out) return void (await submit.modal.reply({ content: out.error, flags: MessageFlags.Ephemeral }).catch(() => {}));
          note = `${MARKS[seat]} ${out.note}`;

          const other = (1 - seat) as Seat;
          if (rules.failed(seat)) ending = { kind: 'win', winner: other };
          else if (rules.solved(seat)) {
            if (seat === 0) lastChance = true; // the second player still gets their turn
            else ending = rules.solved(0) ? { kind: 'draw' } : { kind: 'win', winner: 1 };
          } else if (lastChance) ending = { kind: 'win', winner: 0 };

          if (ending) {
            await submit.modal.deferUpdate().catch(() => {});
            return void collector.stop('done');
          }
          turn = other;
          if (submit.modal.isFromMessage()) await submit.modal.update(card(view(true))).catch(() => {});
          else await edit(view(true));
        });
        collector.once('end', () => {
          if (!ending) ending = { kind: 'timeout', winner: (1 - turn) as Seat };
          resolve();
        });
      });

      const finalCard = view(false, ending!.kind === 'win');
      return { players, ending, final: (extra) => ({ ...finalCard, rows: extra }) };
    },
  };
}

/** Opens a one-field pop-up and waits for it. Null if it was closed or timed out. */
async function askText(btn: ButtonInteraction, modalId: string, title: string, input: TextInput & { required?: boolean }) {
  await btn
    .showModal(
      new ModalBuilder()
        .setCustomId(modalId)
        .setTitle(title)
        .addLabelComponents(
          new LabelBuilder()
            .setLabel(input.label)
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId('value')
                .setStyle(TextInputStyle.Short)
                .setMinLength(input.required === false ? 0 : input.min)
                .setMaxLength(input.max)
                .setPlaceholder(input.placeholder)
                .setRequired(input.required !== false),
            ),
        ),
    )
    .catch(() => {});
  const modal = await btn.awaitModalSubmit({ time: MODAL_SECONDS * 1000, filter: (m) => m.customId === modalId }).catch(() => null);
  return modal ? { modal, value: modal.fields.getTextInputValue('value') } : null;
}

interface Deps {
  store: ScoreStore;
}

function command(name: string, description: string, game: DuelGame) {
  return {
    command: new SlashCommandBuilder().setName(name).setDescription(description).setContexts(InteractionContextType.Guild).addUserOption(opponentOption(true)),
    handle: (interaction: ChatInputCommandInteraction, deps: Deps) => runDuel(interaction, game, deps.store),
  };
}

// ── Hangman duel ─────────────────────────────────────────────────────────────

const LIVES = 6;
/** Random secrets: single-word drawing prompts are concrete and workplace-safe. */
const HANGMAN_WORDS = WORDS.filter((w) => /^[a-z]{4,12}$/.test(w));

export function hangmanRules(): SecretRules {
  // secrets[s] is the word seat s set, so seat s solves secrets[1 - s].
  const secrets: [string, string] = ['', ''];
  const guessed = [new Set<string>(), new Set<string>()] as const;
  const wrong: [string[], string[]] = [[], []];
  const lives: [number, number] = [LIVES, LIVES];
  const target = (seat: Seat) => secrets[1 - seat]!;
  return {
    setupText: 'Each of you picks a **word or short phrase** for the other to guess (leave it empty for a random word). Then take turns: guess a letter or the whole thing. Six misses and you hang!',
    secretInput: { label: 'Word for your opponent (empty = random)', placeholder: 'e.g. lighthouse', min: 3, max: 24, required: false },
    guessInput: { label: 'A letter, or the whole answer', placeholder: 'e', min: 1, max: 24 },
    parseSecret(raw) {
      const v = raw.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!v) return { value: pick(HANGMAN_WORDS) };
      if (!/^[a-z][a-z '-]*[a-z]$/.test(v)) return { error: 'Use letters only (spaces, hyphens and apostrophes are fine between words).' };
      if (v.replace(/[^a-z]/g, '').length < 3) return { error: 'Make it at least three letters long.' };
      if (new Set(v.replace(/[^a-z]/g, '')).size < 2) return { error: 'Use at least two different letters.' };
      return { value: v };
    },
    setSecret: (seat, value) => void (secrets[seat] = value),
    guess(seat, raw) {
      const g = raw.trim().toLowerCase().replace(/\s+/g, ' ');
      const word = target(seat);
      const seen = guessed[seat];
      if (/^[a-z]$/.test(g)) {
        if (seen.has(g)) return { error: `You already tried **${g.toUpperCase()}**. Pick another letter (your turn isn't used up).` };
        seen.add(g);
        const hits = [...word].filter((c) => c === g).length;
        if (hits) return { note: `found **${hits} × ${g.toUpperCase()}**!` };
        wrong[seat].push(g);
        lives[seat]--;
        return { note: `tried **${g.toUpperCase()}**: not in it. ${lives[seat]} ${lives[seat] === 1 ? 'life' : 'lives'} left.` };
      }
      if (!/^[a-z][a-z '-]*$/.test(g) || g.length < 2) return { error: 'Type one letter, or your guess for the whole answer.' };
      if (g === word) {
        for (const c of word) seen.add(c);
        return { note: 'guessed the whole answer! 🎯' };
      }
      lives[seat]--;
      wrong[seat].push(g.length > 8 ? `${g.slice(0, 7)}…` : g);
      return { note: `guessed **${g.toUpperCase()}**: wrong! ${lives[seat]} ${lives[seat] === 1 ? 'life' : 'lives'} left.` };
    },
    solved: (seat) => isSolved(target(seat), guessed[seat]),
    failed: (seat) => lives[seat] <= 0,
    scene(turn, winner, reveal, celebrate) {
      const board = (seat: Seat): HangmanBoard => ({
        masked: maskWord(target(seat), guessed[seat]),
        wrong: wrong[seat],
        lives: lives[seat],
        maxLives: LIVES,
        solved: isSolved(target(seat), guessed[seat]),
        answer: reveal ? target(seat) : undefined,
      });
      return hangmanScene([board(0), board(1)], turn, winner, celebrate);
    },
  };
}

const HANGMAN = command(
  'hangman',
  'Challenge someone to a hangman duel: set a word for each other, first to crack it wins',
  secretDuel({ id: 'hangman', title: '🪢 Hangman duel', color: 0xff5470, create: hangmanRules }),
);
export const hangmanCommand = HANGMAN.command;
export const handleHangman = HANGMAN.handle;

// ── Number duel ──────────────────────────────────────────────────────────────

const MAX_NUMBER = 100;

export function numberRules(max = MAX_NUMBER): SecretRules {
  const secrets: [number, number] = [0, 0];
  const tracks: [NumberTrack & { guesses: number[] }, NumberTrack & { guesses: number[] }] = [
    { lo: 1, hi: max, guesses: [], solved: false },
    { lo: 1, hi: max, guesses: [], solved: false },
  ];
  return {
    setupText: `Each of you picks a secret number from **1 to ${max}** (leave it empty for a random one). Then take turns guessing the other's number. I'll say higher or lower.`,
    secretInput: { label: `Your number, 1–${max} (empty = random)`, placeholder: String(rand(1, max)), min: 1, max: String(max).length, required: false },
    guessInput: { label: `Your guess (1–${max})`, placeholder: '50', min: 1, max: String(max).length },
    parseSecret(raw) {
      const v = raw.trim();
      if (!v) return { value: String(rand(1, max)) };
      const n = Number(v);
      if (!/^\d+$/.test(v) || n < 1 || n > max) return { error: `Pick a whole number from 1 to ${max}.` };
      return { value: String(n) };
    },
    setSecret: (seat, value) => void (secrets[seat] = Number(value)),
    guess(seat, raw) {
      const v = raw.trim();
      const n = Number(v);
      if (!/^\d+$/.test(v) || n < 1 || n > max) return { error: `Guess a whole number from 1 to ${max}.` };
      const secret = secrets[1 - seat]!;
      const t = tracks[seat];
      t.guesses.push(n);
      if (n === secret) {
        t.solved = true;
        t.lo = t.hi = n;
        return { note: `guessed **${n}**: that's it! 🎯` };
      }
      if (n < secret) t.lo = Math.max(t.lo, n + 1);
      else t.hi = Math.min(t.hi, n - 1);
      return { note: `guessed **${n}**: ${n < secret ? 'higher ⬆️' : 'lower ⬇️'}` };
    },
    solved: (seat) => tracks[seat].solved,
    failed: () => false,
    scene(turn, winner, reveal, celebrate) {
      const show = (seat: Seat): NumberTrack => ({ ...tracks[seat], secret: reveal ? secrets[1 - seat] : undefined });
      return numberScene([show(0), show(1)], max, turn, winner, celebrate);
    },
  };
}

const NUMBER = command(
  'numberduel',
  'Challenge someone to a number duel: hide a number, find theirs in fewer guesses',
  secretDuel({ id: 'numberduel', title: '🔢 Number duel', color: 0x4c6fff, create: () => numberRules() }),
);
export const numberDuelCommand = NUMBER.command;
export const handleNumberDuel = NUMBER.handle;
