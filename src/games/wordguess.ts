import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  InteractionContextType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { ScoreStore } from '../store.js';
import { pick } from '../util/random.js';
import { VALID_GUESSES } from './data/dictionary.js';
import { ANSWERS } from './data/fiveletter.js';
import { scoreGuess, type LetterScore } from './logic.js';
import type { ChannelSessions } from './sessions.js';
import { stopGame } from './trivia.js';

const COLOR = 0x1abc9c;
const GAME_MINUTES = 10;
const TILE: Record<LetterScore, string> = { hit: '🟩', near: '🟨', miss: '⬛' };

export const wordguessCommand = new SlashCommandBuilder()
  .setName('wordguess')
  .setDescription('Team up (or race) to guess a secret five-letter word')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('start')
      .setDescription('Start a word puzzle in this channel')
      .addIntegerOption((o) => o.setName('guesses').setDescription('Shared guesses for the whole channel (4–12, default 8)').setMinValue(4).setMaxValue(12)),
  )
  .addSubcommand((s) => s.setName('stop').setDescription('Stop the word puzzle in this channel'));

interface Deps {
  store: ScoreStore;
  sessions: ChannelSessions;
}

interface Guess {
  word: string;
  userId: string;
  score: LetterScore[];
}

export async function handleWordguess(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  if (interaction.options.getSubcommand() === 'stop') return stopGame(interaction, deps, 'wordguess');

  const maxGuesses = interaction.options.getInteger('guesses') ?? 8;
  const answer = pick(ANSWERS);
  const abort = new AbortController();
  if (!deps.sessions.start(interaction.channelId, { game: 'wordguess', ownerId: interaction.user.id, stop: () => abort.abort() })) {
    await interaction.reply({ content: 'A game is already running in this channel.', flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    const id = `wordguess:${Date.now().toString(36)}`;
    const guesses: Guess[] = [];
    let winner: string | null = null;
    let over = false;
    const endsAt = Math.floor(Date.now() / 1000) + GAME_MINUTES * 60;

    const view = () => {
      const lines = guesses.map((g) => `${g.score.map((s) => TILE[s]).join('')}  \`${g.word.toUpperCase()}\`  <@${g.userId}>`);
      const absent = [...new Set(guesses.flatMap((g) => [...g.word].filter((ch) => !answer.includes(ch))))].sort();
      let status: string;
      if (winner) status = `🎉 <@${winner}> solved it in ${guesses.length} guess${guesses.length === 1 ? '' : 'es'}!`;
      else if (over) status = `The word was **${answer.toUpperCase()}**.`;
      else status = `**${maxGuesses - guesses.length}** guesses left · ends <t:${endsAt}:R>\nClick **Guess** to submit a word. Anyone can play!`;
      return {
        embeds: [
          new EmbedBuilder()
            .setColor(winner ? 0x57f287 : over ? 0xed4245 : COLOR)
            .setTitle('🔤 Word guess')
            .setDescription(
              (lines.length ? lines.join('\n') : '⬜⬜⬜⬜⬜') +
                (absent.length && !over ? `\n\nNot in the word: ${absent.map((c) => c.toUpperCase()).join(' ')}` : '') +
                `\n\n${status}`,
            )
            .setFooter({ text: over ? `Host: /wordguess start for another` : '🟩 right spot · 🟨 wrong spot · ⬛ not in the word' }),
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${id}:guess`).setLabel('Guess').setEmoji('✏️').setStyle(ButtonStyle.Primary).setDisabled(over),
          ),
        ],
      };
    };

    const reply = await interaction.reply({ ...view(), withResponse: true });
    const msg = reply.resource?.message;
    if (!msg) throw new Error('Word guess message missing from interaction response');

    await new Promise<void>((resolve) => {
      const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: GAME_MINUTES * 60_000 });
      const onAbort = () => collector.stop('aborted');
      abort.signal.addEventListener('abort', onAbort, { once: true });
      collector.once('end', async () => {
        abort.signal.removeEventListener('abort', onAbort);
        if (!over) {
          over = true;
          await msg.edit(view()).catch(() => {});
        }
        resolve();
      });

      collector.on('collect', async (btn) => {
        if (btn.customId !== `${id}:guess` || over) return;
        const modalId = `${id}:modal:${btn.id}`;
        await btn
          .showModal(
            new ModalBuilder()
              .setCustomId(modalId)
              .setTitle('Word guess')
              .addLabelComponents(
                new LabelBuilder()
                  .setLabel('Your five-letter word')
                  .setTextInputComponent(
                    new TextInputBuilder().setCustomId('word').setStyle(TextInputStyle.Short).setMinLength(5).setMaxLength(5).setRequired(true),
                  ),
              ),
          )
          .catch(() => {});
        const submit = await btn.awaitModalSubmit({ time: 120_000, filter: (m) => m.customId === modalId }).catch(() => null);
        if (!submit) return;

        const word = submit.fields.getTextInputValue('word').trim().toLowerCase();
        const nope = (content: string) => submit.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
        if (over) return nope('This puzzle is already over.');
        if (!/^[a-z]{5}$/.test(word)) return nope('Guesses must be exactly five letters (A–Z).');
        if (!VALID_GUESSES.has(word)) return nope(`**${word.toUpperCase()}** isn't in my word list. Try another word (this didn't use up a guess).`);
        if (guesses.some((g) => g.word === word)) return nope(`**${word.toUpperCase()}** was already guessed.`);

        const score = scoreGuess(word, answer);
        guesses.push({ word, userId: submit.user.id, score });
        if (word === answer) winner = submit.user.id;
        if (winner || guesses.length >= maxGuesses) over = true;

        if (submit.isFromMessage()) await submit.update(view()).catch(() => {});
        else await msg.edit(view()).catch(() => {});
        if (over) collector.stop('done');
      });
    });

    // Everyone who guessed gets a little for playing; the solver gets a bonus for each unused guess.
    const players = [...new Set(guesses.map((g) => g.userId))];
    deps.store.record(
      interaction.guildId,
      'wordguess',
      players.map((userId) => ({
        userId,
        points: userId === winner ? 100 + 20 * (maxGuesses - guesses.length) : 10,
        won: userId === winner,
      })),
    );
    if (abort.signal.aborted) await msg.reply({ content: `🛑 Word guess stopped. The word was **${answer.toUpperCase()}**.` }).catch(() => {});
  } finally {
    deps.sessions.end(interaction.channelId);
  }
}
