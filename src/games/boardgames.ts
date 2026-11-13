import { ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { fourInARowScene, ticTacToeScene } from '../render/boards.js';
import { dotsScene, gomokuScene, higherLowerScene, mancalaScene, nimScene, ROW_LETTERS } from '../render/duels.js';
import type { ScoreStore } from '../store.js';
import { ROW } from '../ui/card.js';
import { rand, shuffle } from '../util/random.js';
import { opponentOption, runDuel, turnBased, type DuelGame, type Ending, type TurnGame } from './duel.js';
import {
  boxSides,
  callHolds,
  dropPiece,
  drawSide,
  fullDeck,
  isFull,
  MANCALA_STORE,
  newDots,
  newMancala,
  rankLabel,
  sideLine,
  SIDES,
  sow,
  winningLine,
  type Cell,
  type PlayingCard,
  type Side,
  type Sown,
} from './logic.js';

interface Deps {
  store: ScoreStore;
}

// ── Tic-tac-toe ──────────────────────────────────────────────────────────────

export const tictactoeCommand = new SlashCommandBuilder()
  .setName('tictactoe')
  .setDescription('Challenge someone to tic-tac-toe')
  .setContexts(InteractionContextType.Guild)
  .addUserOption(opponentOption(true));

export function ticTacToe(): TurnGame {
  const board: Cell[] = Array(9).fill(0);
  let last = -1;
  const win = () => winningLine(board, 3, 3, 3);
  return {
    marks: ['❌', '⭕'],
    move(action, seat) {
      const i = Number(action);
      if (!Number.isInteger(i) || i < 0 || i > 8 || board[i] !== 0) return false;
      board[i] = (seat + 1) as Cell;
      last = i;
      return true;
    },
    result(lastMover) {
      if (win().length) return { kind: 'win', winner: lastMover };
      return isFull(board) ? { kind: 'draw' } : null;
    },
    scene: () => ticTacToeScene(board, last, win()),
    buttons(id, disabled) {
      const line = win();
      // A keypad mirroring the board image.
      return [0, 1, 2].map((r) =>
        ROW().addComponents(
          [0, 1, 2].map((c) => {
            const i = r * 3 + c;
            const b = new ButtonBuilder().setCustomId(`${id}:${i}`).setDisabled(disabled || board[i] !== 0);
            if (board[i] === 0) return b.setLabel(String(i + 1)).setStyle(ButtonStyle.Secondary);
            return b
              .setEmoji(board[i] === 1 ? '❌' : '⭕')
              .setStyle(line.includes(i) ? ButtonStyle.Success : board[i] === 1 ? ButtonStyle.Danger : ButtonStyle.Primary);
          }),
        ),
      );
    },
  };
}

const TIC_TAC_TOE = turnBased({ id: 'tictactoe', title: '❌⭕ Tic-tac-toe', color: 0x2ee6c5, create: ticTacToe });

export async function handleTicTacToe(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  await runDuel(interaction, TIC_TAC_TOE, deps.store);
}

// ── Four in a row ────────────────────────────────────────────────────────────

const C4_W = 7;
const C4_H = 6;

export const fourInARowCommand = new SlashCommandBuilder()
  .setName('fourinarow')
  .setDescription('Challenge someone to four in a row: drop discs, connect four to win')
  .setContexts(InteractionContextType.Guild)
  .addUserOption(opponentOption(true));

export function fourInARow(): TurnGame {
  const board: Cell[] = Array(C4_W * C4_H).fill(0);
  let last = -1;
  const win = () => winningLine(board, C4_W, C4_H, 4);
  return {
    marks: ['🔴', '🟡'],
    move(action, seat) {
      const col = Number(action);
      if (!Number.isInteger(col)) return false;
      const i = dropPiece(board, C4_W, C4_H, col, (seat + 1) as 1 | 2);
      if (i === -1) return false;
      last = i;
      return true;
    },
    result(lastMover) {
      if (win().length) return { kind: 'win', winner: lastMover };
      return isFull(board) ? { kind: 'draw' } : null;
    },
    scene: () => fourInARowScene(board, C4_W, C4_H, last, win()),
    buttons(id, disabled) {
      const lastCol = last === -1 ? -1 : last % C4_W;
      const col = (x: number) =>
        new ButtonBuilder()
          .setCustomId(`${id}:${x}`)
          .setLabel(`${x + 1}`)
          .setEmoji('⬇️')
          .setStyle(x === lastCol ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(disabled || board[x] !== 0);
      return [ROW().addComponents([0, 1, 2, 3].map(col)), ROW().addComponents([4, 5, 6].map(col))];
    },
  };
}

const FOUR_IN_A_ROW = turnBased({ id: 'fourinarow', title: '🔴🟡 Four in a row', color: 0x4c6fff, create: fourInARow });

export async function handleFourInARow(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  await runDuel(interaction, FOUR_IN_A_ROW, deps.store);
}

// ── Shared ───────────────────────────────────────────────────────────────────

/** Red and teal, matching the seat colours in the board images. */
const SEAT_MARKS: [string, string] = ['🔴', '🟢'];

/** Builds the slash command and handler for a simple challenge-someone duel. */
function duelCommand(name: string, description: string, game: DuelGame) {
  return {
    command: new SlashCommandBuilder().setName(name).setDescription(description).setContexts(InteractionContextType.Guild).addUserOption(opponentOption(true)),
    handle: (interaction: ChatInputCommandInteraction, deps: Deps) => runDuel(interaction, game, deps.store),
  };
}

const byScore = (a: number, b: number): Ending => (a === b ? { kind: 'draw' } : { kind: 'win', winner: a > b ? 0 : 1 });

// ── Dots and boxes ───────────────────────────────────────────────────────────

const DOTS_SIZE = 3;
const SIDE_BUTTON: Record<Side, { emoji: string; label: string }> = {
  top: { emoji: '⬆️', label: 'Top' },
  bottom: { emoji: '⬇️', label: 'Bottom' },
  left: { emoji: '⬅️', label: 'Left' },
  right: { emoji: '➡️', label: 'Right' },
};

export function dotsAndBoxes(size = DOTS_SIZE): TurnGame {
  const d = newDots(size, size);
  let selected = -1;
  let last: { box: number; side: Side } | null = null;
  const count = (who: Cell) => d.boxes.filter((b) => b === who).length;
  const sideFree = (box: number, side: Side) => {
    const { lines, i } = sideLine(d, box, side);
    return lines[i] === 0;
  };
  return {
    marks: ['❌', '⭕'],
    hint: 'Pick a box, then a side · close a box to score and go again',
    status: () => `Boxes: ❌ **${count(1)}** – **${count(2)}** ⭕`,
    move(action, seat) {
      if (action.startsWith('b')) {
        const box = Number(action.slice(1));
        if (!Number.isInteger(box) || box < 0 || box >= size * size || boxSides(d, box) === 4) return false;
        selected = box;
        return 'select';
      }
      const side = action.slice(2) as Side;
      if (!action.startsWith('s:') || !SIDES.includes(side) || selected === -1) return false;
      const closed = drawSide(d, selected, side, (seat + 1) as 1 | 2);
      if (closed === -1) return false;
      last = { box: selected, side };
      selected = -1;
      return closed > 0 ? 'again' : true;
    },
    result: () => (d.boxes.every((b) => b !== 0) ? byScore(count(1), count(2)) : null),
    scene: () => dotsScene(d, last, selected),
    buttons(id, disabled) {
      const rows = Array.from({ length: size }, (_, r) =>
        ROW().addComponents(
          Array.from({ length: size }, (_, c) => {
            const box = r * size + c;
            const b = new ButtonBuilder().setCustomId(`${id}:b${box}`);
            if (d.boxes[box]) return b.setEmoji(d.boxes[box] === 1 ? '❌' : '⭕').setStyle(d.boxes[box] === 1 ? ButtonStyle.Danger : ButtonStyle.Success).setDisabled(true);
            return b
              .setLabel(String(box + 1))
              .setStyle(box === selected ? ButtonStyle.Primary : ButtonStyle.Secondary)
              .setDisabled(disabled || boxSides(d, box) === 4);
          }),
        ),
      );
      rows.push(
        ROW().addComponents(
          SIDES.map((side) =>
            new ButtonBuilder()
              .setCustomId(`${id}:s:${side}`)
              .setEmoji(SIDE_BUTTON[side].emoji)
              .setLabel(SIDE_BUTTON[side].label)
              .setStyle(ButtonStyle.Primary)
              .setDisabled(disabled || selected === -1 || !sideFree(selected, side)),
          ),
        ),
      );
      return rows;
    },
  };
}

const DOTS = duelCommand(
  'dotsandboxes',
  'Challenge someone to dots and boxes: draw lines, close boxes, score the most',
  turnBased({ id: 'dotsandboxes', title: '🔳 Dots and boxes', color: 0xff8a3d, create: () => dotsAndBoxes() }),
);
export const dotsCommand = DOTS.command;
export const handleDots = DOTS.handle;

// ── Matchsticks (misère Nim) ─────────────────────────────────────────────────

export function matchsticks(total = rand(15, 23)): TurnGame {
  let left = total;
  let lastTaken = 0;
  let lastSeat = 0;
  return {
    marks: SEAT_MARKS,
    hint: 'Take 1, 2 or 3 sticks · whoever takes the last stick loses',
    status: () => (lastTaken ? `${SEAT_MARKS[lastSeat]} took **${lastTaken}**. **${left}** left.` : `**${left}** sticks on the table.`),
    move(action, seat) {
      const n = Number(action);
      if (![1, 2, 3].includes(n) || n > left) return false;
      left -= n;
      lastTaken = n;
      lastSeat = seat;
      return true;
    },
    result: (lastMover) => (left === 0 ? { kind: 'win', winner: (1 - lastMover) as 0 | 1 } : null),
    scene: () => nimScene(total, left, lastTaken, lastSeat),
    buttons: (id, disabled) => [
      ROW().addComponents(
        [1, 2, 3].map((n) =>
          new ButtonBuilder()
            .setCustomId(`${id}:${n}`)
            .setLabel(`Take ${n}`)
            .setEmoji('🪵')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled || n > left),
        ),
      ),
    ],
  };
}

const NIM = duelCommand(
  'matchsticks',
  "Challenge someone to matchsticks: take 1–3 sticks, don't take the last one",
  turnBased({ id: 'matchsticks', title: '🪵 Matchsticks', color: 0xd69a4a, create: () => matchsticks() }),
);
export const nimCommand = NIM.command;
export const handleNim = NIM.handle;

// ── Five in a row ────────────────────────────────────────────────────────────

const GOMOKU_SIZE = 9;

export function fiveInARow(size = GOMOKU_SIZE): TurnGame {
  const board: Cell[] = Array(size * size).fill(0);
  let row = -1;
  let last = -1;
  const win = () => winningLine(board, size, size, 5);
  const rowFull = (r: number) => board.slice(r * size, r * size + size).every((c) => c !== 0);
  const keys = (n: number) => Array.from({ length: n }, (_, i) => i);
  return {
    marks: SEAT_MARKS,
    hint: 'Pick a row letter, then a column number',
    move(action, seat) {
      const [kind, raw] = action.split(':');
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n >= size) return false;
      if (kind === 'r') {
        if (rowFull(n)) return false;
        row = n;
        return 'select';
      }
      if (kind !== 'c' || row === -1) return false;
      const i = row * size + n;
      if (board[i] !== 0) return false;
      board[i] = (seat + 1) as Cell;
      last = i;
      row = -1;
      return true;
    },
    result(lastMover) {
      if (win().length) return { kind: 'win', winner: lastMover };
      return isFull(board) ? { kind: 'draw' } : null;
    },
    status: () => (last === -1 ? '' : `Last stone: **${ROW_LETTERS[Math.floor(last / size)]}${(last % size) + 1}**`),
    scene: () => gomokuScene(board, size, last, win(), row),
    buttons(id, disabled) {
      const split = (items: ButtonBuilder[]) => [ROW().addComponents(items.slice(0, 5)), ROW().addComponents(items.slice(5))];
      const rowButtons = keys(size).map((r) =>
        new ButtonBuilder()
          .setCustomId(`${id}:r:${r}`)
          .setLabel(ROW_LETTERS[r]!)
          .setStyle(r === row ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(disabled || rowFull(r)),
      );
      const colButtons = keys(size).map((c) =>
        new ButtonBuilder()
          .setCustomId(`${id}:c:${c}`)
          .setLabel(String(c + 1))
          .setStyle(ButtonStyle.Success)
          .setDisabled(disabled || row === -1 || board[row * size + c] !== 0),
      );
      return [...split(rowButtons), ...split(colButtons)];
    },
  };
}

const GOMOKU = duelCommand(
  'fiveinarow',
  'Challenge someone to five in a row on a 9×9 board',
  turnBased({ id: 'fiveinarow', title: '⚫ Five in a row', color: 0xf5b53a, create: () => fiveInARow() }),
);
export const gomokuCommand = GOMOKU.command;
export const handleGomoku = GOMOKU.handle;

// ── Mancala ──────────────────────────────────────────────────────────────────

export function mancala(): TurnGame & { pits: number[] } {
  const pits = newMancala();
  let lastMove: (Sown & { seat: number }) | null = null;
  const store = (s: 0 | 1) => pits[MANCALA_STORE[s]]!;
  return {
    pits,
    marks: SEAT_MARKS,
    hint: 'Last seed in your store: go again · in an empty pit of yours: capture the pit opposite',
    status() {
      const score = `Store: 🔴 **${store(0)}** – **${store(1)}** 🟢`;
      if (!lastMove) return score;
      const note = lastMove.over ? '' : lastMove.extra ? ' Free turn!' : lastMove.captured ? ` Captured **${lastMove.captured}**!` : '';
      return `${score}${note ? ` · ${SEAT_MARKS[lastMove.seat]}${note}` : ''}`;
    },
    move(action, seat) {
      const sown = sow(pits, seat, Number(action));
      if (!sown) return false;
      lastMove = { ...sown, seat };
      return sown.extra ? 'again' : true;
    },
    result: () => (lastMove?.over ? byScore(store(0), store(1)) : null),
    scene() {
      const over = Boolean(lastMove?.over);
      return mancalaScene(pits, lastMove?.path ?? [], over ? (store(0) === store(1) ? -1 : store(0) > store(1) ? 0 : 1) : -1);
    },
    buttons(id, disabled, turn) {
      const pit = (p: number) => {
        const n = pits[turn * 7 + p]!;
        return new ButtonBuilder()
          .setCustomId(`${id}:${p}`)
          .setLabel(`${p + 1} · ${n}`)
          .setEmoji(SEAT_MARKS[turn]!)
          .setStyle(turn === 0 ? ButtonStyle.Danger : ButtonStyle.Success)
          .setDisabled(disabled || n === 0);
      };
      return [ROW().addComponents([0, 1, 2].map(pit)), ROW().addComponents([3, 4, 5].map(pit))];
    },
  };
}

const MANCALA = duelCommand(
  'mancala',
  'Challenge someone to mancala: sow seeds, capture, fill your store',
  turnBased({ id: 'mancala', title: '🫘 Mancala', color: 0xb46cff, create: mancala }),
);
export const mancalaCommand = MANCALA.command;
export const handleMancala = MANCALA.handle;

// ── Higher or lower ──────────────────────────────────────────────────────────

const cardText = (c: PlayingCard) => `**${rankLabel(c.rank)}**${{ spades: '♠️', hearts: '♥️', diamonds: '♦️', clubs: '♣️' }[c.suit]}`;

export function higherLower(deck: PlayingCard[] = shuffle(fullDeck())): TurnGame & { run: PlayingCard[] } {
  const run: PlayingCard[] = [deck.pop()!];
  let bust = false;
  let lastCall: { seat: number; call: string; from: PlayingCard; to: PlayingCard } | null = null;
  return {
    run,
    marks: SEAT_MARKS,
    hint: 'Call the next card · the same rank is safe · one wrong call loses',
    status() {
      if (!lastCall) return `First card: ${cardText(run[0]!)}`;
      const { seat, call, from, to } = lastCall;
      return `${SEAT_MARKS[seat]} called **${call}**: ${cardText(from)} → ${cardText(to)} ${bust ? '❌' : '✅'}`;
    },
    move(action, seat) {
      if (action !== 'higher' && action !== 'lower') return false;
      const from = run.at(-1)!;
      const to = deck.pop();
      if (!to) return false;
      run.push(to);
      bust = !callHolds(action, from, to);
      lastCall = { seat, call: action, from, to };
      return true;
    },
    result(lastMover) {
      if (bust) return { kind: 'win', winner: (1 - lastMover) as 0 | 1 };
      return deck.length === 0 ? { kind: 'draw' } : null;
    },
    scene: () => (bust ? higherLowerScene(run, false, deck.length, 'bust') : higherLowerScene(run, true, deck.length, null)),
    buttons: (id, disabled) => [
      ROW().addComponents(
        new ButtonBuilder().setCustomId(`${id}:higher`).setLabel('Higher').setEmoji('⬆️').setStyle(ButtonStyle.Success).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`${id}:lower`).setLabel('Lower').setEmoji('⬇️').setStyle(ButtonStyle.Danger).setDisabled(disabled),
      ),
    ],
  };
}

const HIGHER_LOWER = duelCommand(
  'higherlower',
  'Challenge someone to higher or lower: take turns calling the next card',
  turnBased({ id: 'higherlower', title: '🃏 Higher or lower', color: 0x3ecf6e, create: () => higherLower() }),
);
export const higherLowerCommand = HIGHER_LOWER.command;
export const handleHigherLower = HIGHER_LOWER.handle;
