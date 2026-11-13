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
import { pick } from '../util/random.js';
import { WYR } from './data/wyr.js';

const COLOR = 0xe67e22;

export const wyrCommand = new SlashCommandBuilder()
  .setName('wouldyourather')
  .setDescription('Post a would-you-rather question for the channel to vote on')
  .setContexts(InteractionContextType.Guild)
  .addIntegerOption((o) => o.setName('seconds').setDescription('How long voting stays open (15–300, default 45)').setMinValue(15).setMaxValue(300));

const bar = (share: number) => {
  const filled = Math.round(share * 12);
  return '█'.repeat(filled) + '░'.repeat(12 - filled);
};

/** Text-bar results for a two-option vote. Exported for tests. */
export function voteSummary(options: readonly [string, string], counts: readonly [number, number]): string {
  const total = counts[0] + counts[1];
  return options
    .map((opt, i) => {
      const share = total ? counts[i]! / total : 0;
      return `**${i ? '🅱️' : '🅰️'} ${opt}**\n\`${bar(share)}\` ${Math.round(share * 100)}% (${counts[i]})`;
    })
    .join('\n\n');
}

export async function handleWouldYouRather(interaction: ChatInputCommandInteraction): Promise<void> {
  const seconds = interaction.options.getInteger('seconds') ?? 45;
  const options = pick(WYR);
  const id = `wyr:${Date.now().toString(36)}`;
  const votes = new Map<string, 0 | 1>(); // in memory only, discarded when voting closes
  const closesAt = Math.floor(Date.now() / 1000) + seconds;

  const embed = (closed: boolean) => {
    const counts: [number, number] = [0, 0];
    for (const v of votes.values()) counts[v]++;
    return new EmbedBuilder()
      .setColor(COLOR)
      .setTitle('🤔 Would you rather…')
      .setDescription(
        closed
          ? voteSummary(options, counts)
          : `🅰️ **${options[0]}**\n\n*or*\n\n🅱️ **${options[1]}**\n\n${votes.size} vote${votes.size === 1 ? '' : 's'} so far · results <t:${closesAt}:R>`,
      )
      .setFooter({ text: closed ? 'Voting closed · votes are anonymous and not stored' : 'Votes are anonymous. You can change yours until it closes.' });
  };
  const buttons = (disabled: boolean) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      [0, 1].map((i) =>
        new ButtonBuilder()
          .setCustomId(`${id}:${i}`)
          .setEmoji(i ? '🅱️' : '🅰️')
          .setLabel(options[i]!.slice(0, 80))
          .setStyle(i ? ButtonStyle.Danger : ButtonStyle.Primary)
          .setDisabled(disabled),
      ),
    );

  const reply = await interaction.reply({ embeds: [embed(false)], components: [buttons(false)], withResponse: true });
  const msg = reply.resource?.message;
  if (!msg) return;

  // Refresh the vote count at most every 3 seconds to stay well inside edit rate limits.
  let refresh: NodeJS.Timeout | null = null;
  let closed = false;
  const scheduleRefresh = () => {
    if (refresh || closed) return;
    refresh = setTimeout(() => {
      refresh = null;
      if (!closed) msg.edit({ embeds: [embed(false)] }).catch(() => {});
    }, 3000);
  };

  const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: seconds * 1000 });
  collector.on('collect', async (btn) => {
    if (!btn.customId.startsWith(`${id}:`)) return;
    const choice = btn.customId.endsWith(':1') ? 1 : 0;
    const changed = votes.has(btn.user.id) && votes.get(btn.user.id) !== choice;
    votes.set(btn.user.id, choice);
    await btn.reply({ content: `${changed ? 'Changed your vote to' : 'You voted'} ${choice ? '🅱️' : '🅰️'} **${options[choice]}**.`, flags: MessageFlags.Ephemeral }).catch(() => {});
    scheduleRefresh();
  });
  collector.once('end', async () => {
    closed = true;
    if (refresh) clearTimeout(refresh);
    await msg.edit({ embeds: [embed(true)], components: [buttons(true)] }).catch(() => {});
    votes.clear();
  });
}
