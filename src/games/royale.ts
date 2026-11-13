import {
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { bannerScene } from '../render/boards.js';
import type { ScoreStore } from '../store.js';
import { card, ROW, sceneImage } from '../ui/card.js';
import { pick, rand, shuffle, sleep } from '../util/random.js';
import { ELIMINATIONS, FLAVOR, REVIVALS, SOLO_ELIMINATIONS } from './data/royale.js';
import type { ChannelSessions } from './sessions.js';
import { stopGame } from './trivia.js';

const MAX_PLAYERS = 100;
const COLOR = 0xeb459e;

export const royaleCommand = new SlashCommandBuilder()
  .setName('royale')
  .setDescription('A battle royale: join, then watch the chaos until one player is left')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('start')
      .setDescription('Open a battle royale lobby in this channel')
      .addIntegerOption((o) => o.setName('join_seconds').setDescription('How long the lobby stays open (15–300, default 60)').setMinValue(15).setMaxValue(300)),
  )
  .addSubcommand((s) => s.setName('stop').setDescription('Stop the battle royale in this channel'));

interface Deps {
  store: ScoreStore;
  sessions: ChannelSessions;
}

export async function handleRoyale(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  if (interaction.options.getSubcommand() === 'stop') return stopGame(interaction, deps, 'royale');

  const channel = interaction.channel;
  if (!channel || !channel.isSendable()) {
    await interaction.reply({ content: "I can't post in this channel.", flags: MessageFlags.Ephemeral });
    return;
  }

  const hostId = interaction.user.id;
  const joinSeconds = interaction.options.getInteger('join_seconds') ?? 60;
  const abort = new AbortController();
  if (!deps.sessions.start(interaction.channelId, { game: 'royale', ownerId: hostId, stop: () => abort.abort() })) {
    await interaction.reply({ content: 'A game is already running in this channel.', flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    const players = new Set<string>([hostId]);
    const closesAt = Math.floor(Date.now() / 1000) + joinSeconds;
    const nonce = Date.now().toString(36);

    const lobbyCard = (closed: boolean) =>
      card({
        color: COLOR,
        title: '⚔️ Battle royale lobby',
        body:
          (closed ? 'The lobby is closed. Let the chaos begin!' : `Click **Join** to enter. The game starts <t:${closesAt}:R>.`) +
          `\nHost: <@${hostId}>\n\n**Players (${players.size}/${MAX_PLAYERS})**\n` +
          [...players].slice(0, 40).map((id) => `<@${id}>`).join(' ') +
          (players.size > 40 ? ` and ${players.size - 40} more` : ''),
        footer: 'Needs at least 2 players',
        rows: closed ? [] : [lobbyButtons(false)],
      });
    const lobbyButtons = (disabled: boolean) =>
      ROW().addComponents(
        new ButtonBuilder().setCustomId(`royale:${nonce}:join`).setLabel('Join').setEmoji('⚔️').setStyle(ButtonStyle.Success).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`royale:${nonce}:leave`).setLabel('Leave').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`royale:${nonce}:start`).setLabel('Start now (host)').setStyle(ButtonStyle.Primary).setDisabled(disabled),
      );

    const reply = await interaction.reply({ ...lobbyCard(false), withResponse: true });
    const lobby = reply.resource?.message;
    if (!lobby) throw new Error('Lobby message missing from interaction response');

    const collector = lobby.createMessageComponentCollector({ componentType: ComponentType.Button, time: joinSeconds * 1000 });
    const onAbort = () => collector.stop('aborted');
    abort.signal.addEventListener('abort', onAbort, { once: true });

    collector.on('collect', async (btn) => {
      const action = btn.customId.split(':')[2];
      if (!btn.customId.startsWith(`royale:${nonce}:`)) return;
      if (action === 'start') {
        if (btn.user.id !== hostId) {
          await btn.reply({ content: 'Only the host can start early.', flags: MessageFlags.Ephemeral }).catch(() => {});
          return;
        }
        await btn.deferUpdate().catch(() => {});
        collector.stop('host-start');
        return;
      }
      if (action === 'join') {
        if (players.has(btn.user.id)) {
          await btn.reply({ content: "You're already in.", flags: MessageFlags.Ephemeral }).catch(() => {});
          return;
        }
        if (players.size >= MAX_PLAYERS) {
          await btn.reply({ content: 'The lobby is full.', flags: MessageFlags.Ephemeral }).catch(() => {});
          return;
        }
        players.add(btn.user.id);
      } else if (action === 'leave') {
        if (!players.delete(btn.user.id)) {
          await btn.reply({ content: "You're not in this game.", flags: MessageFlags.Ephemeral }).catch(() => {});
          return;
        }
      } else {
        return;
      }
      // Updating via the interaction response keeps us well inside rate limits.
      await btn.update(lobbyCard(false)).catch(() => {});
    });

    await new Promise<void>((resolve) => collector.once('end', () => resolve()));
    abort.signal.removeEventListener('abort', onAbort);
    await lobby.edit(lobbyCard(true)).catch(() => {});

    if (abort.signal.aborted) {
      await channel.send({ content: '🛑 The battle royale was cancelled.' });
      return;
    }
    if (players.size < 2) {
      await channel.send({ content: 'Not enough players joined (need at least 2). Try again with `/royale start`.' });
      return;
    }

    const { winner, kills, rounds } = await simulate([...players], abort.signal, async (round, lines, alive) => {
      const total = players.size;
      await channel.send(
        card({
          color: COLOR,
          title: `⚔️ Round ${round}`,
          body: lines.join('\n'),
          footer: `${alive} of ${total} player${total === 1 ? '' : 's'} still standing`,
        }),
      );
    });

    if (abort.signal.aborted || !winner) {
      await channel.send({ content: '🛑 The battle royale was stopped.' });
      return;
    }

    deps.store.record(
      interaction.guildId,
      'royale',
      [...players].map((id) => ({ userId: id, points: (kills.get(id) ?? 0) * 20 + (id === winner ? 100 : 0), won: id === winner })),
    );

    const topKillers = [...kills.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    await channel.send(
      card({
        color: 0xfee75c,
        title: '🏆 We have a winner!',
        body:
          `**<@${winner}>** is the last one standing after ${rounds} rounds!` +
          (topKillers.length ? `\n\n**Most eliminations**\n${topKillers.map(([id, k]) => `<@${id}> · ${k}`).join('\n')}` : ''),
        image: sceneImage(bannerScene('LAST ONE STANDING', `${players.size} entered · ${rounds} rounds`, '#ff5470'), 'winner', 'Battle royale winner', true),
      }),
    );
  } finally {
    deps.sessions.end(interaction.channelId);
  }
}

/**
 * Pure game simulation, separated from Discord for testing. Calls `announce`
 * once per round and returns the winner.
 */
export async function simulate(
  playerIds: string[],
  signal: AbortSignal,
  announce: (round: number, lines: string[], alive: number) => Promise<void>,
  roundDelayMs = 5000,
): Promise<{ winner: string | null; kills: Map<string, number>; rounds: number }> {
  let alive = shuffle(playerIds);
  const dead: string[] = [];
  const kills = new Map<string, number>();
  const fill = (tpl: string, a: string, b?: string) => tpl.replaceAll('{a}', `<@${a}>`).replaceAll('{b}', b ? `<@${b}>` : '');
  let round = 0;

  while (alive.length > 1 && !signal.aborted) {
    round++;
    const lines: string[] = [];
    // Bigger lobbies get more events per round so games don't drag.
    const events = Math.min(alive.length + 1, rand(2, 4) + Math.floor(alive.length / 8));
    let eliminatedThisRound = 0;

    for (let e = 0; e < events && alive.length > 1; e++) {
      const r = Math.random();
      alive = shuffle(alive);
      if (r < 0.55) {
        const [a, b] = alive as [string, string];
        lines.push('💥 ' + fill(pick(ELIMINATIONS), a, b));
        alive = alive.filter((id) => id !== b);
        dead.push(b);
        kills.set(a, (kills.get(a) ?? 0) + 1);
        eliminatedThisRound++;
      } else if (r < 0.75) {
        const a = alive[0]!;
        lines.push('💀 ' + fill(pick(SOLO_ELIMINATIONS), a));
        alive = alive.slice(1);
        dead.push(a);
        eliminatedThisRound++;
      } else if (r < 0.8 && dead.length > 0 && round > 1 && alive.length > 2) {
        const idx = Math.floor(Math.random() * dead.length);
        const a = dead.splice(idx, 1)[0]!;
        alive.push(a);
        lines.push('✨ ' + fill(pick(REVIVALS), a));
      } else {
        const [a, b] = alive as [string, string];
        lines.push('· ' + fill(pick(FLAVOR), a, b));
      }
    }
    // Guarantee progress every round.
    if (eliminatedThisRound === 0 && alive.length > 1) {
      const a = alive[0]!;
      lines.push('💀 ' + fill(pick(SOLO_ELIMINATIONS), a));
      alive = alive.slice(1);
      dead.push(a);
    }

    await announce(round, lines, alive.length);
    if (alive.length > 1) await sleep(roundDelayMs, signal);
  }

  return { winner: signal.aborted ? null : (alive[0] ?? null), kills, rounds: round };
}
