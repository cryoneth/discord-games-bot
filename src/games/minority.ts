import { ButtonStyle, ChatInputCommandInteraction, InteractionContextType, MessageFlags, SlashCommandBuilder, type SendableChannels } from 'discord.js';
import { bannerScene } from '../render/boards.js';
import type { ScoreStore } from '../store.js';
import { card, sceneImage } from '../ui/card.js';
import { shuffle, sleep } from '../util/random.js';
import { MINORITY_QUESTIONS } from './data/minority.js';
import { mentionList, pickRound, plural, resolveMinority, runLobby } from './elimination.js';
import type { ChannelSessions } from './sessions.js';
import { stopGame } from './trivia.js';

const COLOR = 0x9b59b6;
const MAX_PLAYERS = 250;
const MAX_ROUNDS = 15;
const RESULT_PAUSE_MS = 5000;
const STYLES = [ButtonStyle.Primary, ButtonStyle.Danger, ButtonStyle.Success];
const MARKS = ['🅰️', '🅱️', '©️'];

export const minorityCommand = new SlashCommandBuilder()
  .setName('minority')
  .setDescription('Minority Wins: everyone votes, and only the least popular answer survives')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('start')
      .setDescription('Open a Minority Wins lobby in this channel')
      .addIntegerOption((o) => o.setName('join_seconds').setDescription('How long the lobby stays open (15–300, default 60)').setMinValue(15).setMaxValue(300))
      .addIntegerOption((o) => o.setName('seconds').setDescription('Seconds to vote each round (10–40, default 20)').setMinValue(10).setMaxValue(40)),
  )
  .addSubcommand((s) => s.setName('stop').setDescription('Stop the Minority Wins game in this channel'));

interface Deps {
  store: ScoreStore;
  sessions: ChannelSessions;
}

export async function handleMinority(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  if (interaction.options.getSubcommand() === 'stop') return stopGame(interaction, deps, 'minority');

  const channel = interaction.channel;
  if (!channel || !channel.isSendable()) {
    await interaction.reply({ content: "I can't post in this channel.", flags: MessageFlags.Ephemeral });
    return;
  }
  const abort = new AbortController();
  if (!deps.sessions.start(interaction.channelId, { game: 'minority', ownerId: interaction.user.id, stop: () => abort.abort() })) {
    await interaction.reply({ content: 'A game is already running in this channel.', flags: MessageFlags.Ephemeral });
    return;
  }
  try {
    const players = await runLobby({
      interaction,
      prefix: 'minority',
      color: COLOR,
      title: '🐑 Minority Wins',
      rules:
        "Every round asks a question with no right answer. Vote in secret: **only the players who picked the least popular answer survive.** If every answer gets the same number of votes, everyone stays. Don't vote and you're out. Play until one player is left (or two share the win).",
      joinSeconds: interaction.options.getInteger('join_seconds') ?? 60,
      minPlayers: 3,
      maxPlayers: MAX_PLAYERS,
      signal: abort.signal,
    });
    if (!players) return;
    await play(channel, players, interaction.options.getInteger('seconds') ?? 20, abort.signal, interaction.guildId, deps.store);
  } finally {
    deps.sessions.end(interaction.channelId);
  }
}

async function play(channel: SendableChannels, players: string[], seconds: number, signal: AbortSignal, guildId: string | null, store: ScoreStore) {
  let alive = [...players];
  const outRound = new Map<string, number>();
  const deck = shuffle(MINORITY_QUESTIONS);
  let round = 0;
  let idleRounds = 0;

  // Two players can never split into a minority, so the final two share the win.
  while (alive.length > 2 && round < MAX_ROUNDS && !signal.aborted) {
    round++;
    const question = deck[(round - 1) % deck.length]!;
    const title = `🐑 Round ${round} · ${question.q}`;
    const { msg, picks, closedRow } = await pickRound({
      channel,
      prefix: 'minority',
      color: COLOR,
      title,
      body: `**${alive.length}** players left. Pick the answer you think the **fewest** people will pick.`,
      options: question.options.map((label, i) => ({ label, emoji: MARKS[i], style: STYLES[i] })),
      alive: new Set(alive),
      seconds,
      signal,
      footer: "Votes are secret · no vote means you're out",
    });
    if (signal.aborted) break;

    const res = resolveMinority(alive, picks, question.options.length);
    for (const id of [...res.wrong, ...res.missed]) outRound.set(id, round);
    alive = res.survivors;
    idleRounds = picks.size === 0 ? idleRounds + 1 : 0;

    const tally = question.options.map((opt, i) => `${MARKS[i]} **${opt}** · ${plural(res.counts[i]!, 'vote')}${res.minority?.includes(i) ? ' ✅' : ''}`).join('\n');
    const lines = [tally, ''];
    if (picks.size === 0) lines.push('🦗 Nobody voted, so everyone stays. For now.');
    else if (!res.minority) lines.push('🤝 A tie! Nobody had the smallest group, so every voter stays.');
    else lines.push(`🐑 The minority was **${res.minority.map((i) => question.options[i]).join('** and **')}**.`);
    if (res.wrong.length) lines.push(`❌ **Out with the crowd (${res.wrong.length}):** ${mentionList(res.wrong)}`);
    if (res.missed.length) lines.push(`💤 **Didn't vote (${res.missed.length}):** ${mentionList(res.missed)}`);
    lines.push(alive.length <= 10 ? `✅ **Still in:** ${mentionList(alive)}` : `✅ **${alive.length}** still in`);
    await msg
      .edit(
        card({
          color: res.wrong.length || res.missed.length ? 0xed4245 : 0xfaa61a,
          title,
          body: lines.join('\n'),
          footer: alive.length > 2 ? 'Next round in a moment' : undefined,
          rows: [closedRow((i) => `${question.options[i]} (${res.counts[i]})`, (i) => (res.minority?.includes(i) ? ButtonStyle.Success : ButtonStyle.Secondary))],
        }),
      )
      .catch(() => {});

    if (idleRounds >= 2) {
      await channel.send({ content: '💤 Nobody has voted for two rounds, so the game is over. Start a new one with `/minority start`.' });
      return;
    }
    if (alive.length > 2) await sleep(RESULT_PAUSE_MS, signal);
  }

  if (signal.aborted) {
    await channel.send({ content: '🛑 Minority Wins was stopped.' });
    return;
  }

  const winners = new Set(alive);
  const survived = (id: string) => (outRound.get(id) ?? round + 1) - 1;
  store.record(
    guildId,
    'minority',
    players.map((id) => ({ userId: id, points: survived(id) * 10 + (winners.has(id) ? 100 : 0), won: winners.has(id) })),
  );
  const why = round >= MAX_ROUNDS && alive.length > 2 ? ` That's the ${MAX_ROUNDS}-round limit, so everyone left shares the win.` : '';
  await channel.send(
    card({
      color: 0xfee75c,
      title: '🏆 Minority Wins',
      body:
        alive.length === 1
          ? `**<@${alive[0]}>** thought differently from everyone else and wins after ${plural(round, 'round')}!`
          : `After ${plural(round, 'round')}, ${mentionList(alive)} share the win!${why}`,
      image: sceneImage(bannerScene('ODD THINKER', `${players.length} entered · ${round} rounds`, '#9b59b6'), 'winner', 'Minority Wins winner', true),
    }),
  );
}
