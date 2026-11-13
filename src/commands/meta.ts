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
import { card } from '../ui/card.js';
import { log } from '../util/log.js';

const GAME_CHOICES: { name: string; value: GameId }[] = [
  { name: 'Trivia', value: 'trivia' },
  { name: 'Battle royale', value: 'royale' },
  { name: 'Drawing', value: 'drawing' },
  { name: 'Word guess', value: 'wordguess' },
  { name: 'Tic-tac-toe', value: 'tictactoe' },
  { name: 'Four in a row', value: 'fourinarow' },
  { name: 'Rock paper scissors', value: 'rps' },
  { name: 'Dots and boxes', value: 'dotsandboxes' },
  { name: 'Matchsticks', value: 'matchsticks' },
  { name: 'Five in a row', value: 'fiveinarow' },
  { name: 'Mancala', value: 'mancala' },
  { name: 'Higher or lower', value: 'higherlower' },
  { name: 'Hangman duel', value: 'hangman' },
  { name: 'Number duel', value: 'numberduel' },
  { name: 'Reaction duel', value: 'reaction' },
  { name: 'Odd One Out', value: 'oddoneout' },
  { name: 'Forbidden Words', value: 'forbidden' },
  { name: 'Quiz Arena', value: 'quiz' },
  { name: 'Perp Arena', value: 'market' },
];

export const playCommand = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Open the party games Activity: drawing, Odd One Out, Forbidden Words, quizzes, trading sim')
  .setContexts(InteractionContextType.Guild);

/** Kept for people used to it; opens the same Activity. */
export const drawCommand = new SlashCommandBuilder()
  .setName('draw')
  .setDescription('Open the games Activity (Sketch Party and more)')
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
  .addSubcommand((s) => s.setName('forget-me').setDescription('Delete all of your scores and quizzes on every server'))
  .addSubcommand((s) => s.setName('opt-out').setDescription('Stop recording your scores (and delete existing ones)'))
  .addSubcommand((s) => s.setName('opt-in').setDescription('Allow your scores to be recorded again'));

export const serverDataCommand = new SlashCommandBuilder()
  .setName('server-data')
  .setDescription("Manage this server's game data (server managers only)")
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('wipe').setDescription('Permanently delete all scores recorded for this server'));

export async function handleLaunch(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    await interaction.launchActivity();
  } catch (err) {
    log.warn('launchActivity failed', err);
    await interaction.reply({
      content: "I couldn't launch the games here. Join a voice channel and pick them from the 🚀 Activities menu.",
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
  await interaction.reply(
    card({
      color: 0xfee75c,
      title: `🏆 Leaderboard · ${label}`,
      body: rows.length
        ? rows.map((r, i) => `${medals[i] ?? `\`${String(i + 1).padStart(2)}\``} <@${r.user_id}> · **${r.points}** pts · ${r.wins} 🏅 · ${r.games_played} played`).join('\n')
        : 'No scores yet. Try `/play`, `/trivia start`, `/wordguess start` or `/tictactoe`!',
      footer: 'Scores expire after a period of inactivity · /privacy for your data',
    }),
  );
}

export function privacyText(retentionDays: number): string {
  return [
    '**What this bot stores**',
    '• Your Discord user ID with your score totals, wins and games played, separately for each server.',
    '• Quizzes you write in Quiz Arena, with your user ID as the author, so only you can edit or delete them.',
    `• Nothing else. Scores not updated, and quizzes not edited or played, for **${retentionDays} days** are deleted automatically.`,
    '',
    "**What it never stores or sees**",
    '• Chat messages: the bot cannot read your server\'s messages at all (no Message Content access).',
    '• Drawings, guesses, clues, votes, trades and in-game chat are kept in memory only and discarded when the game ends.',
    '• Email, IP addresses, server lists or your Discord access token. The games Activity only asks for your username and avatar, and uses it once to confirm who you are.',
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
      const { rows, quizzes, optedOut } = store.userData(userId);
      const body = {
        user_id: userId,
        opted_out: optedOut,
        scores: rows.map((r) => ({ server_id: r.guild_id, game: r.game, points: r.points, wins: r.wins, games_played: r.games_played, last_updated: new Date(r.updated_at).toISOString() })),
        quizzes: quizzes.map((q) => ({
          server: q.scope,
          title: q.title,
          created: new Date(q.created_at).toISOString(),
          last_edited: new Date(q.updated_at).toISOString(),
          last_played: new Date(q.used_at).toISOString(),
          ...(JSON.parse(q.data) as object),
        })),
      };
      const text = JSON.stringify(body, null, 2);
      const any = rows.length || quizzes.length || optedOut;
      await interaction.reply({
        content: any ? 'Here is everything stored about you:' : 'No data is stored about you.',
        files: any ? [{ attachment: Buffer.from(text), name: 'my-data.json' }] : [],
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
    content: '⚠️ This permanently deletes **every score and every custom quiz on this server**. Continue?',
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
