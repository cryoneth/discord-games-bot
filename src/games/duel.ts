import {
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type ActionRowBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
  type SlashCommandUserOption,
} from 'discord.js';
import type { Scene } from '../render/boards.js';
import type { GameId, ScoreStore } from '../store.js';
import { card, nonce, ROW, sceneImage, type Card } from '../ui/card.js';

/** Users currently in (or invited to) a duel. One at a time keeps things simple and spam-free. */
const busy = new Set<string>();

const CHALLENGE_SECONDS = 60;
const REMATCH_SECONDS = 60;
export const TURN_SECONDS = 120;
const WIN_POINTS = 50;
const DRAW_POINTS = 15;
const GREY = 0x4e5058;

export const opponentOption = (required: boolean) => (o: SlashCommandUserOption) =>
  o.setName('opponent').setDescription(required ? 'Who you want to play against' : 'Who to play against (leave empty to play the bot)').setRequired(required);

export type Seat = 0 | 1;
export type Ending = { kind: 'win' | 'forfeit' | 'timeout'; winner: Seat } | { kind: 'draw' } | null;

export interface Played {
  /** Seats used for scoring: players[seat] is a user ID. */
  players: [string, string];
  ending: Ending;
  /** The final card; `extraRows` (e.g. the rematch button) are appended. */
  final: (extraRows: ActionRowBuilder<ButtonBuilder>[]) => Card;
}

export interface DuelGame {
  id: GameId;
  title: string;
  color: number;
  /** Plays one game on `message` (already showing a placeholder card). Must acknowledge any button it consumes. */
  play(message: Message, players: [string, string]): Promise<Played | null>;
}

