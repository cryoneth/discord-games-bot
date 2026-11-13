import { ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { fourInARowScene, ticTacToeScene } from '../render/boards.js';
import type { ScoreStore } from '../store.js';
import { ROW } from '../ui/card.js';
import { opponentOption, runDuel, turnBased, type TurnGame } from './duel.js';
import { dropPiece, isFull, winningLine, type Cell } from './logic.js';

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
