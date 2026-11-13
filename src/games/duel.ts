import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  type BaseMessageOptions,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
  type SlashCommandUserOption,
} from 'discord.js';
import type { GameId, ScoreStore } from '../store.js';

/** Users currently in (or invited to) a duel. One at a time keeps things simple and spam-free. */
const busy = new Set<string>();

const CHALLENGE_SECONDS = 60;
const TURN_SECONDS = 120;
const WIN_POINTS = 50;
const DRAW_POINTS = 15;

export const opponentOption = (required: boolean) => (o: SlashCommandUserOption) =>
  o.setName('opponent').setDescription(required ? 'Who you want to play against' : 'Who to play against (leave empty to play the bot)').setRequired(required);

export interface Duel {
  /** [challenger, opponent] user IDs. */
  players: [string, string];
  message: Message;
  release: () => void;
}

/**
 * Posts a challenge and waits for the opponent to accept. Returns null (after
 * telling the users why) if the duel doesn't happen. Callers must call
 * `release()` when the game ends.
 */
export async function openChallenge(interaction: ChatInputCommandInteraction, title: string, color: number): Promise<Duel | null> {
  const challenger = interaction.user;
  const opponent = interaction.options.getUser('opponent', true);
  const fail = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral }).then(() => null);

  if (opponent.bot) return fail("Bots can't accept challenges. Pick a person!");
  if (opponent.id === challenger.id) return fail('You need someone else to play against.');
  if (busy.has(challenger.id)) return fail("You're already in a game. Finish it first.");
  if (busy.has(opponent.id)) return fail(`<@${opponent.id}> is already in a game.`);

  const players: [string, string] = [challenger.id, opponent.id];
  busy.add(challenger.id);
  busy.add(opponent.id);
  const release = () => players.forEach((id) => busy.delete(id));

  try {
    const nonce = Date.now().toString(36);
    const expires = Math.floor(Date.now() / 1000) + CHALLENGE_SECONDS;
    const reply = await interaction.reply({
      content: `<@${opponent.id}>`, // shown but never pings (allowedMentions is empty)
      embeds: [
        new EmbedBuilder()
          .setColor(color)
          .setTitle(title)
          .setDescription(`<@${challenger.id}> challenged <@${opponent.id}>!\nThe challenge expires <t:${expires}:R>.`),
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`duel:${nonce}:accept`).setLabel('Accept').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`duel:${nonce}:decline`).setLabel('Decline').setStyle(ButtonStyle.Secondary),
        ),
      ],
      withResponse: true,
    });
    const message = reply.resource?.message;
    if (!message) throw new Error('Challenge message missing from interaction response');

    const outcome = await new Promise<'accept' | 'decline' | 'cancel' | 'timeout'>((resolve) => {
      const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: CHALLENGE_SECONDS * 1000 });
      collector.on('collect', async (btn) => {
        const action = btn.customId.split(':')[2];
        if (!btn.customId.startsWith(`duel:${nonce}:`)) return;
        if (btn.user.id === opponent.id) {
          await btn.deferUpdate().catch(() => {});
          resolve(action === 'accept' ? 'accept' : 'decline');
          collector.stop();
        } else if (btn.user.id === challenger.id && action === 'decline') {
          await btn.deferUpdate().catch(() => {});
          resolve('cancel');
          collector.stop();
        } else {
          await btn.reply({ content: "This challenge isn't for you.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      });
      collector.once('end', () => resolve('timeout'));
    });

    if (outcome !== 'accept') {
      const text = {
        decline: `<@${opponent.id}> declined the challenge.`,
        cancel: `<@${challenger.id}> withdrew the challenge.`,
        timeout: `<@${opponent.id}> didn't respond in time.`,
      }[outcome];
      await message.edit({ content: '', embeds: [new EmbedBuilder().setColor(0x99aab5).setTitle(title).setDescription(text)], components: [] }).catch(() => {});
      release();
      return null;
    }
    return { players, message, release };
  } catch (err) {
    release();
    throw err;
  }
}

export type Seat = 0 | 1;
export type Ending = { kind: 'win' | 'forfeit' | 'timeout'; winner: Seat } | { kind: 'draw' } | null;

export interface TurnGame {
  /** Applies a move from a button `action` for `seat`. Returns false if it's not legal. */
  move(action: string, seat: Seat): boolean;
  /** Checked after each legal move. */
  result(lastMover: Seat): Ending;
  /** Renders the game. `id` prefixes every custom ID; `players` are user IDs by seat. */
  view(id: string, players: [string, string], turn: Seat, ending: Ending): BaseMessageOptions;
}

/** Shared description line for turn-based games. */
export function statusLine(players: [string, string], turn: Seat, ending: Ending, marks: [string, string]): string {
  if (!ending) return `${marks[turn]} <@${players[turn]}>'s turn · moves time out after ${TURN_SECONDS / 60} min`;
  if (ending.kind === 'draw') return "🤝 It's a draw!";
  const w = `${marks[ending.winner]} <@${players[ending.winner]}> wins!`;
  if (ending.kind === 'forfeit') return `🏳️ <@${players[1 - ending.winner]}> forfeited. ${w}`;
  if (ending.kind === 'timeout') return `⏰ <@${players[1 - ending.winner]}> ran out of time. ${w}`;
  return `🏆 ${w}`;
}

export function forfeitButton(id: string, disabled: boolean): ButtonBuilder {
  return new ButtonBuilder().setCustomId(`${id}:forfeit`).setLabel('Forfeit').setStyle(ButtonStyle.Secondary).setDisabled(disabled);
}

/** Runs a two-player, alternating-turn game on the duel message until it ends, then records scores. */
export async function playTurns(duel: Duel, game: TurnGame, gameId: GameId, store: ScoreStore, guildId: string | null): Promise<void> {
  // Randomize who goes first; seat 0 always moves first.
  const players: [string, string] = Math.random() < 0.5 ? [duel.players[0], duel.players[1]] : [duel.players[1], duel.players[0]];
  const id = `${gameId}:${Date.now().toString(36)}`;
  let turn: Seat = 0;
  let ending: Ending = null;

  await duel.message.edit({ content: '', ...game.view(id, players, turn, ending) });

  await new Promise<void>((resolve) => {
    const collector = duel.message.createMessageComponentCollector({ componentType: ComponentType.Button, idle: TURN_SECONDS * 1000, time: 30 * 60 * 1000 });
    const finish = async (btn: ButtonInteraction | null) => {
      collector.stop('done');
      const view = { content: '', ...game.view(id, players, turn, ending) };
      if (btn) await btn.update(view).catch(() => {});
      else await duel.message.edit(view).catch(() => {});
    };

    collector.on('collect', async (btn) => {
      if (!btn.customId.startsWith(`${id}:`) || ending) return;
      const action = btn.customId.slice(id.length + 1);
      const seat = players.indexOf(btn.user.id);
      if (seat === -1) {
        await btn.reply({ content: "You're not playing in this game.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      if (action === 'forfeit') {
        ending = { kind: 'forfeit', winner: (1 - seat) as Seat };
        return finish(btn);
      }
      if (seat !== turn) {
        await btn.reply({ content: "It's not your turn yet.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      if (!game.move(action, turn)) {
        await btn.reply({ content: "You can't move there.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      ending = game.result(turn);
      if (ending) return finish(btn);
      turn = (1 - turn) as Seat;
      await btn.update(game.view(id, players, turn, ending)).catch(() => {});
    });

    collector.once('end', async () => {
      if (!ending) {
        ending = { kind: 'timeout', winner: (1 - turn) as Seat };
        await finish(null);
      }
      resolve();
    });
  });

  recordDuel(store, guildId, gameId, players, ending);
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
