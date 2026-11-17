import {
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  MessageFlags,
  type Message,
  type SendableChannels,
} from 'discord.js';
import { card, nonce as makeNonce, ROW, type Card } from '../ui/card.js';

/**
 * Shared plumbing for big-group elimination games in chat (Last One Standing,
 * Minority Wins): a join lobby, then rounds where every surviving player
 * secretly picks a button before the timer runs out.
 */

/** Mentions for a list of players, cut short so huge games don't blow the message limit. */
export function mentionList(ids: readonly string[], max = 25): string {
  if (ids.length === 0) return '';
  const shown = ids.slice(0, max).map((id) => `<@${id}>`).join(' ');
  return ids.length > max ? `${shown} and ${ids.length - max} more` : shown;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export interface LobbyOptions {
  interaction: ChatInputCommandInteraction;
  /** Custom ID prefix, e.g. 'lastone'. */
  prefix: string;
  color: number;
  title: string;
  /** One or two lines explaining the rules. */
  rules: string;
  joinSeconds: number;
  minPlayers: number;
  maxPlayers: number;
  signal: AbortSignal;
}

/**
 * Posts a lobby as the reply to `interaction` and collects players until the
 * timer runs out or the host starts early. Returns the players, or null if the
 * game was cancelled or too few joined (a message saying so is already posted).
 */
export async function runLobby(o: LobbyOptions): Promise<string[] | null> {
  const channel = o.interaction.channel as SendableChannels;
  const hostId = o.interaction.user.id;
  const players = new Set<string>([hostId]);
  const closesAt = Math.floor(Date.now() / 1000) + o.joinSeconds;
  const id = `${o.prefix}:${makeNonce()}`;

  const buttons = () =>
    ROW().addComponents(
      new ButtonBuilder().setCustomId(`${id}:join`).setLabel('Join').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${id}:leave`).setLabel('Leave').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${id}:start`).setLabel('Start now (host)').setStyle(ButtonStyle.Primary),
    );
  const lobbyCard = (closed: boolean) =>
    card({
      color: o.color,
      title: o.title,
      body:
        `${o.rules}\n\n` +
        (closed ? 'The lobby is closed.' : `Click **Join** to play. The game starts <t:${closesAt}:R>.`) +
        `\nHost: <@${hostId}>\n\n**Players (${players.size}/${o.maxPlayers})**\n${mentionList([...players], 40)}`,
      footer: `Needs at least ${o.minPlayers} players`,
      rows: closed ? [] : [buttons()],
    });

  const reply = await o.interaction.reply({ ...lobbyCard(false), withResponse: true });
  const lobby = reply.resource?.message;
  if (!lobby) throw new Error('Lobby message missing from interaction response');

  const collector = lobby.createMessageComponentCollector({ componentType: ComponentType.Button, time: o.joinSeconds * 1000 });
  const onAbort = () => collector.stop('aborted');
  o.signal.addEventListener('abort', onAbort, { once: true });

  // Updating through each click's own interaction response keeps edits inside rate limits.
  collector.on('collect', async (btn) => {
    if (!btn.customId.startsWith(`${id}:`)) return;
    const action = btn.customId.slice(id.length + 1);
    const say = (content: string) => btn.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    if (action === 'start') {
      if (btn.user.id !== hostId) return void say('Only the host can start early.');
      await btn.deferUpdate().catch(() => {});
      collector.stop('host-start');
      return;
    }
    if (action === 'join') {
      if (players.has(btn.user.id)) return void say("You're already in.");
      if (players.size >= o.maxPlayers) return void say('The lobby is full.');
      players.add(btn.user.id);
    } else if (action === 'leave') {
      if (!players.delete(btn.user.id)) return void say("You're not in this game.");
    } else return;
    await btn.update(lobbyCard(false)).catch(() => {});
  });

  await new Promise<void>((resolve) => collector.once('end', () => resolve()));
  o.signal.removeEventListener('abort', onAbort);
  await lobby.edit(lobbyCard(true)).catch(() => {});

  if (o.signal.aborted) {
    await channel.send({ content: '🛑 The game was cancelled.' });
    return null;
  }
  if (players.size < o.minPlayers) {
    await channel.send({ content: `Not enough players joined (need at least ${o.minPlayers}).` });
    return null;
  }
  return [...players];
}

export interface PickOption {
  label: string;
  emoji?: string;
  style?: ButtonStyle;
}

export interface PickRoundOptions {
  channel: SendableChannels;
  prefix: string;
  color: number;
  title: string;
  body: string;
  options: readonly PickOption[];
  alive: ReadonlySet<string>;
  seconds: number;
  signal: AbortSignal;
  /** Small grey text under the round. */
  footer?: string;
}

export interface PickRoundResult {
  msg: Message;
  picks: Map<string, number>;
  /** Rebuilds the round's buttons (disabled), e.g. with counts, for the result card. */
  closedRow: (labels?: (i: number) => string, highlight?: (i: number) => ButtonStyle) => ReturnType<typeof ROW>;
}

/**
 * Posts a round with one button per option and collects secret picks from
 * surviving players. Picks can be changed until the time runs out; the round
 * closes early once every survivor has picked.
 */
