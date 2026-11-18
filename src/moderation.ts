import { PermissionFlagsBits, type ChatInputCommandInteraction, type Client } from 'discord.js';

let modRoles = new Set<string>();

/** Called once at startup with MOD_ROLE_IDS. */
export function setModRoles(ids: readonly string[]): void {
  modRoles = new Set(ids);
}

/** Moderators: anyone with Manage Server, or one of the configured mod roles. */
export function isModerator(interaction: ChatInputCommandInteraction): boolean {
  if (!interaction.inGuild()) return false;
  if (interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const roles = interaction.member.roles;
  const ids = Array.isArray(roles) ? roles : [...roles.cache.keys()];
  return ids.some((id) => modRoles.has(id));
}

/** Same check for someone outside an interaction (Activity players). Looks the member up over REST. */
export async function isModeratorInGuild(client: Client, guildId: string, userId: string): Promise<boolean> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return false;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.ManageGuild) || member.roles.cache.some((r) => modRoles.has(r.id));
}