/** Slash-command entry point: challenge → play → offer rematches until declined. */
export async function runDuel(interaction: ChatInputCommandInteraction, game: DuelGame, store: ScoreStore): Promise<void> {
  const challenger = interaction.user;
  const opponent = interaction.options.getUser('opponent', true);
  const fail = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  if (opponent.bot) return void (await fail("Bots can't accept challenges. Pick a person!"));
  if (opponent.id === challenger.id) return void (await fail('You need someone else to play against.'));
  if (busy.has(challenger.id)) return void (await fail("You're already in a game. Finish it first."));
  if (busy.has(opponent.id)) return void (await fail(`<@${opponent.id}> is already in a game.`));

  const players: [string, string] = [challenger.id, opponent.id];
  players.forEach((id) => busy.add(id));
  const release = () => players.forEach((id) => busy.delete(id));

  let message: Message;
  try {
    const accepted = await challenge(interaction, game, players);
    if (!accepted) return release();
    message = accepted;
  } catch (err) {
    release();
    throw err;
  }

  // Each loop iteration is one game; a rematch posts a fresh message.
  for (;;) {
    let played: Played | null;
    try {
      played = await game.play(message, players);
    } finally {
      release();
    }
    if (!played) return;
    recordDuel(store, interaction.guildId, game.id, played.players, played.ending);

    const next = await offerRematch(message, played, players);
    if (!next) return;
    if (players.some((id) => busy.has(id))) {
      await next.reply({ content: 'One of you already started another game.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    players.forEach((id) => busy.add(id));
    try {
      const reply = await next.reply({ ...card({ color: game.color, title: game.title, body: 'Rematch! Setting up the board…' }), withResponse: true });
      if (!reply.resource?.message) throw new Error('Rematch message missing');
      message = reply.resource.message;
    } catch (err) {
      release();
      throw err;
    }
  }
}

async function challenge(interaction: ChatInputCommandInteraction, game: DuelGame, [challengerId, opponentId]: [string, string]): Promise<Message | null> {
  const id = `duel:${nonce()}`;
  const expires = Math.floor(Date.now() / 1000) + CHALLENGE_SECONDS;
  const reply = await interaction.reply({
    ...card({
      color: game.color,
      title: game.title,
      body: `<@${challengerId}> challenged <@${opponentId}>!\nThe challenge expires <t:${expires}:R>.`,
      rows: [
        ROW().addComponents(
          new ButtonBuilder().setCustomId(`${id}:accept`).setLabel('Accept').setEmoji('⚔️').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${id}:decline`).setLabel('Decline').setStyle(ButtonStyle.Secondary),
        ),
      ],
    }),
    withResponse: true,
  });
  const message = reply.resource?.message;
  if (!message) throw new Error('Challenge message missing from interaction response');

  let acceptBtn: ButtonInteraction | null = null;
  const outcome = await new Promise<'accept' | 'decline' | 'cancel' | 'timeout'>((resolve) => {
    const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: CHALLENGE_SECONDS * 1000 });
    collector.on('collect', async (btn) => {
      if (!btn.customId.startsWith(`${id}:`)) return;
      const action = btn.customId.slice(id.length + 1);
      if (btn.user.id === opponentId) {
        if (action === 'accept') acceptBtn = btn;
        else await btn.deferUpdate().catch(() => {});
        resolve(action === 'accept' ? 'accept' : 'decline');
        collector.stop();
      } else if (btn.user.id === challengerId && action === 'decline') {
        await btn.deferUpdate().catch(() => {});
        resolve('cancel');
        collector.stop();
      } else {
        await btn.reply({ content: "This challenge isn't for you.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    });
    collector.once('end', () => resolve('timeout'));
  });

  if (outcome === 'accept' && acceptBtn) {
    // Acknowledge instantly so the click feels responsive; the game renders next.
    await (acceptBtn as ButtonInteraction).update(card({ color: game.color, title: game.title, body: 'Challenge accepted! Setting up the board…' })).catch(() => {});
    return message;
  }
  const text = {
    accept: '',
    decline: `<@${opponentId}> declined the challenge.`,
    cancel: `<@${challengerId}> withdrew the challenge.`,
    timeout: `<@${opponentId}> didn't respond in time.`,
  }[outcome];
  await message.edit(card({ color: GREY, title: game.title, body: text })).catch(() => {});
  return null;
}

/** Shows the final card with a Rematch button. Resolves with the second click if both players want another game. */
async function offerRematch(message: Message, played: Played, [a, b]: [string, string]): Promise<ButtonInteraction | null> {
  const id = `rematch:${nonce()}`;
  const wants = new Set<string>();
  const row = (disabled: boolean) =>
    ROW().addComponents(
      new ButtonBuilder()
        .setCustomId(id)
        .setLabel(wants.size ? `Rematch (${wants.size}/2)` : 'Rematch')
        .setEmoji('🔁')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
    );
  await message.edit(card(played.final([row(false)]))).catch(() => {});

  return new Promise((resolve) => {
    const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: REMATCH_SECONDS * 1000 });
    let done: ButtonInteraction | null = null;
    collector.on('collect', async (btn) => {
      if (btn.customId !== id) return;
      if (btn.user.id !== a && btn.user.id !== b) {
        await btn.reply({ content: 'Only the two players can start a rematch.', flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      wants.add(btn.user.id);
      if (wants.size === 2) {
        done = btn;
        collector.stop('rematch');
        return;
      }
      // The final image was rendered once already; this only re-sends it with the updated button.
      await btn.update(card(played.final([row(false)]))).catch(() => {});
    });
    collector.once('end', async () => {
      await message.edit(card(played.final([]))).catch(() => {});
      resolve(done);
    });
  });
}

// ── Turn-based board games ───────────────────────────────────────────────────

export interface TurnGame {
  /** Emoji used for each seat in text. */
  marks: [string, string];
  /** Applies a move from a button `action` for `seat`. Returns false if it's not legal. */
  move(action: string, seat: Seat): boolean;
  /** Checked after each legal move. */
  result(lastMover: Seat): Ending;
  /** The board image. */
  scene(): Scene;
  /** Move buttons. `id` prefixes every custom ID. */
  buttons(id: string, disabled: boolean): ActionRowBuilder<ButtonBuilder>[];
}

export function statusLine(players: [string, string], turn: Seat, ending: Ending, marks: [string, string]): string {
  if (!ending) return `${marks[turn]} **<@${players[turn]}>'s turn**`;
  if (ending.kind === 'draw') return "🤝 **It's a draw!**";
  const w = `${marks[ending.winner]} **<@${players[ending.winner]}> wins!**`;
  if (ending.kind === 'forfeit') return `🏳️ <@${players[1 - ending.winner]}> forfeited. ${w}`;
  if (ending.kind === 'timeout') return `⏰ <@${players[1 - ending.winner]}> ran out of time. ${w}`;
  return `🏆 ${w}`;
}

/** Wraps a TurnGame factory as a DuelGame: alternating turns, forfeit button, idle timeout. */
export function turnBased(def: { id: GameId; title: string; color: number; create: () => TurnGame }): DuelGame {
  return {
    ...def,
    async play(message, invited) {
      const game = def.create();
      // Randomize who goes first; seat 0 always moves first.
      const players: [string, string] = Math.random() < 0.5 ? [invited[0], invited[1]] : [invited[1], invited[0]];
      const id = `${def.id}:${nonce()}`;
      let turn: Seat = 0;
      let ending: Ending = null;
      let moves = 0;

      const view = (rows: ActionRowBuilder<ButtonBuilder>[], celebrate = false): Card => ({
        color: ending && ending.kind !== 'draw' ? 0xfee75c : def.color,
        title: def.title,
        body: `${game.marks[0]} <@${players[0]}>  vs  ${game.marks[1]} <@${players[1]}>\n${statusLine(players, turn, ending, game.marks)}`,
        image: sceneImage(game.scene(), `board-${moves}`, `${def.title} board`, celebrate),
        footer: ending ? undefined : `Move ${moves + 1} · moves time out after ${TURN_SECONDS / 60} min of inactivity`,
        rows,
      });
      const live = () => view([...game.buttons(id, false), ROW().addComponents(forfeitButton(id))]);

      await message.edit(card(live()));

      await new Promise<void>((resolve) => {
        const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, idle: TURN_SECONDS * 1000, time: 30 * 60 * 1000 });
        collector.on('collect', async (btn) => {
          if (!btn.customId.startsWith(`${id}:`) || ending) return;
          const action = btn.customId.slice(id.length + 1);
          const seat = players.indexOf(btn.user.id) as Seat | -1;
          if (seat === -1) {
            await btn.reply({ content: "You're not playing in this game.", flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
          }
          if (action === 'forfeit') {
            ending = { kind: 'forfeit', winner: (1 - seat) as Seat };
            await btn.deferUpdate().catch(() => {});
            return collector.stop('done');
          }
          if (seat !== turn) {
            await btn.reply({ content: `It's <@${players[turn]}>'s turn.`, flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
          }
          if (!game.move(action, turn)) {
            await btn.reply({ content: "You can't move there.", flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
          }
          moves++;
          ending = game.result(turn);
          if (ending) {
            await btn.deferUpdate().catch(() => {});
            return collector.stop('done');
          }
          turn = (1 - turn) as Seat;
          await btn.update(card(live())).catch(() => {});
        });
        collector.once('end', () => {
          if (!ending) ending = { kind: 'timeout', winner: (1 - turn) as Seat };
          resolve();
        });
      });

      // Render the (possibly animated) final board once and reuse it for rematch-button updates.
      const finalCard = view([], ending!.kind === 'win');
      return { players, ending, final: (extra) => ({ ...finalCard, rows: [...game.buttons(id, true), ...extra] }) };
    },
  };
}

function forfeitButton(id: string): ButtonBuilder {
  return new ButtonBuilder().setCustomId(`${id}:forfeit`).setLabel('Forfeit').setEmoji('🏳️').setStyle(ButtonStyle.Secondary);
}

export function recordDuel(store: ScoreStore, guildId: string | null, gameId: GameId, players: [string, string], ending: Ending): void {
  if (!ending) return;
  store.record(
    guildId,
    gameId,
    players.map((userId, seat) => {
      if (ending.kind === 'draw') return { userId, points: DRAW_POINTS, won: false };
      const won = ending.winner === seat;
      return { userId, points: won ? WIN_POINTS : 0, won };
    }),
  );
}
