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
  type AutocompleteInteraction,
} from 'discord.js';
import { JUST_FOR_FUN } from '../shared/protocol.js';
import { periodRange, type GameId, type Period, type ScoreStore } from '../store.js';
import { card } from '../ui/card.js';
import { log } from '../util/log.js';

const GAME_CHOICES: { name: string; value: GameId }[] = [
  { name: 'Trivia', value: 'trivia' },
  { name: 'Battle royale', value: 'royale' },
  { name: 'Last One Standing', value: 'laststanding' },
  { name: 'Minority Wins', value: 'minority' },
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
  { name: 'Mass Reaction', value: 'massreaction' },
  { name: 'Chess', value: 'chess' },
];

const PERIOD_LABELS: Record<Period, string> = { day: 'Today', week: 'This week', month: 'This month', all: 'All time' };

export const playCommand = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Open the party games Activity: drawing, Odd One Out, Forbidden Words, quizzes, trading sim, chess')
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
  .addStringOption((o) =>
    o
      .setName('period')
      .setDescription('Which board (default: all time)')
      .addChoices(...(Object.entries(PERIOD_LABELS) as [Period, string][]).map(([value, name]) => ({ name, value }))),
  )
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
  .addSubcommand((s) => s.setName('wipe').setDescription('Permanently delete all scores and custom quizzes recorded for this server'))
  .addSubcommand((s) => s.setName('quizzes').setDescription('List the custom quizzes members wrote on this server, with their authors'))
  .addSubcommand((s) =>
    s
      .setName('delete-quiz')
      .setDescription("Delete any member's custom quiz (e.g. if it breaks the server rules)")
      .addStringOption((o) => o.setName('quiz').setDescription('Start typing the quiz title').setRequired(true).setAutocomplete(true)),
  );

export const helpCommand = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Every game, how to start it, and the house rules')
  .setContexts(InteractionContextType.Guild);

