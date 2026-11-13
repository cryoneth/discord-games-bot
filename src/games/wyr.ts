import {
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
} from 'discord.js';
import { card, nonce, ROW, type Card } from '../ui/card.js';
import { pick } from '../util/random.js';
import { WYR } from './data/wyr.js';

const COLOR = 0xf5b53a;
const TITLE = '🤔 Would you rather…';
const AGAIN_SECONDS = 120;

export const wyrCommand = new SlashCommandBuilder()
  .setName('wouldyourather')
  .setDescription('Post a would-you-rather question for the channel to vote on')
  .setContexts(InteractionContextType.Guild)
  .addIntegerOption((o) => o.setName('seconds').setDescription('How long voting stays open (15–300, default 45)').setMinValue(15).setMaxValue(300));

const bar = (share: number) => {
  const filled = Math.round(share * 14);
  return '█'.repeat(filled) + '░'.repeat(14 - filled);
};

/** Text-bar results for a two-option vote. Exported for tests. */
export function voteSummary(options: readonly [string, string], counts: readonly [number, number]): string {
  const total = counts[0] + counts[1];
  const lead = counts[0] === counts[1] ? -1 : counts[0] > counts[1] ? 0 : 1;
  return options
    .map((opt, i) => {
      const share = total ? counts[i]! / total : 0;
      return `${i ? '🅱️' : '🅰️'} **${opt}**${i === lead ? ' 👑' : ''}\n\`${bar(share)}\` **${Math.round(share * 100)}%** · ${counts[i]} vote${counts[i] === 1 ? '' : 's'}`;
    })
    .join('\n\n');
}

export async function handleWouldYouRather(interaction: ChatInputCommandInteraction): Promise<void> {
  await runPoll(interaction, interaction.options.getInteger('seconds') ?? 45, 0);
}

async function runPoll(trigger: ChatInputCommandInteraction | ButtonInteraction, seconds: number, depth: number): Promise<void> {
  const options = pick(WYR);
  const id = `wyr:${nonce()}`;
  const votes = new Map<string, 0 | 1>(); // in memory only, discarded when voting closes
  const closesAt = Math.floor(Date.now() / 1000) + seconds;

  const counts = (): [number, number] => {
    const c: [number, number] = [0, 0];
    for (const v of votes.values()) c[v]++;
    return c;
  };
  const voteRow = () =>
    ROW().addComponents(
      [0, 1].map((i) =>
        new ButtonBuilder()
          .setCustomId(`${id}:${i}`)
          .setEmoji(i ? '🅱️' : '🅰️')
          .setLabel(options[i]!.slice(0, 80))
          .setStyle(i ? ButtonStyle.Danger : ButtonStyle.Primary),
      ),
    );
  const openCard = (): Card => ({
    color: COLOR,
    title: TITLE,
    body: `🅰️ **${options[0]}**\n*or*\n🅱️ **${options[1]}**\n\n🗳️ **${votes.size}** vote${votes.size === 1 ? '' : 's'} so far · results <t:${closesAt}:R>`,
    footer: 'Votes are anonymous. You can change yours until it closes.',
    rows: [voteRow()],
  });
  const closedCard = (rows: Card['rows']): Card => ({
    color: COLOR,
    title: TITLE,
    body: votes.size ? voteSummary(options, counts()) : `🅰️ **${options[0]}**\n*or*\n🅱️ **${options[1]}**\n\nNobody voted this time.`,
    footer: 'Voting closed · votes were anonymous and are not stored',
    rows,
  });

  const reply = await trigger.reply({ ...card(openCard()), withResponse: true });
  const msg = reply.resource?.message;
  if (!msg) return;

  // Refresh the vote count at most every 3 seconds to stay well inside edit rate limits.
  let refresh: NodeJS.Timeout | null = null;
  let closed = false;
  const scheduleRefresh = () => {
    if (refresh || closed) return;
    refresh = setTimeout(() => {
      refresh = null;
      if (!closed) msg.edit(card(openCard())).catch(() => {});
    }, 3000);
  };

  await new Promise<void>((resolve) => {
    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: seconds * 1000 });
    collector.on('collect', async (btn) => {
      if (!btn.customId.startsWith(`${id}:`)) return;
      const choice = btn.customId.endsWith(':1') ? 1 : 0;
      const changed = votes.has(btn.user.id) && votes.get(btn.user.id) !== choice;
      votes.set(btn.user.id, choice);
      await btn
        .reply({ content: `${changed ? 'Changed your vote to' : 'You voted'} ${choice ? '🅱️' : '🅰️'} **${options[choice]}**.`, flags: MessageFlags.Ephemeral })
        .catch(() => {});
      scheduleRefresh();
    });
    collector.once('end', () => resolve());
  });
  closed = true;
  if (refresh) clearTimeout(refresh);

  const againId = `${id}:again`;
  const allowAgain = depth < 20;
  await msg
    .edit(card(closedCard(allowAgain ? [ROW().addComponents(new ButtonBuilder().setCustomId(againId).setLabel('Ask another').setEmoji('🔁').setStyle(ButtonStyle.Success))] : [])))
    .catch(() => {});
  if (!allowAgain) return;
  const again = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: AGAIN_SECONDS * 1000, filter: (b) => b.customId === againId }).catch(() => null);
  void msg.edit(card(closedCard([]))).catch(() => {});
  votes.clear();
  if (again) await runPoll(again, seconds, depth + 1);
}
