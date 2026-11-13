import {
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type Message,
} from 'discord.js';
import { rpsScene } from '../render/boards.js';
import type { ScoreStore } from '../store.js';
import { card, nonce, ROW, sceneImage, type Card, type Image } from '../ui/card.js';
import { pick, sleep } from '../util/random.js';
import { opponentOption, runDuel, type DuelGame, type Ending, type Seat } from './duel.js';
import { RPS, rpsWinner, type RpsChoice } from './logic.js';

const COLOR = 0xb46cff;
const TITLE = '🪨📄✂️ Rock paper scissors';
const EMOJI: Record<RpsChoice, string> = { rock: '🪨', paper: '📄', scissors: '✂️' };
const ROUND_SECONDS = 60;
const WINS_NEEDED = 2;
const MAX_ROUNDS = 9; // ties don't count, so cap the match length

export const rpsCommand = new SlashCommandBuilder()
  .setName('rps')
  .setDescription('Rock paper scissors: best of 3 against someone, or quick rounds against the bot')
  .setContexts(InteractionContextType.Guild)
  .addUserOption(opponentOption(false));

interface Deps {
  store: ScoreStore;
}

const label = (c: RpsChoice) => c[0]!.toUpperCase() + c.slice(1);

const choiceRow = (id: string) =>
  ROW().addComponents(RPS.map((c) => new ButtonBuilder().setCustomId(`${id}:${c}`).setEmoji(EMOJI[c]).setLabel(label(c)).setStyle(ButtonStyle.Primary)));

/** Two quick edits that build suspense before the reveal. */
async function suspense(edit: (c: Card) => Promise<unknown>, body: string): Promise<void> {
  await edit({ color: COLOR, title: TITLE, body: `${body}\n\n# ✊ 3…` });
  await sleep(700);
  await edit({ color: COLOR, title: TITLE, body: `${body}\n\n# ✊ 3… 2… 1…` });
  await sleep(700);
}

