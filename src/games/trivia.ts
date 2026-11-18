import {
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { bannerScene } from '../render/boards.js';
import type { ScoreStore } from '../store.js';
import { card, ROW, sceneImage } from '../ui/card.js';
import { pick, shuffle, sleep } from '../util/random.js';
import { CATEGORY_LABELS, TRIVIA, type TriviaCategory } from './data/trivia.js';
import { isModerator } from '../moderation.js';
import type { ChannelSessions } from './sessions.js';

const LETTERS = ['A', 'B', 'C', 'D'] as const;
const COLOR = 0x5865f2;
const MEDALS = ['🥇', '🥈', '🥉'];

export const triviaCommand = new SlashCommandBuilder()
  .setName('trivia')
  .setDescription('Multiple-choice trivia for everyone in this channel')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('start')
      .setDescription('Start a trivia game in this channel')
      .addIntegerOption((o) => o.setName('questions').setDescription('Number of questions (3–20, default 8)').setMinValue(3).setMaxValue(20))
      .addStringOption((o) =>
        o
          .setName('category')
          .setDescription('Question category (default: mixed)')
          .addChoices(...Object.entries(CATEGORY_LABELS).map(([value, name]) => ({ name, value }))),
      )
      .addIntegerOption((o) => o.setName('seconds').setDescription('Seconds per question (10–60, default 20)').setMinValue(10).setMaxValue(60)),
  )
  .addSubcommand((s) => s.setName('stop').setDescription('Stop the trivia game in this channel'));

interface Deps {
  store: ScoreStore;
  sessions: ChannelSessions;
}

