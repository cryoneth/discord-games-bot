import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { ScoreStore } from '../store.js';
import { pick } from '../util/random.js';
import { openChallenge, opponentOption, recordDuel, type Ending, type Seat } from './duel.js';
import { RPS, rpsWinner, type RpsChoice } from './logic.js';

const COLOR = 0x9b59b6;
const EMOJI: Record<RpsChoice, string> = { rock: '🪨', paper: '📄', scissors: '✂️' };
const ROUND_SECONDS = 60;
const WINS_NEEDED = 2;
const MAX_ROUNDS = 9; // ties don't count, so cap the match length

export const rpsCommand = new SlashCommandBuilder()
  .setName('rps')
  .setDescription('Rock paper scissors: best of 3 against someone, or one round against the bot')
  .setContexts(InteractionContextType.Guild)
  .addUserOption(opponentOption(false));

interface Deps {
  store: ScoreStore;
}

const choiceButtons = (id: string, disabled = false) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    RPS.map((c) =>
      new ButtonBuilder()
        .setCustomId(`${id}:${c}`)
        .setEmoji(EMOJI[c])
        .setLabel(c[0]!.toUpperCase() + c.slice(1))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
    ),
  );

export async function handleRps(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  if (!interaction.options.getUser('opponent')) return playBot(interaction);

  const duel = await openChallenge(interaction, '🪨📄✂️ Rock paper scissors challenge', COLOR);
  if (!duel) return;
  try {
    const players = duel.players;
    const wins = [0, 0];
    const history: string[] = [];
    let ending: Ending = null;

    for (let round = 1; round <= MAX_ROUNDS && !ending; round++) {
      const id = `rps:${Date.now().toString(36)}`;
      const choices: [RpsChoice | null, RpsChoice | null] = [null, null];
      const deadline = Math.floor(Date.now() / 1000) + ROUND_SECONDS;
      const view = (disabled: boolean) => ({
        content: '',
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR)
            .setTitle(`🪨📄✂️ Round ${round} · first to ${WINS_NEEDED}`)
            .setDescription(
              `<@${players[0]}> **${wins[0]}** – **${wins[1]}** <@${players[1]}>\n\n` +
                (history.length ? history.join('\n') + '\n\n' : '') +
                `Pick your move. Nobody can see it until both have chosen. Time's up <t:${deadline}:R>.\n` +
                players.map((p, s) => `${choices[s] ? '✅' : '⏳'} <@${p}>`).join('   '),
            ),
        ],
        components: [choiceButtons(id, disabled)],
      });
      await duel.message.edit(view(false));

      const complete = await new Promise<boolean>((resolve) => {
        const collector = duel.message.createMessageComponentCollector({ componentType: ComponentType.Button, time: ROUND_SECONDS * 1000 });
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
          await btn.reply({ content: `You picked ${EMOJI[choice]} **${choice}**.`, flags: MessageFlags.Ephemeral }).catch(() => {});
          if (choices[0] && choices[1]) collector.stop('both');
          else await duel.message.edit(view(false)).catch(() => {});
        });
        collector.once('end', (_c, reason) => resolve(reason === 'both'));
      });

      if (!complete) {
        const picked = choices.findIndex((c) => c !== null);
        if (picked !== -1) ending = { kind: 'timeout', winner: picked as Seat };
        else {
          await duel.message.edit({ ...view(true), embeds: [new EmbedBuilder().setColor(0x99aab5).setTitle('🪨📄✂️ Rock paper scissors').setDescription('Nobody picked in time. Match abandoned.')] }).catch(() => {});
          return;
        }
        break;
      }

      const [a, b] = choices as [RpsChoice, RpsChoice];
      const w = rpsWinner(a, b);
      if (w) wins[w - 1]!++;
      history.push(`R${round}: ${EMOJI[a]} vs ${EMOJI[b]} → ${w ? `<@${players[w - 1]}>` : 'tie'}`);
      if (wins[0]! >= WINS_NEEDED) ending = { kind: 'win', winner: 0 };
      else if (wins[1]! >= WINS_NEEDED) ending = { kind: 'win', winner: 1 };
    }

    if (!ending) ending = wins[0] === wins[1] ? { kind: 'draw' } : { kind: 'win', winner: wins[0]! > wins[1]! ? 0 : 1 };
    const summary =
      ending.kind === 'draw'
        ? "🤝 Too many ties. It's a draw!"
        : ending.kind === 'timeout'
          ? `⏰ <@${players[1 - ending.winner]}> didn't pick in time. <@${players[ending.winner]}> wins!`
          : `🏆 <@${players[ending.winner]}> wins the match!`;
    await duel.message
      .edit({
        content: '',
        embeds: [
          new EmbedBuilder()
            .setColor(0xfee75c)
            .setTitle('🪨📄✂️ Rock paper scissors')
            .setDescription(`<@${players[0]}> **${wins[0]}** – **${wins[1]}** <@${players[1]}>\n\n${history.join('\n')}\n\n${summary}`),
        ],
        components: [],
      })
      .catch(() => {});
    recordDuel(deps.store, interaction.guildId, 'rps', players, ending);
  } finally {
    duel.release();
  }
}

/** A single round against the bot. Pure luck, so it isn't scored. */
async function playBot(interaction: ChatInputCommandInteraction): Promise<void> {
  const id = `rpsbot:${Date.now().toString(36)}`;
  const reply = await interaction.reply({
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle('🪨📄✂️ Rock paper scissors vs the bot').setDescription(`<@${interaction.user.id}>, pick your move!`)],
    components: [choiceButtons(id)],
    withResponse: true,
  });
  const msg = reply.resource?.message;
  if (!msg) return;
  try {
    const btn = await msg.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: ROUND_SECONDS * 1000,
      filter: (b) => b.customId.startsWith(`${id}:`) && b.user.id === interaction.user.id,
    });
    const mine = btn.customId.slice(id.length + 1) as RpsChoice;
    if (!RPS.includes(mine)) return;
    const bot = pick(RPS);
    const w = rpsWinner(mine, bot);
    const verdict = w === 0 ? "🤝 It's a tie!" : w === 1 ? '🏆 You win!' : '🤖 The bot wins!';
    await btn.update({
      embeds: [
        new EmbedBuilder()
          .setColor(w === 1 ? 0x57f287 : w === 2 ? 0xed4245 : 0x99aab5)
          .setTitle('🪨📄✂️ Rock paper scissors vs the bot')
          .setDescription(`<@${interaction.user.id}> ${EMOJI[mine]} vs ${EMOJI[bot]} 🤖\n\n${verdict}`),
      ],
      components: [],
    });
  } catch {
    await interaction.editReply({ components: [choiceButtons(id, true)] }).catch(() => {});
  }
}
