import {
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  InteractionContextType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Message,
} from 'discord.js';
import { wordGridScene } from '../render/boards.js';
import type { ScoreStore } from '../store.js';
import { card, nonce, ROW, sceneImage, type Card } from '../ui/card.js';
import { pick } from '../util/random.js';
import { VALID_GUESSES } from './data/dictionary.js';
import { ANSWERS } from './data/fiveletter.js';
import { scoreGuess, type LetterScore } from './logic.js';
import type { ChannelSessions } from './sessions.js';
import { stopGame } from './trivia.js';

const COLOR = 0x3ecf6e;
const TITLE = '🔤 Word guess';
const GAME_MINUTES = 10;
const PLAY_AGAIN_SECONDS = 120;

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

interface Context {
  channelId: string;
  guildId: string | null;
  hostId: string;
  maxGuesses: number;
}

export async function handleWordguess(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  if (interaction.options.getSubcommand() === 'stop') return stopGame(interaction, deps, 'wordguess');
  const ctx: Context = {
    channelId: interaction.channelId,
    guildId: interaction.guildId,
    hostId: interaction.user.id,
    maxGuesses: interaction.options.getInteger('guesses') ?? 8,
  };
  await runWordGuess(interaction, ctx, deps);
}

/** Starts a puzzle by replying to `trigger` (the slash command, or a Play again click). */
async function runWordGuess(trigger: ChatInputCommandInteraction | ButtonInteraction, ctx: Context, deps: Deps): Promise<void> {
  const { maxGuesses } = ctx;
  const answer = pick(ANSWERS);
  const abort = new AbortController();
  if (!deps.sessions.start(ctx.channelId, { game: 'wordguess', ownerId: ctx.hostId, stop: () => abort.abort() })) {
    await trigger.reply({ content: 'A game is already running in this channel.', flags: MessageFlags.Ephemeral });
    return;
  }

  let msg: Message;
  const guesses: Guess[] = [];
  let winner: string | null = null;
  let locked = true;
  const unlock = () => {
    if (locked) deps.sessions.end(ctx.channelId);
    locked = false;
  };
  try {
    const id = `wordguess:${nonce()}`;
    let over = false;
    const endsAt = Math.floor(Date.now() / 1000) + GAME_MINUTES * 60;
    const solvedRow = () => (winner ? guesses.length - 1 : -1);

    const view = (rows = true): Card => {
      const left = maxGuesses - guesses.length;
      const last = guesses.at(-1);
      let body: string;
      if (winner) body = `🎉 **<@${winner}> solved it in ${guesses.length} guess${guesses.length === 1 ? '' : 'es'}!** The word was **${answer.toUpperCase()}**.`;
      else if (over) {
        const why = abort.signal.aborted ? '🛑 **Game stopped.**' : guesses.length >= maxGuesses ? '😵 **Out of guesses!**' : "⏰ **Time's up!**";
        body = `${why} The word was **${answer.toUpperCase()}**.`;
      }
      else
        body =
          (last ? `<@${last.userId}> tried **${last.word.toUpperCase()}**. ` : 'Anyone can play: click **Guess** to enter a word. ') +
          `**${left}** guess${left === 1 ? '' : 'es'} left · ends <t:${endsAt}:R>`;
      return {
        color: winner ? 0xfee75c : over ? 0xed4245 : COLOR,
        title: TITLE,
        body,
        image: sceneImage(wordGridScene(guesses, maxGuesses, solvedRow()), `grid-${guesses.length}`, 'Word guess board', Boolean(winner)),
        footer: over ? undefined : '🟩 right spot · 🟨 wrong spot · ⬛ not in the word',
        rows: rows && !over ? [ROW().addComponents(new ButtonBuilder().setCustomId(`${id}:guess`).setLabel('Guess').setEmoji('✏️').setStyle(ButtonStyle.Primary))] : [],
      };
    };

    const reply = await trigger.reply({ ...card(view()), withResponse: true });
    if (!reply.resource?.message) throw new Error('Word guess message missing from interaction response');
    msg = reply.resource.message;

    await new Promise<void>((resolve) => {
      const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: GAME_MINUTES * 60_000 });
      const onAbort = () => collector.stop('aborted');
      abort.signal.addEventListener('abort', onAbort, { once: true });
      collector.once('end', () => {
        abort.signal.removeEventListener('abort', onAbort);
        over = true;
        resolve();
      });

      collector.on('collect', async (btn) => {
        if (btn.customId !== `${id}:guess` || over) return;
        const modalId = `${id}:modal:${btn.id}`;
        await btn
          .showModal(
            new ModalBuilder()
              .setCustomId(modalId)
              .setTitle(`Word guess · ${maxGuesses - guesses.length} left`)
              .addLabelComponents(
                new LabelBuilder()
                  .setLabel('Your five-letter word')
                  .setTextInputComponent(
                    new TextInputBuilder().setCustomId('word').setStyle(TextInputStyle.Short).setMinLength(5).setMaxLength(5).setPlaceholder('crane').setRequired(true),
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

        guesses.push({ word, userId: submit.user.id, score: scoreGuess(word, answer) });
        if (word === answer) winner = submit.user.id;
        if (winner || guesses.length >= maxGuesses) {
          // The ending renders an animated GIF; acknowledge first so the click never times out.
          over = true;
          await submit.deferUpdate().catch(() => {});
          collector.stop('done');
          return;
        }
        if (submit.isFromMessage()) await submit.update(card(view())).catch(() => {});
        else await msg.edit(card(view())).catch(() => {});
      });
    });

    // Everyone who guessed gets a little for playing; the solver gets a bonus for each unused guess.
    const players = [...new Set(guesses.map((g) => g.userId))];
    deps.store.record(
      ctx.guildId,
      'wordguess',
      players.map((userId) => ({ userId, points: userId === winner ? 100 + 20 * (maxGuesses - guesses.length) : 10, won: userId === winner })),
    );

    // Final board with a Play again button.
    const finalCard = view(false);
    const againId = `${id}:again`;
    finalCard.rows = [ROW().addComponents(new ButtonBuilder().setCustomId(againId).setLabel('Play again').setEmoji('🔁').setStyle(ButtonStyle.Success))];
    await msg.edit(card(finalCard)).catch(() => {});
    unlock();

    const again = await msg
      .awaitMessageComponent({ componentType: ComponentType.Button, time: PLAY_AGAIN_SECONDS * 1000, filter: (b) => b.customId === againId })
      .catch(() => null);
    finalCard.rows = [];
    void msg.edit(card(finalCard)).catch(() => {});
    if (again) await runWordGuess(again, { ...ctx, hostId: again.user.id }, deps);
  } finally {
    unlock();
  }
}