export async function handleLaunch(
  interaction: ChatInputCommandInteraction,
  noteLaunch?: (guildId: string, userId: string, channelId: string) => void,
): Promise<void> {
  try {
    await interaction.launchActivity();
    // The Activity's invite is posted where /play was typed, for the whole server to see.
    if (interaction.guildId) noteLaunch?.(interaction.guildId, interaction.user.id, interaction.channelId);
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
  const period = (interaction.options.getString('period') as Period | null) ?? 'all';
  const rows = store.leaderboard(interaction.guildId, game, 10, period);
  const label = GAME_CHOICES.find((g) => g.value === game)?.name ?? 'All games';
  const medals = ['🥇', '🥈', '🥉'];
  const me = interaction.user.id;
  const mine = rows.some((r) => r.user_id === me) ? null : store.rankOf(interaction.guildId, me, game, period);
  const resets = period === 'all' ? '' : ` · resets <t:${Math.floor(periodRange(period).resetsAt / 1000)}:R>`;
  const empty =
    period === 'all'
      ? 'No scores yet. Try `/help` to pick a game!'
      : `Nobody has scored ${PERIOD_LABELS[period].toLowerCase()} yet. The top spot is wide open! Try \`/help\` to pick a game.`;
  await interaction.reply(
    card({
      color: 0xfee75c,
      title: `🏆 ${PERIOD_LABELS[period]} · ${label}`,
      body:
        (rows.length
          ? rows
              .map((r, i) => `${medals[i] ?? `\`${String(i + 1).padStart(2)}\``} <@${r.user_id}> · ${r.wins} 🏅 · ${r.games_played} played${r.user_id === me ? ' ← you' : ''}`)
              .join('\n')
          : empty) +
        (mine ? `\n\nYou're **#${mine.rank}**. Keep going!` : ''),
      footer: `🎈 Just for fun${resets}`,
    }),
  );
}

/** The `/help` text: every game, how to start it, and the house rules. Exported for tests (length limit). */
export function helpText(): string {
  return [
    '**Chat games** (anyone can start these in a channel)',
    '`/trivia start` · `/royale start` · `/laststanding start` · `/minority start` · `/wordguess start` · `/wouldyourather`',
    '**Duels** (challenge someone)',
    '`/tictactoe` · `/fourinarow` · `/fiveinarow` · `/dotsandboxes` · `/matchsticks` · `/mancala` · `/higherlower` · `/hangman` · `/numberduel` · `/reaction` · `/rps`',
    '**Voice channel games** (`/play`, or the 🚀 Activities button in a voice call)',
    'Sketch Party · Odd One Out · Forbidden Words · Quiz Arena · Perp Arena · Mass Reaction (up to 100 players) · Chess',
    '**Chess tournaments** `/tournament list` · `/tournament join` (moderators: `create`, `edit`, `kick`, `remove`)',
    '',
    '**House rules**',
    '• Anyone can join a game.',
    '• Play fair.',
    '• Anyone can write quizzes.',
    '• Be kind in clues, quizzes and chat.',
    '',
    '**Game menu** `/menu` to browse every game, how it works and how to start it.',
    '**Leaderboards** `/leaderboard`, with daily, weekly, monthly and all-time boards (days in UTC, weeks start Monday).',
    '**Your data** `/privacy` to see, delete or stop recording your scores.',
    '**Moderators** `/mod games` to see what\'s running · `/mod stop` · `/mod stop-all`.',
    '',
    `🎈 ${JUST_FOR_FUN}`,
  ].join('\n');
}

export async function handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({ ...card({ color: 0x5865f2, title: '🎮 Games & rules', body: helpText() }), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

export function privacyText(retentionDays: number): string {
  return [
    '**What this bot stores**',
    '• Your Discord user ID with your score totals, wins and games played, separately for each server (and per day, for the daily, weekly and monthly boards).',
    '• Quizzes you write in Quiz Arena, with your user ID as the author, so only you can edit or delete them.',
    '• Chess tournaments you join: your user ID with your tournament points, wins, draws and losses. Moderators who create a tournament are stored as its organiser.',
    `• Nothing else. Scores not updated, quizzes not edited or played, and tournaments finished more than **${retentionDays} days** ago are deleted automatically.`,
    '',
    "**What it never stores or sees**",
    '• Chat messages: the bot cannot read your server\'s messages at all (no Message Content access).',
    '• Drawings, guesses, clues, votes, trades and in-game chat are kept in memory only and discarded when the game ends.',
    '• Email, IP addresses, server lists or your Discord access token. The games Activity only asks for your username and avatar, and uses it once to confirm who you are.',
    '',
    '**Your controls**',
    '`/privacy my-data` see your records · `/privacy forget-me` delete them · `/privacy opt-out` stop tracking',
    '',
    `🎈 ${JUST_FOR_FUN}`,
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
      const { rows, days, quizzes, optedOut } = store.userData(userId);
      const body = {
        user_id: userId,
        opted_out: optedOut,
        scores: rows.map((r) => ({ server_id: r.guild_id, game: r.game, points: r.points, wins: r.wins, games_played: r.games_played, last_updated: new Date(r.updated_at).toISOString() })),
        daily_scores: days.map((r) => ({ server_id: r.guild_id, game: r.game, day: r.day, points: r.points, wins: r.wins, games_played: r.games_played })),
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
  const sub = interaction.options.getSubcommand();
  if (sub === 'quizzes') {
    const list = store.listServerQuizzes(interaction.guildId);
    const lines = list.slice(0, 40).map((q) => `• **${escapeMd(q.title)}** by <@${q.owner_id}> · edited <t:${Math.floor(q.updated_at / 1000)}:R>`);
    await interaction.reply({
      content: list.length
        ? `**Custom quizzes on this server (${list.length})**\n${lines.join('\n')}${list.length > 40 ? `\n…and ${list.length - 40} more` : ''}\n\nRemove one with \`/server-data delete-quiz\`.`
        : 'Nobody has written a custom quiz on this server yet.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (sub === 'delete-quiz') {
    const title = store.removeServerQuiz(interaction.guildId, interaction.options.getString('quiz', true));
    await interaction.reply({
      content: title ? `Deleted the quiz **${escapeMd(title)}**. Rooms already playing it finish the current game.` : "I couldn't find that quiz. Pick one from the list as you type.",
      flags: MessageFlags.Ephemeral,
    });
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

/** Suggests quizzes for `/server-data delete-quiz` (server managers only). */
export async function handleAutocomplete(interaction: AutocompleteInteraction, store: ScoreStore): Promise<void> {
  if (interaction.commandName !== 'server-data' || !interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.respond([]).catch(() => {});
    return;
  }
  const typed = interaction.options.getFocused().toLowerCase();
  const matches = store
    .listServerQuizzes(interaction.guildId)
    .filter((q) => q.title.toLowerCase().includes(typed))
    .slice(0, 25)
    .map((q) => ({ name: q.title.slice(0, 100) || '(untitled)', value: q.id }));
  await interaction.respond(matches).catch(() => {});
}

/** Stops user-written titles from breaking Discord formatting. */
function escapeMd(text: string): string {
  return text.replace(/[\\*_~`|>#\[\]()<@]/g, (c) => `\\${c}`);
}
