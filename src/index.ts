import { Client, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { startWebServer } from './activity/server.js';
import { handleAutocomplete, handleHelp, handleLaunch, handleLeaderboard, handlePrivacy, handleServerData } from './commands/meta.js';
import { handleMenu } from './commands/menu.js';
import { loadConfig } from './config.js';
import { handleDots, handleFourInARow, handleGomoku, handleHigherLower, handleMancala, handleNim, handleTicTacToe } from './games/boardgames.js';
import { handleReaction } from './games/reaction.js';
import { handleHangman, handleNumberDuel } from './games/secretduels.js';
import { handleLastStanding } from './games/laststanding.js';
import { handleMinority } from './games/minority.js';
import { handleRoyale } from './games/royale.js';
import { handleRps } from './games/rps.js';
import { ChannelSessions } from './games/sessions.js';
import { handleTrivia } from './games/trivia.js';
import { handleWordguess } from './games/wordguess.js';
import { handleWouldYouRather } from './games/wyr.js';
import { ScoreStore } from './store.js';
import { log } from './util/log.js';
import { Cooldown } from './util/ratelimit.js';

const config = loadConfig();
const store = new ScoreStore(config.dataDir);
const sessions = new ChannelSessions();
const commandCooldown = new Cooldown(2000);

// Least privilege: only the Guilds intent. No message content, members or presence.
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  // Nothing the bot posts can ever ping anyone (e.g. @everyone injected via a name).
  allowedMentions: { parse: [], repliedUser: false },
});

async function route(interaction: ChatInputCommandInteraction): Promise<void> {
  switch (interaction.commandName) {
    case 'trivia':
      return handleTrivia(interaction, { store, sessions });
    case 'royale':
      return handleRoyale(interaction, { store, sessions });
    case 'laststanding':
      return handleLastStanding(interaction, { store, sessions });
    case 'minority':
      return handleMinority(interaction, { store, sessions });
    case 'wordguess':
      return handleWordguess(interaction, { store, sessions });
    case 'tictactoe':
      return handleTicTacToe(interaction, { store });
    case 'fourinarow':
      return handleFourInARow(interaction, { store });
    case 'rps':
      return handleRps(interaction, { store });
    case 'dotsandboxes':
      return handleDots(interaction, { store });
    case 'matchsticks':
      return handleNim(interaction, { store });
    case 'fiveinarow':
      return handleGomoku(interaction, { store });
    case 'mancala':
      return handleMancala(interaction, { store });
    case 'higherlower':
      return handleHigherLower(interaction, { store });
    case 'hangman':
      return handleHangman(interaction, { store });
    case 'numberduel':
      return handleNumberDuel(interaction, { store });
    case 'reaction':
      return handleReaction(interaction, { store });
    case 'wouldyourather':
      return handleWouldYouRather(interaction);
    case 'play':
    case 'draw':
      return handleLaunch(interaction);
    case 'leaderboard':
      return handleLeaderboard(interaction, store);
    case 'help':
      return handleHelp(interaction);
    case 'menu':
      return handleMenu(interaction);
    case 'privacy':
      return handlePrivacy(interaction, store, config.retentionDays);
    case 'server-data':
      return handleServerData(interaction, store);
  }
}

/** Chat games post and edit messages (with board images) in the channel, not only interaction replies. */
const CHAT_GAMES = new Set([
  'trivia', 'royale', 'laststanding', 'minority', 'wordguess', 'tictactoe', 'fourinarow', 'rps', 'dotsandboxes', 'matchsticks',
  'fiveinarow', 'mancala', 'higherlower', 'hangman', 'numberduel', 'reaction', 'wouldyourather',
]);

/** Names of channel permissions the bot lacks for running a chat game here (empty if all good). */
function missingChannelPermissions(interaction: ChatInputCommandInteraction): string[] {
  if (!CHAT_GAMES.has(interaction.commandName) || interaction.options.getSubcommand(false) === 'stop') return [];
  const perms = interaction.appPermissions;
  const inThread = interaction.channel?.isThread() ?? false;
  const needed: [bigint, string][] = [
    [PermissionFlagsBits.ViewChannel, 'View Channel'],
    inThread ? [PermissionFlagsBits.SendMessagesInThreads, 'Send Messages in Threads'] : [PermissionFlagsBits.SendMessages, 'Send Messages'],
    [PermissionFlagsBits.AttachFiles, 'Attach Files'],
  ];
  return needed.filter(([flag]) => !perms.has(flag)).map(([, name]) => name);
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) return handleAutocomplete(interaction, store);
  if (!interaction.isChatInputCommand()) return; // buttons are handled by per-game collectors
  const wait = commandCooldown.hit(interaction.user.id);
  if (wait > 0) {
    await interaction.reply({ content: 'Slow down a little!', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  const missing = missingChannelPermissions(interaction);
  if (missing.length) {
    await interaction
      .reply({ content: `I can't run games in this channel. Ask a server manager to give me: **${missing.join(', ')}**.`, flags: MessageFlags.Ephemeral })
      .catch(() => {});
    return;
  }
  try {
    await route(interaction);
  } catch (err) {
    log.error(`/${interaction.commandName} failed`, err);
    const reply = { content: 'Something went wrong. Please try again.', flags: MessageFlags.Ephemeral } as const;
    if (interaction.replied || interaction.deferred) await interaction.followUp(reply).catch(() => {});
    else await interaction.reply(reply).catch(() => {});
  }
});

// Without an 'error' listener, a gateway error event would crash the process.
client.on(Events.Error, (err) => log.error('Discord client error', err));
client.on(Events.Warn, (msg) => log.warn(`Discord client warning: ${msg}`));
client.on(Events.ShardDisconnect, (_e, id) => log.warn(`Shard ${id} disconnected`));
client.on(Events.ShardResume, (id) => log.info(`Shard ${id} resumed`));
client.on(Events.GuildCreate, () => log.info(`Joined a server (${client.guilds.cache.size} total)`));
client.on(Events.GuildDelete, () => log.info(`Left a server (${client.guilds.cache.size} total)`));

client.once(Events.ClientReady, (c) => log.info(`Logged in as ${c.user.tag} in ${c.guilds.cache.size} servers`));

const purge = () => {
  try {
    const n = store.purgeOlderThan(config.retentionDays);
    if (n) log.info(`Retention: deleted ${n} expired score rows`);
  } catch (err) {
    log.error('Retention purge failed', err);
  }
};
purge();
setInterval(purge, 6 * 60 * 60 * 1000).unref();

const web = startWebServer({ config, store, discord: client });
await client.login(config.token);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received, shutting down`);
  sessions.stopAll();
  await web.close().catch(() => {});
  await client.destroy().catch(() => {});
  store.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => log.error('Unhandled rejection', err));
