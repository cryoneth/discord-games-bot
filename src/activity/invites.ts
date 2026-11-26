import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client, type Message } from 'discord.js';
import { gameInfo, type GameId } from '../shared/protocol.js';
import { log } from '../util/log.js';
import type { Hub } from './hub.js';

/** Wait for joins/leaves to settle before posting or editing. */
const SETTLE_MS = 3000;
/** A relaunch in the same channel within this window reuses the last invite instead of posting a new one. */
const REUSE_MS = 10 * 60_000;
const MAX_LISTED = 10;
/** How long a `/play` is remembered while Discord opens the Activity. */
const LAUNCH_MS = 2 * 60_000;

interface Live {
  game: GameId | null;
  host: string | null;
  players: string[];
}

interface ChannelInvite {
  guildId: string;
  hub: Hub | null;
  /** Text channel the invite goes to, picked when it is first posted. */
  target: string | null;
  message: Message | null;
  /** Rendered state last sent, to skip edits that change nothing. */
  shown: string;
  endedAt: number;
  timer: NodeJS.Timeout | null;
  busy: boolean;
  again: boolean;
}

/**
 * Keeps one invite message per voice channel while an Activity runs there:
 * posted when it opens, edited as players come and go or the host picks a
 * game, and marked as ended once everyone has left.
 *
 * The invite goes to the text channel where `/play` was typed (or the server's
 * system channel), never the voice channel's own chat: messages there make
 * Discord desktop shrink the Activity for the people playing.
 */
export class ActivityInvites {
  private readonly byChannel = new Map<string, ChannelInvite>();
  /** `guildId:userId` → text channel of a recent `/play`. */
  private readonly launches = new Map<string, { channelId: string; at: number }>();

  constructor(private readonly discord: Client) {}

  /** Someone ran `/play` in this text channel; their Activity's invite goes there. */
  noteLaunch(guildId: string, userId: string, channelId: string): void {
    const now = Date.now();
    for (const [key, l] of this.launches) if (now - l.at > LAUNCH_MS) this.launches.delete(key);
    this.launches.set(`${guildId}:${userId}`, { channelId, at: now });
  }

  track(hub: Hub): void {
    const channelId = hub.channelId;
    if (!channelId || !hub.guildId) return; // only known when the instance is verified
    let inv = this.byChannel.get(channelId);
    if (!inv || (inv.endedAt && Date.now() - inv.endedAt > REUSE_MS)) {
      inv = { guildId: hub.guildId, hub: null, target: null, message: null, shown: '', endedAt: 0, timer: null, busy: false, again: false };
      this.byChannel.set(channelId, inv);
    }
    inv.hub = hub;
    hub.onChange = () => this.schedule(channelId);
    this.schedule(channelId);
  }

  /** The hub is going away (idle sweep). */
  untrack(hub: Hub): void {
    const inv = hub.channelId ? this.byChannel.get(hub.channelId) : undefined;
    if (!inv || inv.hub !== hub) return;
    inv.hub = null;
    this.schedule(hub.channelId!);
  }

  /** Shutting down: mark every live invite as ended (best effort, a few seconds at most). */
  async shutdown(): Promise<void> {
    const edits = [...this.byChannel.values()].map((inv) => {
      if (inv.timer) clearTimeout(inv.timer);
      inv.timer = null;
      return inv.message && inv.shown !== 'null' ? inv.message.edit(endedPayload()).catch(() => {}) : null;
    });
    this.byChannel.clear();
    await Promise.race([Promise.all(edits), new Promise((done) => setTimeout(done, 3000).unref())]);
  }

  private schedule(channelId: string): void {
    const inv = this.byChannel.get(channelId);
    if (!inv || inv.timer) return;
    inv.timer = setTimeout(() => {
      inv.timer = null;
      void this.flush(channelId);
    }, SETTLE_MS);
    inv.timer.unref();
  }

  private async flush(channelId: string): Promise<void> {
    const inv = this.byChannel.get(channelId);
    if (!inv) return;
    if (inv.busy) {
      inv.again = true;
      return;
    }
    inv.busy = true;
    try {
      const players = inv.hub?.connectedIds() ?? [];
      const live: Live | null = players.length ? { game: inv.hub!.currentGame, host: inv.hub!.hostId(), players } : null;
      const shown = JSON.stringify(live);
      if (shown === inv.shown) return;

      if (!live) {
        // Nobody here (any more): mark the invite as over, or never post one.
        if (inv.message) await inv.message.edit(endedPayload());
        inv.shown = shown;
        inv.endedAt = Date.now();
        return;
      }
      inv.endedAt = 0;
      const payload = livePayload(inv.guildId, channelId, live);
      if (inv.message) {
        await inv.message.edit(payload).catch(async (err) => {
          // Deleted by someone: post a fresh one.
          if ((err as { code?: number }).code !== 10008) throw err;
          inv.message = null;
        });
      }
      if (!inv.message) {
        inv.target ??= this.pickTarget(inv.guildId, channelId, live.players);
        const channel = inv.target ? await this.discord.channels.fetch(inv.target).catch(() => null) : null;
        if (!channel || !channel.isSendable()) {
          inv.shown = shown; // no access here; don't keep retrying
          return;
        }
        inv.message = await channel.send(payload);
      }
      inv.shown = shown;
    } catch (err) {
      log.warn('Could not update the Activity invite', err);
    } finally {
      inv.busy = false;
      if (inv.again) {
        inv.again = false;
        this.schedule(channelId);
      }
      // Forget channels whose invite ended long ago.
      for (const [id, other] of this.byChannel) {
        if (!other.hub && other.endedAt && Date.now() - other.endedAt > REUSE_MS && !other.timer && !other.busy) this.byChannel.delete(id);
      }
    }
  }

  /** The text channel of the player who ran `/play`, else the server's system channel. */
  private pickTarget(guildId: string, voiceId: string, players: string[]): string | null {
    for (const id of players) {
      const key = `${guildId}:${id}`;
      const l = this.launches.get(key);
      if (!l || Date.now() - l.at > LAUNCH_MS) continue;
      this.launches.delete(key);
      if (l.channelId !== voiceId) return l.channelId;
    }
    const system = this.discord.guilds?.cache.get(guildId)?.systemChannelId ?? null;
    return system && system !== voiceId ? system : null;
  }
}

function livePayload(guildId: string, channelId: string, live: Live) {
  const info = live.game ? gameInfo(live.game) : null;
  const listed = live.players.slice(0, MAX_LISTED).map((id) => `<@${id}>`).join(' ');
  const more = live.players.length > MAX_LISTED ? ` and ${live.players.length - MAX_LISTED} more` : '';
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(info ? `${info.emoji} ${info.name} is on. Come play!` : '🎮 Games are on. Come play!')
    .setDescription(
      [
        info ? info.blurb : 'The host is picking a game: drawing, Odd One Out, Forbidden Words, quizzes, trading sim, chess and more.',
        '',
        live.host ? `**Host:** <@${live.host}>` : null,
        `**Here (${live.players.length}):** ${listed}${more}`,
        '',
        `Join <#${channelId}> and click the Activity to hop in.`,
      ]
        .filter((l) => l !== null)
        .join('\n'),
    );
  const join = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setLabel('Join')
    .setEmoji('🎮')
    .setURL(`https://discord.com/channels/${guildId}/${channelId}`);
  return { embeds: [embed], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(join)] };
}

function endedPayload() {
  return {
    embeds: [new EmbedBuilder().setColor(0x4f545c).setTitle('🎮 The games have ended').setDescription('Start them again with `/play` in a voice channel.')],
    components: [],
  };
}
