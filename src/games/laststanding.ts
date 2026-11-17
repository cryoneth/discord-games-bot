import { ButtonStyle, ChatInputCommandInteraction, InteractionContextType, MessageFlags, SlashCommandBuilder, type SendableChannels } from 'discord.js';
import { bannerScene } from '../render/boards.js';
import type { ScoreStore } from '../store.js';
import { card, sceneImage } from '../ui/card.js';
import { pick, rand, sleep } from '../util/random.js';
import { mentionList, pickRound, plural, resolveCall, runLobby, type PickOption } from './elimination.js';
import type { ChannelSessions } from './sessions.js';
import { stopGame } from './trivia.js';

const COLOR = 0x3ba55d;
const MAX_PLAYERS = 250;
const MAX_ROUNDS = 40;
const RESULT_PAUSE_MS = 4500;

export const lastStandingCommand = new SlashCommandBuilder()
  .setName('laststanding')
  .setDescription('Everyone calls the coin, card or dice at once. Wrong calls are out until one player is left')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('start')
      .setDescription('Open a Last One Standing lobby in this channel')
      .addIntegerOption((o) => o.setName('join_seconds').setDescription('How long the lobby stays open (15–300, default 60)').setMinValue(15).setMaxValue(300))
      .addIntegerOption((o) => o.setName('seconds').setDescription('Seconds to pick each round (10–30, default 15)').setMinValue(10).setMaxValue(30)),
  )
  .addSubcommand((s) => s.setName('stop').setDescription('Stop the Last One Standing game in this channel'));

/** One kind of round: the options players pick from, and a random draw deciding which are safe. */
export interface Call {
  name: string;
  prompt: string;
  options: PickOption[];
  roll(): { safe: boolean[]; reveal: string };
}

const SUITS = [
  { s: '♥', red: true },
  { s: '♦', red: true },
  { s: '♠', red: false },
  { s: '♣', red: false },
];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const CALLS: Call[] = [
  {
    name: 'Coin flip',
    prompt: '🪙 **Heads or tails?**',
    options: [{ label: 'Heads', emoji: '👑' }, { label: 'Tails', emoji: '🦅' }],
    roll() {
      const heads = rand(0, 1) === 0;
      return { safe: [heads, !heads], reveal: `🪙 The coin landed on **${heads ? 'heads' : 'tails'}**.` };
    },
  },
  {
    name: 'Red or black',
    prompt: '🃏 **Will the next card be red or black?**',
    options: [
      { label: 'Red', emoji: '♥️', style: ButtonStyle.Danger },
      { label: 'Black', emoji: '♠️', style: ButtonStyle.Secondary },
    ],
    roll() {
      const suit = pick(SUITS);
      return { safe: [suit.red, !suit.red], reveal: `🃏 The card was the **${pick(RANKS)}${suit.s}**, so **${suit.red ? 'red' : 'black'}** wins.` };
    },
  },
  {
    name: 'Odd or even',
    prompt: '🎲 **One die. Odd or even?**',
    options: [{ label: 'Odd', emoji: '1️⃣' }, { label: 'Even', emoji: '2️⃣' }],
    roll() {
      const n = rand(1, 6);
      return { safe: [n % 2 === 1, n % 2 === 0], reveal: `🎲 Rolled a **${n}**, so **${n % 2 ? 'odd' : 'even'}** wins.` };
    },
  },
  {
    name: 'Higher or lower',
    prompt: '🔢 **A number from 1 to 100 is coming. Higher or lower than 50?**',
    options: [{ label: 'Higher', emoji: '⬆️' }, { label: 'Lower', emoji: '⬇️' }],
    roll() {
      let n = rand(1, 99);
      if (n >= 50) n++; // never exactly 50
      return { safe: [n > 50, n < 50], reveal: `🔢 The number was **${n}**, so **${n > 50 ? 'higher' : 'lower'}** wins.` };
    },
  },
  {
    name: 'Two doors',
    prompt: '🚪 **Two doors. One of them hides a trap.**',
    options: [{ label: 'Left door', emoji: '🚪' }, { label: 'Right door', emoji: '🚪' }],
    roll() {
      const trap = rand(0, 1);
      return { safe: [trap !== 0, trap !== 1], reveal: `💥 The trap was behind the **${trap ? 'right' : 'left'} door**.` };
    },
  },
  {
    name: 'Three chests',
    prompt: '📦 **Three chests. One has a bomb inside. Open one.**',
    options: [{ label: 'Chest 1', emoji: '📦' }, { label: 'Chest 2', emoji: '📦' }, { label: 'Chest 3', emoji: '📦' }],
    roll() {
      const bomb = rand(0, 2);
      return { safe: [0, 1, 2].map((i) => i !== bomb), reveal: `💣 The bomb was in **chest ${bomb + 1}**.` };
    },
  },
];

interface Deps {
  store: ScoreStore;
  sessions: ChannelSessions;
}

