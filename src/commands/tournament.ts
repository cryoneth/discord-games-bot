import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
} from 'discord.js';
import { endsAt, type ChessService, type TourneyEvent } from '../activity/chess/service.js';
import { JUST_FOR_FUN } from '../shared/protocol.js';
import { TIME_CONTROLS, tcName, TOURNEY_LIMITS, type TimeControl, type TourneySettings } from '../shared/chess.js';
import type { TourneyRow } from '../store.js';
import { isModerator } from '../moderation.js';
import { log } from '../util/log.js';

const ephemeral = { flags: MessageFlags.Ephemeral } as const;
const ts = (ms: number, style = 'F') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const escapeMd = (s: string) => s.replace(/([\\*_`~|>#[\]()-])/g, '\\$1');

const tourneyOption = (required: boolean, mods = false) => (o: import('discord.js').SlashCommandStringOption) =>
  o
    .setName('tournament')
    .setDescription(mods ? 'Start typing the tournament name' : 'Which tournament (default: the next one)')
    .setRequired(required)
    .setAutocomplete(true);

const startOption = (o: import('discord.js').SlashCommandStringOption, required: boolean) =>
  o.setName('start').setDescription('When: "in 2h", "18:30", "2026-12-01 18:30" or "now" (UTC unless you set utc_offset)').setRequired(required);
const offsetOption = (o: import('discord.js').SlashCommandStringOption) => o.setName('utc_offset').setDescription('Your time zone for the start time, e.g. +1, -5 or +5:30 (default: UTC)');
const tcOption = (o: import('discord.js').SlashCommandStringOption, required: boolean) =>
  o
    .setName('time_control')
    .setDescription('Minutes per player + seconds added per move')
    .setRequired(required)
    .addChoices(...TIME_CONTROLS.map((tc) => ({ name: tcName(tc), value: tc })));
const durationOption = (o: import('discord.js').SlashCommandIntegerOption, required: boolean) =>
  o
    .setName('duration')
    .setDescription('How long the arena runs')
    .setRequired(required)
    .addChoices(...TOURNEY_LIMITS.durations.map((m) => ({ name: m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`, value: m })));
const maxOption = (o: import('discord.js').SlashCommandIntegerOption) =>
  o.setName('max_players').setDescription(`Player limit (${TOURNEY_LIMITS.minPlayers}–${TOURNEY_LIMITS.maxPlayers}, default ${TOURNEY_LIMITS.maxPlayers})`).setMinValue(TOURNEY_LIMITS.minPlayers).setMaxValue(TOURNEY_LIMITS.maxPlayers);

