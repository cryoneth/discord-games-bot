import { Client, Events, GatewayIntentBits, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { startWebServer } from './activity/server.js';
import { handleLaunch, handleLeaderboard, handlePrivacy, handleServerData } from './commands/meta.js';
import { loadConfig } from './config.js';
import { handleFourInARow, handleTicTacToe } from './games/boardgames.js';
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
    case 'wordguess':
      return handleWordguess(interaction, { store, sessions });
    case 'tictactoe':
      return handleTicTacToe(interaction, { store });
    case 'fourinarow':
      return handleFourInARow(interaction, { store });
    case 'rps':
      return handleRps(interaction, { store });
    case 'wouldyourather':
      return handleWouldYouRather(interaction);
    case 'play':
    case 'draw':
      return handleLaunch(interaction);
    case 'leaderboard':
      return handleLeaderboard(interaction, store);
    case 'privacy':
      return handlePrivacy(interaction, store, config.retentionDays);
    case 'server-data':
      return handleServerData(interaction, store);
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return; // buttons are handled by per-game collectors
  const wait = commandCooldown.hit(interaction.user.id);
  if (wait > 0) {
    await interaction.reply({ content: 'Slow down a little!', flags: MessageFlags.Ephemeral }).catch(() => {});
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