const RPS_DUEL: DuelGame = {
  id: 'rps',
  title: TITLE,
  color: COLOR,
  async play(message: Message, players: [string, string]) {
    const wins = [0, 0];
    const history: string[] = [];
    let ending: Ending = null;
    let lastImage: Image | null = null;
    let lastRound: { a: RpsChoice; b: RpsChoice; w: 0 | 1 | 2 } | null = null;
    const score = () => `<@${players[0]}> **${wins[0]}** – **${wins[1]}** <@${players[1]}>`;
    const edit = (c: Card) => message.edit(card(c)).catch(() => {});

    for (let round = 1; round <= MAX_ROUNDS && !ending; round++) {
      const id = `rps:${nonce()}`;
      const choices: [RpsChoice | null, RpsChoice | null] = [null, null];
      const deadline = Math.floor(Date.now() / 1000) + ROUND_SECONDS;
      const pickCard = (): Card => ({
        color: COLOR,
        title: `${TITLE} · Round ${round}`,
        body:
          `${score()} · first to ${WINS_NEEDED}\n` +
          `Pick your move. It stays hidden until you've both chosen. Time's up <t:${deadline}:R>\n` +
          players.map((p, s) => `${choices[s] ? '✅' : '⏳'} <@${p}>`).join('   '),
        footer: history.length ? history.join(' · ') : undefined,
        rows: [choiceRow(id)],
      });
      await edit(pickCard());

      const complete = await new Promise<boolean>((resolve) => {
        const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: ROUND_SECONDS * 1000 });
        collector.on('collect', async (btn) => {
          if (!btn.customId.startsWith(`${id}:`)) return;
          const choice = btn.customId.slice(id.length + 1) as RpsChoice;
          const seat = players.indexOf(btn.user.id);
          if (seat === -1 || !RPS.includes(choice)) {
            await btn.reply({ content: "You're not playing in this game.", flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
          }
          if (choices[seat]) {
            await btn.reply({ content: `You already picked ${EMOJI[choices[seat]!]}.`, flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
          }
          choices[seat] = choice;
          await btn.reply({ content: `You picked ${EMOJI[choice]} **${label(choice)}**.`, flags: MessageFlags.Ephemeral }).catch(() => {});
          if (choices[0] && choices[1]) collector.stop('both');
          else await edit(pickCard());
        });
        collector.once('end', (_c, reason) => resolve(reason === 'both'));
      });

      if (!complete) {
        const picked = choices.findIndex((c) => c !== null);
        if (picked === -1) {
          await edit({ color: 0x4e5058, title: TITLE, body: `${score()}\n\nNobody picked in time, so the match was abandoned.` });
          return null;
        }
        ending = { kind: 'timeout', winner: picked as Seat };
        break;
      }

      const [a, b] = choices as [RpsChoice, RpsChoice];
      await suspense(edit, score());
      const w = rpsWinner(a, b);
      if (w) wins[w - 1]!++;
      history.push(`R${round} ${EMOJI[a]}${EMOJI[b]}`);
      if (wins[0]! >= WINS_NEEDED) ending = { kind: 'win', winner: 0 };
      else if (wins[1]! >= WINS_NEEDED) ending = { kind: 'win', winner: 1 };
      lastRound = { a, b, w };
      if (ending) break;

      lastImage = sceneImage(rpsScene(a, b, w), `round-${round}`, `${a} versus ${b}`);
      await edit({
        color: COLOR,
        title: `${TITLE} · Round ${round}`,
        body: `# 💥 Shoot!\n${w ? `**<@${players[w - 1]}> takes the round!**` : '**Tie! Go again.**'}\n${score()}`,
        image: lastImage,
      });
      await sleep(2800);
    }

    if (!ending) ending = wins[0] === wins[1] ? { kind: 'draw' } : { kind: 'win', winner: wins[0]! > wins[1]! ? 0 : 1 };
    const summary =
      ending.kind === 'draw'
        ? "🤝 **Too many ties. It's a draw!**"
        : ending.kind === 'timeout'
          ? `⏰ <@${players[1 - ending.winner]}> didn't pick in time. **<@${players[ending.winner]}> wins!**`
          : `🏆 **<@${players[ending.winner]}> wins the match!**`;
    const image = lastRound
      ? sceneImage(rpsScene(lastRound.a, lastRound.b, lastRound.w), 'final', 'Final round', ending.kind === 'win')
      : undefined;
    const finalCard: Card = { color: 0xfee75c, title: TITLE, body: `${summary}\n${score()}`, image, footer: history.join(' · ') || undefined };
    return { players, ending, final: (extra) => ({ ...finalCard, rows: extra }) };
  },
};

export async function handleRps(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  if (!interaction.options.getUser('opponent')) return playBot(interaction);
  await runDuel(interaction, RPS_DUEL, deps.store);
}

/** Quick rounds against the bot. Pure luck, so they aren't scored. */
async function playBot(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const tally = { you: 0, bot: 0 };
  let id = `rpsbot:${nonce()}`;
  const tallyLine = () => `You **${tally.you}** – **${tally.bot}** 🤖`;
  const pickCard = (): Card => ({ color: COLOR, title: `${TITLE} vs the bot`, body: `<@${userId}>, pick your move!\n${tallyLine()}`, rows: [choiceRow(id)] });

  const reply = await interaction.reply({ ...card(pickCard()), withResponse: true });
  const msg = reply.resource?.message;
  if (!msg) return;

  for (let round = 0; round < 25; round++) {
    let btn: ButtonInteraction;
    try {
      btn = await msg.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: ROUND_SECONDS * 1000,
        filter: (b) => {
          if (b.user.id === userId) return b.customId.startsWith(`${id}:`);
          void b.reply({ content: 'Start your own game with `/rps`!', flags: MessageFlags.Ephemeral }).catch(() => {});
          return false;
        },
      });
    } catch {
      // Timed out: just drop the buttons.
      await msg.edit(card({ color: 0x4e5058, title: `${TITLE} vs the bot`, body: `Thanks for playing!\n${tallyLine()}` })).catch(() => {});
      return;
    }

    const action = btn.customId.slice(id.length + 1);
    if (action === 'stop') {
      await btn.update(card({ color: 0x4e5058, title: `${TITLE} vs the bot`, body: `Thanks for playing!\n${tallyLine()}` })).catch(() => {});
      return;
    }
    if (action === 'again') {
      id = `rpsbot:${nonce()}`;
      await btn.update(card(pickCard())).catch(() => {});
      continue;
    }

    const mine = action as RpsChoice;
    if (!RPS.includes(mine)) continue;
    await btn.update(card({ color: COLOR, title: TITLE, body: `${tallyLine()}\n\n# ✊ 3…` })).catch(() => {});
    await sleep(600);
    await msg.edit(card({ color: COLOR, title: TITLE, body: `${tallyLine()}\n\n# ✊ 3… 2… 1…` })).catch(() => {});
    await sleep(600);

    const bot = pick(RPS);
    const w = rpsWinner(mine, bot);
    if (w === 1) tally.you++;
    if (w === 2) tally.bot++;
    const verdict = w === 0 ? "🤝 **It's a tie!**" : w === 1 ? '🏆 **You win!**' : '🤖 **The bot wins!**';
    id = `rpsbot:${nonce()}`;
    await msg
      .edit(
        card({
          color: w === 1 ? 0x57f287 : w === 2 ? 0xed4245 : 0x99aab5,
          title: `${TITLE} vs the bot`,
          body: `# 💥 Shoot!\n${verdict}\n${tallyLine()}`,
          image: sceneImage(rpsScene(mine, bot, w), `vsbot-${round}`, `You: ${mine}, bot: ${bot}`, w === 1),
          footer: 'You (left) vs the bot (right)',
          rows: [
            ROW().addComponents(
              new ButtonBuilder().setCustomId(`${id}:again`).setLabel('Play again').setEmoji('🔁').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(`${id}:stop`).setLabel('Done').setStyle(ButtonStyle.Secondary),
            ),
          ],
        }),
      )
      .catch(() => {});
  }
}