export async function handleTrivia(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const sub = interaction.options.getSubcommand();
  if (sub === 'stop') return stopGame(interaction, deps, 'trivia');

  const channel = interaction.channel;
  if (!channel || !channel.isSendable()) {
    await interaction.reply({ content: "I can't post in this channel.", flags: MessageFlags.Ephemeral });
    return;
  }

  const count = interaction.options.getInteger('questions') ?? 8;
  const category = interaction.options.getString('category') as TriviaCategory | null;
  const seconds = interaction.options.getInteger('seconds') ?? 20;
  const pool = shuffle(category ? TRIVIA.filter((q) => q.category === category) : TRIVIA).slice(0, count);

  const abort = new AbortController();
  const started = deps.sessions.start(interaction.channelId, {
    game: 'trivia',
    guildId: interaction.guildId,
    ownerId: interaction.user.id,
    stop: () => abort.abort(),
  });
  if (!started) {
    await interaction.reply({ content: 'A game is already running in this channel.', flags: MessageFlags.Ephemeral });
    return;
  }

  const scores = new Map<string, number>();
  /** Everyone who answered at least once, so a lone right answer among several players still counts. */
  const played = new Set<string>();
  const progress = (i: number) => pool.map((_, k) => (k < i ? '●' : k === i ? '◉' : '○')).join('');
  const standings = (n: number) => {
    const ranking = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    return ranking.map(([id, pts], idx) => `${MEDALS[idx] ?? `**${idx + 1}.**`} <@${id}> ${pts}`).join('  ');
  };
  try {
    await interaction.reply(
      card({
        color: COLOR,
        title: '🧠 Trivia is starting!',
        body:
          `**${pool.length} questions** · ${category ? CATEGORY_LABELS[category] : 'Mixed categories'} · ${seconds}s each\n` +
          'Click a button to lock in your answer. Faster correct answers score more.\n' +
          `Host: <@${interaction.user.id}>`,
        footer: 'First question in a few seconds · /trivia stop to end early',
      }),
    );
    await sleep(4000, abort.signal);

    for (let i = 0; i < pool.length && !abort.signal.aborted; i++) {
      const q = pool[i]!;
      const options = shuffle(q.answers);
      const correct = options.indexOf(q.answers[0]);
      const nonce = `${Date.now().toString(36)}${i}`;
      const deadline = Math.floor(Date.now() / 1000) + seconds;
      const answers = new Map<string, { choice: number; at: number }>();
      const header = `Question ${i + 1} of ${pool.length} · ${CATEGORY_LABELS[q.category]}`;

      const buttons = (reveal: boolean, counts?: number[]) =>
        ROW().addComponents(
          options.map((o, idx) =>
            new ButtonBuilder()
              .setCustomId(`trivia:${nonce}:${idx}`)
              .setLabel(`${LETTERS[idx]}. ${o}${counts ? ` (${counts[idx]})` : ''}`.slice(0, 80))
              .setStyle(reveal ? (idx === correct ? ButtonStyle.Success : ButtonStyle.Secondary) : ButtonStyle.Primary)
              .setDisabled(reveal),
          ),
        );
      const questionCard = () =>
        card({
          color: COLOR,
          title: q.question,
          body: `-# ${header}\n` + options.map((o, idx) => `**${LETTERS[idx]}.** ${o}`).join('\n') + `\n\n⏱️ Time's up <t:${deadline}:R> · 🔒 **${answers.size}** locked in`,
          footer: progress(i),
          rows: [buttons(false)],
        });

      const msg = await channel.send(questionCard());
      const askedAt = Date.now();

      // Live "locked in" counter, throttled to stay inside edit rate limits.
      let refresh: NodeJS.Timeout | null = null;
      let revealed = false;
      const scheduleRefresh = () => {
        if (refresh || revealed) return;
        refresh = setTimeout(() => {
          refresh = null;
          if (!revealed) msg.edit(questionCard()).catch(() => {});
        }, 2500);
      };

      const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: seconds * 1000 });
      const onAbort = () => collector.stop('aborted');
      abort.signal.addEventListener('abort', onAbort, { once: true });

      collector.on('collect', async (btn) => {
        const choice = Number(btn.customId.split(':')[2]);
        if (!btn.customId.startsWith(`trivia:${nonce}:`) || !Number.isInteger(choice) || choice < 0 || choice > 3) return;
        if (answers.has(btn.user.id)) {
          await btn.reply({ content: 'You already locked in an answer.', flags: MessageFlags.Ephemeral }).catch(() => {});
          return;
        }
        answers.set(btn.user.id, { choice, at: Date.now() });
        played.add(btn.user.id);
        await btn.reply({ content: `🔒 Locked in **${LETTERS[choice]}. ${options[choice]}**`, flags: MessageFlags.Ephemeral }).catch(() => {});
        scheduleRefresh();
      });

      await new Promise<void>((resolve) => collector.once('end', () => resolve()));
      abort.signal.removeEventListener('abort', onAbort);
      revealed = true;
      if (refresh) clearTimeout(refresh);

      const winners: { id: string; pts: number }[] = [];
      const counts = [0, 0, 0, 0];
      for (const [userId, a] of answers) {
        counts[a.choice]!++;
        if (a.choice !== correct) continue;
        const remaining = Math.max(0, seconds * 1000 - (a.at - askedAt)) / (seconds * 1000);
        const pts = 100 + Math.round(50 * remaining);
        scores.set(userId, (scores.get(userId) ?? 0) + pts);
        winners.push({ id: userId, pts });
      }
      winners.sort((a, b) => b.pts - a.pts);

      const verdict = winners.length
        ? `🎯 **${winners.length} of ${answers.size}** got it. Fastest: ${winners.slice(0, 3).map((w) => `<@${w.id}> +${w.pts}`).join(', ')}`
        : answers.size
          ? `😬 Nobody got it right (${answers.size} answered).`
          : '🦗 Nobody answered.';
      await msg
        .edit(
          card({
            color: winners.length ? 0x57f287 : 0xed4245,
            title: q.question,
            body: `-# ${header}\n✅ **${LETTERS[correct]}. ${options[correct]}**\n${verdict}` + (scores.size ? `\n\n**Standings** ${standings(3)}` : ''),
            footer: i < pool.length - 1 ? `${progress(i + 1)} · next question in a moment` : progress(pool.length),
            rows: [buttons(true, counts)],
          }),
        )
        .catch(() => {});

      if (i < pool.length - 1) await sleep(4500, abort.signal);
    }

    const ranking = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranking[0]?.[1] ?? 0;
    deps.store.record(
      interaction.guildId,
      'trivia',
      [...played].map((userId) => {
        const points = scores.get(userId) ?? 0;
        return { userId, points, won: points === top && top > 0 };
      }),
    );

    const stopped = abort.signal.aborted;
    await channel.send(
      card({
        color: 0xfee75c,
        title: stopped ? '🛑 Trivia stopped' : '🏁 Trivia results',
        body: ranking.length
          ? ranking
              .slice(0, 10)
              .map(([id, pts], idx) => `${MEDALS[idx] ?? `**${idx + 1}.**`} <@${id}> · **${pts}** pts`)
              .join('\n')
          : pick(['No points scored this time!', 'Nobody scored. Rematch?']),
        image: ranking.length && !stopped ? sceneImage(bannerScene('TRIVIA CHAMPION', `${top} points`, '#ffd23f'), 'champion', 'Trivia champion', true) : undefined,
      }),
    );
  } finally {
    deps.sessions.end(interaction.channelId);
  }
}

/** Shared `/<game> stop`: the host or a moderator (Manage Server or a mod role) can stop it. */
export async function stopGame(interaction: ChatInputCommandInteraction, deps: Deps, game: string): Promise<void> {
  const active = deps.sessions.get(interaction.channelId);
  if (!active || active.game !== game) {
    await interaction.reply({ content: `There is no ${game} game running in this channel.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (active.ownerId !== interaction.user.id && !isModerator(interaction)) {
    await interaction.reply({ content: 'Only the person who started the game (or a moderator) can stop it.', flags: MessageFlags.Ephemeral });
    return;
  }
  active.stop();
  await interaction.reply({ content: 'Stopping the game…', flags: MessageFlags.Ephemeral });
}
