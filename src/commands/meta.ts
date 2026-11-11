import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { GameId, ScoreStore } from '../store.js';
import { log } from '../util/log.js';

const GAME_CHOICES: { name: string; value: GameId }[] = [
  { name: 'Trivia', value: 'trivia' },
  { name: 'Battle royale', value: 'royale' },
  { name: 'Drawing', value: 'drawing' },
];

export const drawCommand = new SlashCommandBuilder()
  .setName('draw')
  .setDescription('Launch the drawing & guessing game right here in Discord')
  .setContexts(InteractionContextType.Guild);

export const leaderboardCommand = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription("Show this server's top players")
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) => o.setName('game').setDescription('Filter by game (default: all games)').addChoices(...GAME_CHOICES));

export const privacyCommand = new SlashCommandBuilder()
  .setName('privacy')
  .setDescription('See and control what this bot stores about you')
  .addSubcommand((s) => s.setName('info').setDescription('What data the bot keeps, and for how long'))
  .addSubcommand((s) => s.setName('my-data').setDescription('Show every record the bot has about you'))
  .addSubcommand((s) => s.setName('forget-me').setDescription('Delete all of your scores on every server'))
  .addSubcommand((s) => s.setName('opt-out').setDescription('Stop recording your scores (and delete existing ones)'))
  .addSubcommand((s) => s.setName('opt-in').setDescription('Allow your scores to be recorded again'));

export const serverDataCommand = new SlashCommandBuilder()
  .setName('server-data')
  .setDescription("Manage this server's game data (server managers only)")
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('wipe').setDescription('Permanently delete all scores recorded for this server'));

export async function handleDraw(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    await interaction.launchActivity();
  } catch (err) {
    log.warn('launchActivity failed', err);
    await interaction.reply({
      content: "I couldn't launch the drawing game here. Join a voice channel and pick it from the 🚀 Activities menu.",
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handleLeaderboard(interaction: ChatInputCommandInteraction, store: ScoreStore): Promise<void> {
  if (!interaction.guildId) return;
  const game = interaction.options.getString('game') as GameId | null;
  const rows = store.leaderboard(interaction.guildId, game, 10);
  const label = GAME_CHOICES.find((g) => g.value === game)?.name ?? 'All games';
  const medals = ['🥇', '🥈', '🥉'];
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle(`🏆 Leaderboard · ${label}`)
        .setDescription(
          rows.length
            ? rows.map((r, i) => `${medals[i] ?? `**${i + 1}.**`} <@${r.user_id}> — ${r.points} pts · ${r.wins} wins · ${r.games_played} games`).join('\n')
            : 'No scores yet. Start a game with `/trivia start`, `/royale start` or `/draw`!',
        ),
    ],
  });
}

export function privacyText(retentionDays: number): string {
  return [
    '**What this bot stores**',
    '• Your Discord user ID with your score totals, wins and games played, separately for each server.',
    `• Nothing else. Scores not updated for **${retentionDays} days** are deleted automatically.`,
    '',
    "**What it never stores or sees**",
    '• Chat messages: the bot cannot read your server\'s messages at all (no Message Content access).',
    '• Drawings, guesses and in-game chat are kept in memory only and discarded when the game ends.',
    '• Email, IP addresses, server lists or your Discord access token. The drawing Activity only asks for your username and avatar, and uses it once to confirm who you are.',
    '',
    '**Your controls**',
    '`/privacy my-data` see your records · `/privacy forget-me` delete them · `/privacy opt-out` stop tracking',
    'Server managers can delete all of a server\'s data with `/server-data wipe`.',
  ].join('\n');
}

export async function handlePrivacy(interaction: ChatInputCommandInteraction, store: ScoreStore, retentionDays: number): Promise<void> {
  const userId = interaction.user.id;
  const ephemeral = { flags: MessageFlags.Ephemeral } as const;
  switch (interaction.options.getSubcommand()) {
    case 'info':
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🔒 Privacy').setDescription(privacyText(retentionDays))], ...ephemeral });
      return;
    case 'my-data': {
      const { rows, optedOut } = store.userData(userId);
      const body = {
        user_id: userId,
        opted_out: optedOut,
        scores: rows.map((r) => ({ server_id: r.guild_id, game: r.game, points: r.points, wins: r.wins, games_played: r.games_played, last_updated: new Date(r.updated_at).toISOString() })),
      };
      const text = JSON.stringify(body, null, 2);
      await interaction.reply({
        content: rows.length || optedOut ? 'Here is everything stored about you:' : 'No data is stored about you.',
        files: rows.length || optedOut ? [{ attachment: Buffer.from(text), name: 'my-data.json' }] : [],
        ...ephemeral,
      });
      return;
    }
    case 'forget-me': {
      const n = store.forgetUser(userId);
      await interaction.reply({ content: n ? `Deleted ${n} record${n === 1 ? '' : 's'}. 🧹` : 'There was nothing to delete.', ...ephemeral });
      return;
    }
    case 'opt-out':
      store.setOptOut(userId, true);
      await interaction.reply({ content: "You're opted out. Your existing scores were deleted and new ones won't be recorded. You can still play.", ...ephemeral });
      return;
    case 'opt-in':
      store.setOptOut(userId, false);
      await interaction.reply({ content: "You're opted in. Your scores will be recorded again.", ...ephemeral });
      return;
  }
}

export async function handleServerData(interaction: ChatInputCommandInteraction, store: ScoreStore): Promise<void> {
  if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: 'You need the Manage Server permission for this.', flags: MessageFlags.Ephemeral });
    return;
  }
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('wipe:confirm').setLabel('Delete all server data').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('wipe:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  const reply = await interaction.reply({
    content: '⚠️ This permanently deletes **every score recorded on this server**. Continue?',
    components: [row],
    flags: MessageFlags.Ephemeral,
    withResponse: true,
  });
  const msg = reply.resource?.message;
  if (!msg) return;
  try {
    const btn = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 30_000, filter: (b) => b.user.id === interaction.user.id });
    if (btn.customId === 'wipe:confirm') {
      const n = store.wipeGuild(interaction.guildId);
      await btn.update({ content: `Deleted ${n} record${n === 1 ? '' : 's'} for this server.`, components: [] });
    } else {
      await btn.update({ content: 'Cancelled. Nothing was deleted.', components: [] });
    }
  } catch {
    await interaction.editReply({ content: 'Timed out. Nothing was deleted.', components: [] }).catch(() => {});
  }
}
