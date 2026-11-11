/**
 * Registers slash commands with Discord. Run after changing commands:
 *   npm run build && npm run register
 * With DEV_GUILD_ID set, commands are registered to that server only (instant).
 */
import { REST, Routes, ApplicationCommandType, type APIApplicationCommand } from 'discord.js';
import { commands } from './commands/index.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const rest = new REST().setToken(config.token);
const body: unknown[] = commands.map((c) => c.toJSON());

if (config.devGuildId) {
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.devGuildId), { body });
  console.log(`Registered ${body.length} commands to guild ${config.devGuildId}.`);
} else {
  // Activities have a "Launch" entry point command that Discord refuses to
  // delete during a bulk overwrite, so keep it in the payload.
  const existing = (await rest.get(Routes.applicationCommands(config.clientId))) as APIApplicationCommand[];
  const entryPoints = existing.filter((c) => c.type === ApplicationCommandType.PrimaryEntryPoint);
  await rest.put(Routes.applicationCommands(config.clientId), { body: [...body, ...entryPoints] });
  console.log(`Registered ${body.length} global commands (${entryPoints.length} entry point kept). Global commands can take a few minutes to appear.`);
}
