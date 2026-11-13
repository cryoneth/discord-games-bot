import {
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type Message,
} from 'discord.js';
import { bannerScene } from '../render/boards.js';
import type { ScoreStore } from '../store.js';
import { card, nonce, ROW, sceneImage, type Card } from '../ui/card.js';
import { rand, sleep } from '../util/random.js';
import { opponentOption, runDuel, type DuelGame, type Ending, type Seat } from './duel.js';

const COLOR = 0x2ee6c5;
const TITLE = '⚡ Reaction duel';
const WINS_NEEDED = 2;
const MAX_ROUNDS = 7;
const GO_SECONDS = 10;

export const reactionCommand = new SlashCommandBuilder()
  .setName('reaction')
  .setDescription('Challenge someone to a reaction duel: click first when the button turns green')
  .setContexts(InteractionContextType.Guild)
  .addUserOption(opponentOption(true));

interface Deps {
  store: ScoreStore;
}

type RoundResult = { winner: Seat; ms: number | null; falseStart: boolean } | null;

/**
 * One round: a grey "Wait…" button, then after a random delay a green "GO!" one.
 * Clicking early hands the round to the other player.
 */
async function round(message: Message, players: [string, string], header: string, n: number): Promise<RoundResult> {
  const id = `reaction:${nonce()}`;
  const button = (go: boolean) =>
    ROW().addComponents(
      new ButtonBuilder()
        .setCustomId(`${id}:${go ? 'go' : 'wait'}`)
        .setLabel(go ? 'CLICK!' : 'Wait for green…')
        .setEmoji(go ? '🟢' : '⏳')
        .setStyle(go ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
  const wait: Card = { color: 0x4e5058, title: `${TITLE} · Round ${n}`, body: `${header}\n\n# 🔴 Wait for it…\nClick the moment the button turns **green**. Too early and you lose the round!`, rows: [button(false)] };
  await message.edit(card(wait)).catch(() => {});

  const delay = rand(2000, 6000);
  let goSent = 0;
  let goAt = 0;
  return new Promise<RoundResult>((resolve) => {
    const abort = new AbortController();
    const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: delay + GO_SECONDS * 1000 + 3000 });
    let result: RoundResult = null;
    collector.on('collect', async (btn) => {
      if (!btn.customId.startsWith(`${id}:`) || result) return;
      const seat = players.indexOf(btn.user.id) as Seat | -1;
      if (seat === -1) return void (await btn.reply({ content: "You're not playing in this duel.", flags: MessageFlags.Ephemeral }).catch(() => {}));
      await btn.deferUpdate().catch(() => {});
      // Only the wait button can be a false start: the GO button exists only once it's been shown.
      if (btn.customId.endsWith(':wait')) result = { winner: (1 - seat) as Seat, ms: null, falseStart: true };
      else result = { winner: seat, ms: Math.max(0, Date.now() - (goAt || goSent)), falseStart: false };
      abort.abort();
      collector.stop('done');
    });
    collector.once('end', () => {
      abort.abort();
      resolve(result);
    });
    void (async () => {
      await sleep(delay, abort.signal);
      if (abort.signal.aborted) return;
      goSent = Date.now();
      await message.edit(card({ color: 0x57f287, title: `${TITLE} · Round ${n}`, body: `${header}\n\n# 🟢 GO GO GO!`, rows: [button(true)] })).catch(() => {});
      goAt = Date.now();
    })();
  });
}

const REACTION: DuelGame = {
  id: 'reaction',
  title: TITLE,
  color: COLOR,
  async play(message, players) {
    const wins = [0, 0];
    const best: [number | null, number | null] = [null, null];
    const log: string[] = [];
    const score = () => `<@${players[0]}> **${wins[0]}** – **${wins[1]}** <@${players[1]}> · first to ${WINS_NEEDED}`;
    let ending: Ending = null;

    for (let n = 1; n <= MAX_ROUNDS && !ending; n++) {
      const r = await round(message, players, score(), n);
      if (!r) {
        if (n === 1 || wins[0] === wins[1]) {
          await message.edit(card({ color: 0x4e5058, title: TITLE, body: `${score()}\n\nNobody clicked, so the duel was called off.` })).catch(() => {});
          return null;
        }
        ending = { kind: 'timeout', winner: wins[0]! > wins[1]! ? 0 : 1 };
        break;
      }
      wins[r.winner]!++;
      if (r.ms !== null) best[r.winner] = Math.min(best[r.winner] ?? Infinity, r.ms);
      const line = r.falseStart ? `💥 <@${players[1 - r.winner]}> jumped the gun! Round to <@${players[r.winner]}>.` : `⚡ <@${players[r.winner]}> was first, in about **${r.ms} ms**!`;
      log.push(r.falseStart ? `R${n} false start` : `R${n} ${r.ms} ms`);
      if (wins[r.winner]! >= WINS_NEEDED) {
        ending = { kind: 'win', winner: r.winner };
        break;
      }
      await message.edit(card({ color: COLOR, title: `${TITLE} · Round ${n}`, body: `${line}\n${score()}\n\nNext round in a moment…` })).catch(() => {});
      await sleep(2500);
    }
    if (!ending) ending = wins[0] === wins[1] ? { kind: 'draw' } : { kind: 'win', winner: wins[0]! > wins[1]! ? 0 : 1 };

    const winner = ending.kind === 'draw' ? null : ending.winner;
    const fastest = winner === null ? null : best[winner];
    const image =
      winner === null
        ? undefined
        : sceneImage(bannerScene(fastest !== null ? `${fastest} ms` : 'STEADY HANDS', fastest !== null ? 'fastest winning click' : 'won on false starts', '#2ee6c5'), 'reaction', 'Reaction duel result', true);
    const head =
      ending.kind === 'draw'
        ? "🤝 **It's a draw!**"
        : ending.kind === 'timeout'
          ? `⏰ Nobody clicked the last round. **<@${players[ending.winner]}> wins!**`
          : `🏆 **<@${players[ending.winner]}> wins the duel!**`;
    const finalCard: Card = {
      color: 0xfee75c,
      title: TITLE,
      body: `${head}\n${score()}`,
      image,
      footer: `${log.join(' · ')} · times include network lag, so they're approximate`,
    };
    return { players, ending, final: (extra) => ({ ...finalCard, rows: extra }) };
  },
};

export async function handleReaction(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  await runDuel(interaction, REACTION, deps.store);
}
