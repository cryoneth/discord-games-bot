import { ChannelType, InteractionContextType, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { gameInfo, type GameId } from '../shared/protocol.js';
import { runningDuels } from '../games/duel.js';
import type { ChannelSessions } from '../games/sessions.js';
import { isModerator } from '../moderation.js';
import type { ChessService } from '../activity/chess/service.js';

export interface Activities {
  activities(guildId: string): { channelId: string | null; game: GameId | null; host: string | null; online: number }[];
  stopActivities(guildId: string, channelId: string | null, text: string): number;
}

interface Deps {
  sessions: ChannelSessions;
  web: Activities;
  chess?: ChessService;
}

// No default member permissions: mod roles don't need Manage Server, so the check happens when it runs.
export const modCommand = new SlashCommandBuilder()
  .setName('mod')
  .setDescription('Moderator tools: see and stop any game (moderators only)')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('games').setDescription('List every game running on this server'))
  .addSubcommand((s) =>
    s
      .setName('stop')
      .setDescription('Stop every game in a channel, including a voice channel Activity')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Where to stop games (default: this channel)')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread),
      ),
  )
  .addSubcommand((s) => s.setName('stop-all').setDescription('Stop every game on this server'));

const ephemeral = { flags: MessageFlags.Ephemeral } as const;

export async function handleMod(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId || !isModerator(interaction)) {
    await interaction.reply({ content: 'Only moderators can use this.', ...ephemeral });
    return;
  }
  const sub = interaction.options.getSubcommand();

  if (sub === 'games') {
    const lines: string[] = [];
    for (const [channelId, g] of deps.sessions.inGuild(guildId)) lines.push(`• **${g.game}** in <#${channelId}>, started by <@${g.ownerId}>`);
    for (const d of runningDuels) if (d.guildId === guildId) lines.push(`• **${d.title}** in <#${d.channelId}>: <@${d.players[0]}> vs <@${d.players[1]}>`);
    for (const a of deps.web.activities(guildId)) {
      const where = a.channelId ? `<#${a.channelId}>` : 'a voice channel';
      const what = a.game ? gameInfo(a.game).name : 'picking a game';
      lines.push(`• **Activity** in ${where}: ${what}, ${a.online} here${a.host ? `, host <@${a.host}>` : ''}`);
    }
    for (const g of deps.chess?.liveGames(guildId) ?? []) {
      lines.push(`• **Chess**${g.tourneyId ? ' (tournament)' : ''}: <@${g.white.id}> vs <@${g.black.id}>, ${g.tc}, move ${Math.ceil(g.plies / 2) || 1}`);
    }
    for (const t of deps.chess?.list(guildId) ?? []) {
      if (t.status !== 'finished') lines.push(`• **Chess tournament** ${t.name}: ${t.status === 'running' ? 'running' : `starts <t:${Math.floor(t.starts_at / 1000)}:R>`}`);
    }
    await interaction.reply({
      content: lines.length
        ? `**Running now**\n${lines.join('\n')}\n\nStop them with \`/mod stop\` or \`/mod stop-all\`. In an Activity, moderators also get **Take control** and **Stop game** buttons, and can abort or decide any chess game. Manage tournaments with \`/tournament edit\`, \`kick\` and \`remove\`.`
        : 'No games are running on this server.',
      ...ephemeral,
    });
    return;
  }

  const channelId = sub === 'stop' ? (interaction.options.getChannel('channel')?.id ?? interaction.channelId) : null;
  const inScope = (id: string) => channelId === null || id === channelId;
  let stopped = 0;
  for (const [id, g] of deps.sessions.inGuild(guildId)) {
    if (!inScope(id)) continue;
    g.stop();
    stopped++;
  }
  for (const d of [...runningDuels]) {
    if (d.guildId !== guildId || !inScope(d.channelId)) continue;
    d.stop();
    stopped++;
  }
  stopped += deps.web.stopActivities(guildId, channelId, 'A moderator stopped the game.');
  if (channelId === null && deps.chess) {
    // stop-all also aborts chess games of players who aren't on a chess screen right now.
    for (const g of deps.chess.liveGames(guildId)) {
      deps.chess.decide(guildId, g.id, 'abort');
      stopped++;
    }
  }

  const where = channelId ? `in <#${channelId}>` : 'on this server';
  await interaction.reply({
    content: stopped ? `🛑 Stopped ${stopped} game${stopped === 1 ? '' : 's'} ${where}.` : `No games are running ${where}.`,
    ...ephemeral,
  });
}
