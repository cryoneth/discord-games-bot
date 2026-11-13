import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  InteractionContextType,
  SlashCommandBuilder,
} from 'discord.js';
import type { ScoreStore } from '../store.js';
import { forfeitButton, openChallenge, opponentOption, playTurns, statusLine, type TurnGame } from './duel.js';
import { dropPiece, isFull, lineWinner, type Cell } from './logic.js';

interface Deps {
  store: ScoreStore;
}

// ── Tic-tac-toe ──────────────────────────────────────────────────────────────

const TTT_COLOR = 0x3ba55c;
const TTT_MARKS: [string, string] = ['❌', '⭕'];

export const tictactoeCommand = new SlashCommandBuilder()
  .setName('tictactoe')
  .setDescription('Challenge someone to tic-tac-toe')
  .setContexts(InteractionContextType.Guild)
  .addUserOption(opponentOption(true));

export function ticTacToe(): TurnGame {
  const board: Cell[] = Array(9).fill(0);
  return {
    move(action, seat) {
      const i = Number(action);
      if (!Number.isInteger(i) || i < 0 || i > 8 || board[i] !== 0) return false;
      board[i] = (seat + 1) as Cell;
      return true;
    },
    result(lastMover) {
      if (lineWinner(board, 3, 3, 3)) return { kind: 'win', winner: lastMover };
      return isFull(board) ? { kind: 'draw' } : null;
    },
    view(id, players, turn, ending) {
      const rows = [0, 1, 2].map((r) =>
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          [0, 1, 2].map((c) => {
            const i = r * 3 + c;
            const b = new ButtonBuilder().setCustomId(`${id}:${i}`).setDisabled(Boolean(ending) || board[i] !== 0);
            if (board[i] === 0) return b.setLabel('​').setStyle(ButtonStyle.Secondary);
            return b.setEmoji(TTT_MARKS[board[i]! - 1]!).setStyle(board[i] === 1 ? ButtonStyle.Primary : ButtonStyle.Danger);
          }),
        ),
      );
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(forfeitButton(id, Boolean(ending))));
      return {
        embeds: [
          new EmbedBuilder()
            .setColor(TTT_COLOR)
            .setTitle('❌⭕ Tic-tac-toe')
            .setDescription(`${TTT_MARKS[0]} <@${players[0]}> vs ${TTT_MARKS[1]} <@${players[1]}>\n\n${statusLine(players, turn, ending, TTT_MARKS)}`),
        ],
        components: rows,
      };
    },
  };
}

export async function handleTicTacToe(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const duel = await openChallenge(interaction, '❌⭕ Tic-tac-toe challenge', TTT_COLOR);
  if (!duel) return;
  try {
    await playTurns(duel, ticTacToe(), 'tictactoe', deps.store, interaction.guildId);
  } finally {
    duel.release();
  }
}

// ── Four in a row ────────────────────────────────────────────────────────────

const C4_COLOR = 0xfaa61a;
const C4_W = 7;
const C4_H = 6;
const C4_MARKS: [string, string] = ['🔴', '🟡'];
const C4_NUMBERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];

export const fourInARowCommand = new SlashCommandBuilder()
  .setName('fourinarow')
  .setDescription('Challenge someone to four in a row: drop discs, connect four to win')
  .setContexts(InteractionContextType.Guild)
  .addUserOption(opponentOption(true));

export function fourInARow(): TurnGame {
  const board: Cell[] = Array(C4_W * C4_H).fill(0);
  let last = -1;
  return {
    move(action, seat) {
      const col = Number(action);
      if (!Number.isInteger(col)) return false;
      const i = dropPiece(board, C4_W, C4_H, col, (seat + 1) as 1 | 2);
      if (i === -1) return false;
      last = i;
      return true;
    },
    result(lastMover) {
      if (lineWinner(board, C4_W, C4_H, 4)) return { kind: 'win', winner: lastMover };
      return isFull(board) ? { kind: 'draw' } : null;
    },
    view(id, players, turn, ending) {
      const grid: string[] = [];
      for (let y = 0; y < C4_H; y++) {
        let row = '';
        for (let x = 0; x < C4_W; x++) {
          const c = board[y * C4_W + x]!;
          row += c === 0 ? '⚫' : C4_MARKS[c - 1];
        }
        grid.push(row);
      }
      grid.push(C4_NUMBERS.join(''));
      const lastCol = last === -1 ? -1 : last % C4_W;
      const colButton = (x: number) =>
        new ButtonBuilder()
          .setCustomId(`${id}:${x}`)
          .setLabel(String(x + 1))
          .setStyle(x === lastCol ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(Boolean(ending) || board[x] !== 0);
      return {
        embeds: [
          new EmbedBuilder()
            .setColor(C4_COLOR)
            .setTitle('🔴🟡 Four in a row')
            .setDescription(
              `${C4_MARKS[0]} <@${players[0]}> vs ${C4_MARKS[1]} <@${players[1]}>\n\n${grid.join('\n')}\n\n${statusLine(players, turn, ending, C4_MARKS)}`,
            ),
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents([0, 1, 2, 3].map(colButton)),
          new ActionRowBuilder<ButtonBuilder>().addComponents(...[4, 5, 6].map(colButton), forfeitButton(id, Boolean(ending))),
        ],
      };
    },
  };
}

export async function handleFourInARow(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const duel = await openChallenge(interaction, '🔴🟡 Four in a row challenge', C4_COLOR);
  if (!duel) return;
  try {
    await playTurns(duel, fourInARow(), 'fourinarow', deps.store, interaction.guildId);
  } finally {
    duel.release();
  }
}