export async function handleLastStanding(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  if (interaction.options.getSubcommand() === 'stop') return stopGame(interaction, deps, 'laststanding');

  const channel = interaction.channel;
  if (!channel || !channel.isSendable()) {
    await interaction.reply({ content: "I can't post in this channel.", flags: MessageFlags.Ephemeral });
    return;
  }
  const abort = new AbortController();
  if (!deps.sessions.start(interaction.channelId, { game: 'laststanding', ownerId: interaction.user.id, stop: () => abort.abort() })) {
    await interaction.reply({ content: 'A game is already running in this channel.', flags: MessageFlags.Ephemeral });
    return;
  }
  try {
    const players = await runLobby({
      interaction,
      prefix: 'lastone',
      color: COLOR,
      title: '🎯 Last One Standing',
      rules: 'Every round, everyone secretly calls a coin flip, a card, a die or a door. Wrong calls are out, and so is anyone who doesn\'t pick in time. The last player left wins.',
      joinSeconds: interaction.options.getInteger('join_seconds') ?? 60,
      minPlayers: 2,
      maxPlayers: MAX_PLAYERS,
      signal: abort.signal,
    });
    if (!players) return;
    await play(channel, players, interaction.options.getInteger('seconds') ?? 15, abort.signal, interaction.guildId, deps.store);
  } finally {
    deps.sessions.end(interaction.channelId);
  }
}

async function play(channel: SendableChannels, players: string[], seconds: number, signal: AbortSignal, guildId: string | null, store: ScoreStore) {
  let alive = [...players];
  const outRound = new Map<string, number>();
  let round = 0;
  let idleRounds = 0;
  let last: Call | null = null;

  while (alive.length > 1 && round < MAX_ROUNDS && !signal.aborted) {
    round++;
    const call: Call = pick(CALLS.filter((c) => c !== last));
    last = call;
    const title = `🎯 Round ${round} · ${call.name}`;
    const { msg, picks, closedRow } = await pickRound({
      channel,
      prefix: 'lastone',
      color: COLOR,
      title,
      body: `${call.prompt}\n**${alive.length}** still standing. Call it wrong and you're out!`,
      options: call.options,
      alive: new Set(alive),
      seconds,
      signal,
      footer: "Picks are secret · no pick means you're out",
    });
    if (signal.aborted) break;

    const { safe, reveal } = call.roll();
    const res = resolveCall(alive, picks, safe);
    for (const id of [...res.wrong, ...res.missed]) outRound.set(id, round);
    alive = res.survivors;
    idleRounds = picks.size === 0 ? idleRounds + 1 : 0;

    const counts = call.options.map((_, i) => [...picks.values()].filter((v) => v === i).length);
    const lines = [reveal];
    if (picks.size === 0) lines.push('🦗 Nobody picked, so everyone stays. For now.');
    else if (res.saved) lines.push('😅 Everyone who picked got it wrong, so you all get another chance!');
    if (res.wrong.length) lines.push(`❌ **Out (${res.wrong.length}):** ${mentionList(res.wrong)}`);
    if (res.missed.length) lines.push(`💤 **Too slow (${res.missed.length}):** ${mentionList(res.missed)}`);
    lines.push(alive.length <= 10 ? `✅ **Still standing:** ${mentionList(alive)}` : `✅ **${alive.length}** still standing`);
    await msg
      .edit(
        card({
          color: res.wrong.length || res.missed.length ? 0xed4245 : 0xfaa61a,
          title,
          body: lines.join('\n'),
          footer: alive.length > 1 ? 'Next round in a moment' : undefined,
          rows: [closedRow((i) => `${call.options[i]!.label} (${counts[i]})`, (i) => (safe[i] ? ButtonStyle.Success : ButtonStyle.Secondary))],
        }),
      )
      .catch(() => {});

    if (idleRounds >= 2) {
      await channel.send({ content: '💤 Nobody has picked for two rounds, so the game is over. Start a new one with `/laststanding start`.' });
      return;
    }
    if (alive.length > 1) await sleep(RESULT_PAUSE_MS, signal);
  }

  if (signal.aborted) {
    await channel.send({ content: '🛑 Last One Standing was stopped.' });
    return;
  }

  const winners = new Set(alive);
  const survived = (id: string) => (outRound.get(id) ?? round + 1) - 1;
  store.record(
    guildId,
    'laststanding',
    players.map((id) => ({ userId: id, points: survived(id) * 10 + (winners.has(id) ? 100 : 0), won: winners.has(id) })),
  );
  const runnersUp = players.filter((id) => outRound.get(id) === round);
  await channel.send(
    card({
      color: 0xfee75c,
      title: '🏆 Last One Standing',
      body:
        (winners.size === 1
          ? `**<@${alive[0]}>** is the last one standing after ${plural(round, 'round')}!`
          : `After ${plural(round, 'round')}, these players share the win: ${mentionList(alive)}`) +
        (runnersUp.length ? `\n\n**Out in the final round:** ${mentionList(runnersUp, 10)}` : ''),
      image: sceneImage(bannerScene('SOLE SURVIVOR', `${players.length} entered · ${round} rounds`, '#3ba55d'), 'winner', 'Last One Standing winner', true),
    }),
  );
}