export async function pickRound(o: PickRoundOptions): Promise<PickRoundResult> {
  const id = `${o.prefix}:${makeNonce()}`;
  const picks = new Map<string, number>();
  const closesAt = Math.floor(Date.now() / 1000) + o.seconds;

  const row = (disabled: boolean, labels?: (i: number) => string, highlight?: (i: number) => ButtonStyle) =>
    ROW().addComponents(
      o.options.map((opt, i) => {
        const b = new ButtonBuilder()
          .setCustomId(`${id}:${i}`)
          .setLabel((labels ? labels(i) : opt.label).slice(0, 80))
          .setStyle(highlight ? highlight(i) : (opt.style ?? ButtonStyle.Primary))
          .setDisabled(disabled);
        return opt.emoji ? b.setEmoji(opt.emoji) : b;
      }),
    );
  const openCard = (): Card => ({
    color: o.color,
    title: o.title,
    body: `${o.body}\n\n⏱️ Closes <t:${closesAt}:R> · 🔒 **${picks.size}/${o.alive.size}** picked`,
    footer: o.footer,
    rows: [row(false)],
  });

  const msg = await o.channel.send(card(openCard()));

  // Live "picked" counter, throttled to stay inside edit rate limits.
  let refresh: NodeJS.Timeout | null = null;
  let closed = false;
  const scheduleRefresh = () => {
    if (refresh || closed) return;
    refresh = setTimeout(() => {
      refresh = null;
      if (!closed) msg.edit(card(openCard())).catch(() => {});
    }, 2500);
  };

  const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: o.seconds * 1000 });
  const onAbort = () => collector.stop('aborted');
  o.signal.addEventListener('abort', onAbort, { once: true });

  collector.on('collect', async (btn) => {
    if (!btn.customId.startsWith(`${id}:`)) return;
    const choice = Number(btn.customId.slice(id.length + 1));
    if (!Number.isInteger(choice) || choice < 0 || choice >= o.options.length) return;
    const say = (content: string) => btn.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    if (!o.alive.has(btn.user.id)) return void say("You're not in this round. Watch and join the next game!");
    const before = picks.get(btn.user.id);
    picks.set(btn.user.id, choice);
    const label = o.options[choice]!.label;
    await say(before === undefined ? `🔒 You picked **${label}**. You can change it until the round closes.` : `🔁 Changed to **${label}**.`);
    if (picks.size >= o.alive.size) collector.stop('everyone');
    else scheduleRefresh();
  });

  await new Promise<void>((resolve) => collector.once('end', () => resolve()));
  o.signal.removeEventListener('abort', onAbort);
  closed = true;
  if (refresh) clearTimeout(refresh);

  return { msg, picks, closedRow: (labels, highlight) => row(true, labels, highlight) };
}

// ── Pure round logic (tested without Discord) ──────────────────────────────

export interface RoundOutcome {
  survivors: string[];
  /** Picked an option that lost. */
  wrong: string[];
  /** Didn't pick in time. */
  missed: string[];
  /** Everyone who picked would have been out, so they all get another go. */
  saved: boolean;
}

/**
 * Last One Standing: players on a safe option survive. If every player who
 * picked chose wrong, they're all spared (only the no-shows go). If nobody
 * picked at all, nobody is out.
 */
export function resolveCall(alive: readonly string[], picks: ReadonlyMap<string, number>, safe: readonly boolean[]): RoundOutcome {
  const pickers = alive.filter((id) => picks.has(id));
  const missed = pickers.length ? alive.filter((id) => !picks.has(id)) : [];
  const right = pickers.filter((id) => safe[picks.get(id)!]);
  if (right.length === 0) return { survivors: pickers.length ? pickers : [...alive], wrong: [], missed, saved: pickers.length > 0 };
  return { survivors: right, wrong: pickers.filter((id) => !safe[picks.get(id)!]), missed, saved: false };
}

export interface MinorityOutcome extends RoundOutcome {
  counts: number[];
  /** Options whose voters survive (the smallest non-empty groups), or null on a tie. */
  minority: number[] | null;
}

/**
 * Minority Wins: only the players in the smallest group survive. When every
 * group that got votes is the same size (including everyone agreeing), it's a
 * tie and every voter stays. No-shows are always out, unless nobody voted.
 */
export function resolveMinority(alive: readonly string[], votes: ReadonlyMap<string, number>, optionCount: number): MinorityOutcome {
  const counts = Array.from({ length: optionCount }, () => 0);
  const voters = alive.filter((id) => votes.has(id));
  for (const id of voters) counts[votes.get(id)!]!++;
  const missed = voters.length ? alive.filter((id) => !votes.has(id)) : [];
  const used = counts.filter((n) => n > 0);
  const min = Math.min(...used);
  if (used.length <= 1 || used.every((n) => n === min)) {
    return { survivors: voters.length ? voters : [...alive], wrong: [], missed, saved: false, counts, minority: null };
  }
  const minority = counts.map((n, i) => (n === min ? i : -1)).filter((i) => i >= 0);
  const survivors = voters.filter((id) => minority.includes(votes.get(id)!));
  return { survivors, wrong: voters.filter((id) => !minority.includes(votes.get(id)!)), missed, saved: false, counts, minority };
}