// No default member permissions: everyone can join; organiser subcommands check for moderators when they run.
export const tournamentCommand = new SlashCommandBuilder()
  .setName('tournament')
  .setDescription('Chess arena tournaments: join, see standings, or organise one (moderators)')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('list').setDescription('Upcoming, running and recent chess tournaments'))
  .addSubcommand((s) => s.setName('join').setDescription('Sign up for a chess tournament').addStringOption(tourneyOption(false)))
  .addSubcommand((s) => s.setName('leave').setDescription('Drop out of a chess tournament').addStringOption(tourneyOption(false)))
  .addSubcommand((s) => s.setName('standings').setDescription('Standings of a chess tournament').addStringOption(tourneyOption(false)))
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('Schedule a chess arena tournament (moderators)')
      .addStringOption((o) => o.setName('name').setDescription('Tournament name').setRequired(true).setMaxLength(TOURNEY_LIMITS.nameLength))
      .addStringOption((o) => startOption(o, true))
      .addStringOption((o) => tcOption(o, true))
      .addIntegerOption((o) => durationOption(o, true))
      .addIntegerOption(maxOption)
      .addStringOption(offsetOption)
      .addChannelOption((o) =>
        o.setName('channel').setDescription('Where to announce it and post results (default: here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('edit')
      .setDescription('Change a tournament (moderators)')
      .addStringOption(tourneyOption(true, true))
      .addStringOption((o) => o.setName('name').setDescription('New name').setMaxLength(TOURNEY_LIMITS.nameLength))
      .addStringOption((o) => startOption(o, false))
      .addStringOption((o) => tcOption(o, false))
      .addIntegerOption((o) => durationOption(o, false))
      .addIntegerOption(maxOption)
      .addStringOption(offsetOption),
  )
  .addSubcommand((s) => s.setName('start-now').setDescription('Start a scheduled tournament right away (moderators)').addStringOption(tourneyOption(true, true)))
  .addSubcommand((s) =>
    s
      .setName('kick')
      .setDescription('Remove a player from a tournament (moderators)')
      .addStringOption(tourneyOption(true, true))
      .addUserOption((o) => o.setName('player').setDescription('Who to remove').setRequired(true)),
  )
  .addSubcommand((s) => s.setName('remove').setDescription('Cancel and delete a tournament (moderators)').addStringOption(tourneyOption(true, true)));

const MOD_ONLY = new Set(['create', 'edit', 'start-now', 'kick', 'remove']);

/** Parses "+2", "-5:30", "UTC+1" into minutes east of UTC. */
export function parseOffset(raw: string | null): number | null {
  if (!raw) return 0;
  const m = raw.trim().replace(/^(utc|gmt)/i, '').match(/^([+-]?)(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return null;
  const mins = Number(m[2]) * 60 + Number(m[3] ?? 0);
  if (mins > 14 * 60) return null;
  return m[1] === '-' ? -mins : mins;
}

/**
 * Parses a start time: "now", "in 2h", "90m", "1h30m", "18:30" (next time it's
 * 18:30), "2026-12-01 18:30", a Discord timestamp or Unix seconds. Clock times
 * are read in the given UTC offset (minutes). Returns ms, or null.
 */
export function parseStart(raw: string, offsetMin: number, now = Date.now()): number | null {
  const s = raw.trim().toLowerCase();
  if (s === 'now') return now;
  const discord = s.match(/^<t:(\d{9,11})(?::\w)?>$/) ?? s.match(/^(\d{10})$/);
  if (discord) return Number(discord[1]) * 1000;
  const rel = s.replace(/^in\s+/, '');
  if (/^(\d+\s*(d|days?|h|hrs?|hours?|m|mins?|minutes?)\s*)+$/.test(rel)) {
    let ms = 0;
    for (const [, n, unit] of rel.matchAll(/(\d+)\s*(d|days?|h|hrs?|hours?|m|mins?|minutes?)/g)) {
      ms += Number(n) * (unit!.startsWith('d') ? 86_400_000 : unit!.startsWith('h') ? 3_600_000 : 60_000);
    }
    return now + ms;
  }
  const shift = offsetMin * 60_000;
  const clock = s.match(/^(\d{1,2})[:.](\d{2})$/);
  if (clock) {
    const [h, m] = [Number(clock[1]), Number(clock[2])];
    if (h > 23 || m > 59) return null;
    const local = new Date(now + shift);
    let t = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m) - shift;
    if (t < now - 60_000) t += 86_400_000;
    return t;
  }
  const full = s.match(/^(\d{4})-(\d{2})-(\d{2})[ t](\d{1,2})[:.](\d{2})$/);
  if (full) {
    const [y, mo, d, h, m] = full.slice(1).map(Number) as [number, number, number, number, number];
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || m > 59) return null;
    return Date.UTC(y, mo - 1, d, h, m) - shift;
  }
  return null;
}

function durationText(min: number): string {
  return min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`;
}

function summaryLine(row: TourneyRow, players: number): string {
  const when =
    row.status === 'scheduled' ? `starts ${ts(row.starts_at)} (${ts(row.starts_at, 'R')})` : row.status === 'running' ? `**running**, ends ${ts(endsAt(row), 'R')}` : `finished ${ts(endsAt(row), 'R')}`;
  return `**${escapeMd(row.name)}** · ${tcName(row.tc)} · ${durationText(row.duration_min)} · ${players}/${row.max_players} players · ${when}`;
}

const HOW_TO_PLAY = 'Join with `/tournament join` or in the Activity. To play, open `/play` in any voice channel and pick **Chess**: you get paired automatically while it runs.';
const RULES = 'Arena rules: win 2, draw 1, loss 0. Two wins in a row puts you on fire 🔥 and doubles your points. Berserk (half your clock) adds a point to a win.';

/** Posts tournament news to its channel. */
export function tournamentAnnouncer(discord: Client) {
  return (ev: TourneyEvent) => {
    const { row } = ev;
    if (!row.channel_id) return;
    const embed = new EmbedBuilder().setColor(0xb58863);
    if (ev.kind === 'created') {
      embed
        .setTitle(`♟️ New chess tournament: ${row.name}`)
        .setDescription(`${tcName(row.tc)} arena · ${durationText(row.duration_min)} · up to ${row.max_players} players\nStarts ${ts(row.starts_at)} (${ts(row.starts_at, 'R')})\n\n${HOW_TO_PLAY}\n\n${RULES}`);
    } else if (ev.kind === 'started') {
      embed.setTitle(`♟️ ${row.name} has started!`).setDescription(`${ev.players} signed up. It ends ${ts(endsAt(row), 'R')}. Late joiners are welcome.\n\n${HOW_TO_PLAY}`);
    } else if (ev.kind === 'cancelled') {
      embed.setColor(0x99aab5).setTitle(`♟️ ${row.name} was cancelled`).setDescription('A moderator removed this tournament.');
    } else if (ev.kind === 'finished') {
      const medals = ['🥇', '🥈', '🥉'];
      embed
        .setTitle(`♟️ ${row.name}: final standings`)
        .setDescription(
          ev.ranking.length
            ? ev.ranking
                .slice(0, 10)
                .map((r, i) => `${medals[i] ?? `**${i + 1}.**`} <@${r.id}> · ${r.score} pts · ${r.wins}/${r.games} won`)
                .join('\n')
            : 'Nobody played a game.',
        )
        .setFooter({ text: `🎈 ${JUST_FOR_FUN}` });
    }
    void (async () => {
      const channel = await discord.channels.fetch(row.channel_id).catch(() => null);
      if (!channel || !channel.isSendable()) return;
      await channel.send({ embeds: [embed] });
    })().catch((err) => log.warn('Could not post a tournament announcement', err));
  };
}

interface Deps {
  chess: ChessService;
}

/** The tournament an option names, or the next open one when it's optional and empty. */
function pick(chess: ChessService, guildId: string, id: string | null): TourneyRow | null {
  if (id) return chess.get(guildId, id) ?? chess.list(guildId).find((r) => r.name.toLowerCase() === id.toLowerCase()) ?? null;
  const open = chess.list(guildId).filter((r) => r.status !== 'finished');
  return open.find((r) => r.status === 'running') ?? open[0] ?? null;
}

export async function handleTournament(interaction: ChatInputCommandInteraction, { chess }: Deps): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) return;
  const sub = interaction.options.getSubcommand();
  if (MOD_ONLY.has(sub) && !isModerator(interaction)) {
    await interaction.reply({ content: 'Only moderators can organise tournaments.', ...ephemeral });
    return;
  }
  const reply = (content: string) => interaction.reply({ content, ...ephemeral });
  const players = (row: TourneyRow) => chess.views(guildId, '').find((v) => v.id === row.id)?.standings.length ?? 0;

  if (sub === 'list') {
    const rows = chess.list(guildId);
    await reply(
      rows.length
        ? `**Chess tournaments**\n${rows.map((r) => `• ${summaryLine(r, players(r))}`).join('\n')}\n\n${HOW_TO_PLAY}`
        : `No chess tournaments yet.${isModerator(interaction) ? ' Create one with `/tournament create`.' : ' Ask a moderator to create one.'}`,
    );
    return;
  }

  if (sub === 'create' || sub === 'edit') {
    const offset = parseOffset(interaction.options.getString('utc_offset'));
    if (offset === null) return void (await reply('I couldn\'t read that UTC offset. Use something like `+1`, `-5` or `+5:30`.'));
    const startRaw = interaction.options.getString('start');
    const startsAt = startRaw ? parseStart(startRaw, offset) : undefined;
    if (startsAt === null) return void (await reply('I couldn\'t read that start time. Try `in 2h`, `18:30` or `2026-12-01 18:30`.'));
    const patch: Partial<TourneySettings> = {};
    const name = interaction.options.getString('name');
    const tc = interaction.options.getString('time_control') as TimeControl | null;
    const duration = interaction.options.getInteger('duration');
    const max = interaction.options.getInteger('max_players');
    if (name) patch.name = name;
    if (startsAt !== undefined) patch.startsAt = startsAt;
    if (tc) patch.tc = tc;
    if (duration) patch.durationMin = duration;
    if (max) patch.maxPlayers = max;
    if (sub === 'create') {
      const channelId = interaction.options.getChannel('channel')?.id ?? interaction.channelId;
      const res = chess.create(guildId, channelId, interaction.user.id, { maxPlayers: TOURNEY_LIMITS.maxPlayers, ...patch } as TourneySettings);
      if ('error' in res) return void (await reply(res.error));
      await reply(`✅ Created ${summaryLine(res.row, 0)}\nIt's announced in <#${res.row.channel_id}>. Change it with \`/tournament edit\`.`);
      return;
    }
    const row = pick(chess, guildId, interaction.options.getString('tournament'));
    if (!row) return void (await reply("I couldn't find that tournament. Pick one from the list as you type."));
    if (!Object.keys(patch).length) return void (await reply('Nothing to change. Pick at least one option to edit.'));
    const err = chess.edit(guildId, row.id, patch);
    if (err) return void (await reply(err));
    await reply(`✅ Updated: ${summaryLine(row, players(row))}`);
    return;
  }

  const row = pick(chess, guildId, interaction.options.getString('tournament'));
  if (!row) return void (await reply(interaction.options.getString('tournament') ? "I couldn't find that tournament. Pick one from the list as you type." : 'There are no upcoming tournaments right now.'));
  const me = interaction.user.id;

  switch (sub) {
    case 'join': {
      const err = chess.join(guildId, row.id, me);
      return void (await reply(err ?? `✅ You're in **${escapeMd(row.name)}** (${row.status === 'running' ? 'running now' : `starts ${ts(row.starts_at, 'R')}`}).\n${HOW_TO_PLAY}`));
    }
    case 'leave': {
      const err = chess.leave(guildId, row.id, me);
      return void (await reply(err ?? (row.status === 'running' ? `You've withdrawn from **${escapeMd(row.name)}**. Your points stay, and you can rejoin any time.` : `You've left **${escapeMd(row.name)}**.`)));
    }
    case 'standings': {
      const view = chess.views(guildId, me).find((v) => v.id === row.id);
      const list = view?.standings ?? [];
      const medals = ['🥇', '🥈', '🥉'];
      await reply(
        `${summaryLine(row, list.length)}\n\n` +
          (list.length
            ? list
                .slice(0, 20)
                .map((s, i) => `${medals[i] ?? `\`${String(i + 1).padStart(2)}\``} <@${s.id}> · ${s.score} pts${s.fire ? ' 🔥' : ''} · ${s.games} games`)
                .join('\n')
            : 'Nobody has joined yet.'),
      );
      return;
    }
    case 'start-now': {
      const err = chess.startNow(guildId, row.id);
      return void (await reply(err ?? `▶️ **${escapeMd(row.name)}** has started.`));
    }
    case 'kick': {
      const user = interaction.options.getUser('player', true);
      const err = chess.kick(guildId, row.id, user.id);
      return void (await reply(err ?? `Removed <@${user.id}> from **${escapeMd(row.name)}**. They can't rejoin it.`));
    }
    case 'remove': {
      const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('tremove:confirm').setLabel('Remove tournament').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('tremove:cancel').setLabel('Keep it').setStyle(ButtonStyle.Secondary),
      );
      const res = await interaction.reply({
        content: `⚠️ Remove **${escapeMd(row.name)}**?${row.status === 'running' ? ' It is running: games in progress are aborted and nothing is scored.' : ''} Its standings are deleted.`,
        components: [buttons],
        ...ephemeral,
        withResponse: true,
      });
      const msg = res.resource?.message;
      if (!msg) return;
      try {
        const btn = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 30_000, filter: (b) => b.user.id === me });
        if (btn.customId !== 'tremove:confirm') return void (await btn.update({ content: 'Kept. Nothing was changed.', components: [] }));
        const name = chess.remove(guildId, row.id);
        await btn.update({ content: name ? `🗑️ Removed **${escapeMd(name)}**.` : 'That tournament was already gone.', components: [] });
      } catch {
        await interaction.editReply({ content: 'Timed out. Nothing was changed.', components: [] }).catch(() => {});
      }
      return;
    }
  }
}

export async function handleTournamentAutocomplete(interaction: AutocompleteInteraction, { chess }: Deps): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) return void (await interaction.respond([]).catch(() => {}));
  const typed = interaction.options.getFocused().toLowerCase();
  const sub = interaction.options.getSubcommand(false);
  const status = { scheduled: 'upcoming', running: 'running', finished: 'finished' } as const;
  const rows = chess
    .list(guildId)
    .filter((r) => (sub === 'join' || sub === 'leave' || sub === 'edit' || sub === 'start-now' ? r.status !== 'finished' : true))
    .filter((r) => r.name.toLowerCase().includes(typed))
    .slice(0, 25)
    .map((r) => ({ name: `${r.name} · ${status[r.status]} · ${r.tc}`.slice(0, 100), value: r.id }));
  await interaction.respond(rows).catch(() => {});
}
