import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  ComponentType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { JUST_FOR_FUN } from '../shared/protocol.js';
import { card, nonce } from '../ui/card.js';

export const menuCommand = new SlashCommandBuilder()
  .setName('menu')
  .setDescription('Browse every game: how it works, how many can play, and how to start it')
  .setContexts(InteractionContextType.Guild);

type Kind = 'group' | 'duel' | 'voice' | 'info';

export interface GuideEntry {
  id: string;
  name: string;
  kind: Kind;
  /** Short line in the dropdown (max 100 chars). */
  short: string;
  players: string;
  how: string;
  start: string;
}

const VOICE_START = 'Join a voice channel, then use `/play` (or the Activities button in the call) and pick it from the game list. The host, the first person in, chooses the game.';

/** Everything `/menu` can show. Exported for tests (Discord allows 25 dropdown options). */
export const GUIDE: GuideEntry[] = [
  // ── Group games in chat ──
  { id: 'trivia', name: 'Trivia', kind: 'group', short: 'Multiple-choice questions for the whole channel', players: 'Any number of players', how: 'Answer each question with the buttons. Faster correct answers score more. Choose a category, the number of questions and the time per question.', start: '`/trivia start` · options: `questions`, `category`, `seconds`' },
  { id: 'royale', name: 'Battle royale', kind: 'group', short: 'Join, then watch the chaos until one player is left', players: '2–100 players', how: 'Click Join in the lobby. The bot narrates wild rounds of eliminations (and the odd comeback) until one player is left standing.', start: '`/royale start` · option: `join_seconds`' },
  { id: 'laststanding', name: 'Last One Standing', kind: 'group', short: 'Call the coin, card, die or door. Wrong calls are out', players: '2–250 players', how: 'Every round everyone secretly calls a coin flip, card colour, die, number or trap door. Wrong calls and anyone who doesn’t pick in time are out. Last player left wins.', start: '`/laststanding start` · options: `join_seconds`, `seconds`' },
  { id: 'minority', name: 'Minority Wins', kind: 'group', short: 'Only the least popular answer survives', players: '3–250 players', how: 'Each round asks a question with no right answer. Vote in secret: only the players who picked the least popular answer survive. A tie keeps everyone in. The final two share the win.', start: '`/minority start` · options: `join_seconds`, `seconds`' },
  { id: 'wordguess', name: 'Word guess', kind: 'group', short: 'The channel shares guesses to find a five-letter word', players: 'Any number of players', how: 'Everyone shares one set of guesses to find a secret five-letter word. Green is the right letter in the right spot, yellow is in the word but elsewhere.', start: '`/wordguess start` · option: `guesses`' },
  { id: 'wouldyourather', name: 'Would you rather', kind: 'group', short: 'An anonymous two-option vote', players: 'Any number of players', how: 'Vote for one of two options. Votes are anonymous and you can change yours until it closes. Then see how the channel split.', start: '`/wouldyourather` · option: `seconds`' },
  // ── Duels ──
  { id: 'tictactoe', name: 'Tic-tac-toe', kind: 'duel', short: 'Classic three in a row', players: '2 players', how: 'Take turns placing X and O on a 3×3 grid. Three in a row wins.', start: '`/tictactoe opponent:@someone`' },
  { id: 'fourinarow', name: 'Four in a row', kind: 'duel', short: 'Drop discs and connect four', players: '2 players', how: 'Drop discs into a 7×6 board. First to connect four in any direction wins.', start: '`/fourinarow opponent:@someone`' },
  { id: 'fiveinarow', name: 'Five in a row', kind: 'duel', short: 'Get five stones in a line on a 9×9 board', players: '2 players', how: 'Place stones on a 9×9 board (pick a row letter, then a column). First to five in a row wins.', start: '`/fiveinarow opponent:@someone`' },
  { id: 'dotsandboxes', name: 'Dots and boxes', kind: 'duel', short: 'Draw lines, close boxes, go again', players: '2 players', how: 'Draw lines on a 3×3 grid of boxes (pick a box, then a side). Close a box to score it and take another turn. Most boxes wins.', start: '`/dotsandboxes opponent:@someone`' },
  { id: 'matchsticks', name: 'Matchsticks', kind: 'duel', short: 'Take 1–3 sticks. Don’t take the last one', players: '2 players', how: 'Take 1, 2 or 3 sticks from a pile of 15–23. Whoever takes the last stick loses.', start: '`/matchsticks opponent:@someone`' },
  { id: 'mancala', name: 'Mancala', kind: 'duel', short: 'Sow seeds around the board', players: '2 players', how: 'Sow seeds around the board. Your last seed in your store gives a free turn, and landing in an empty pit captures the pit opposite. Most seeds wins.', start: '`/mancala opponent:@someone`' },
  { id: 'higherlower', name: 'Higher or lower', kind: 'duel', short: 'Call whether the next card is higher or lower', players: '2 players', how: 'Take turns calling whether the next card is higher or lower. A same-rank card is safe. One wrong call loses.', start: '`/higherlower opponent:@someone`' },
  { id: 'hangman', name: 'Hangman duel', kind: 'duel', short: 'Hide a word for each other and guess letters', players: '2 players', how: 'Each player hides a word for the other (or gets a random one). Take turns guessing letters or the whole word. Six misses and you hang.', start: '`/hangman opponent:@someone`' },
  { id: 'numberduel', name: 'Number duel', kind: 'duel', short: 'Find the other player’s hidden number first', players: '2 players', how: 'Each player hides a number from 1 to 100, then you take turns guessing with higher/lower hints. Equal turns, so the second player can still draw level.', start: '`/numberduel opponent:@someone`' },
  { id: 'reaction', name: 'Reaction duel', kind: 'duel', short: 'Click first when the button turns green', players: '2 players', how: 'Wait for the button to turn green, then click first. Clicking early loses the round. First to 2 wins.', start: '`/reaction opponent:@someone`' },
  { id: 'rps', name: 'Rock paper scissors', kind: 'duel', short: 'Best of 3, or quick rounds against the bot', players: '1–2 players', how: 'Pick in secret, then reveal. Best of 3 against a person, or quick rounds against the bot (those don’t count for the leaderboard).', start: '`/rps opponent:@someone`, or `/rps` to play the bot' },
  // ── Voice channel (Activity) ──
  { id: 'sketch', name: 'Sketch Party', kind: 'voice', short: 'One player draws, everyone else guesses', players: '2–16 players', how: 'Take turns drawing a secret word while everyone races to guess it in the chat. The host sets the length: a time limit, a target score or a number of rounds.', start: VOICE_START },
  { id: 'oddoneout', name: 'Odd One Out', kind: 'voice', short: 'Everyone shares a word except one player', players: '3–12 players', how: 'Everyone gets the same secret word except one player, who gets a similar one and doesn’t know it. Give clues in turn, then vote out the odd one. A caught odd one can steal points by guessing the real word.', start: VOICE_START },
  { id: 'forbidden', name: 'Forbidden Words', kind: 'voice', short: 'Describe the word without the banned words', players: '4–16 players', how: 'Two teams. The describer explains a word without saying five banned words, by voice or typed clues. Teammates guess while the other team watches for slips.', start: VOICE_START },
  { id: 'quiz', name: 'Quiz Arena', kind: 'voice', short: 'Live quizzes, and you can write your own', players: '1–16 players', how: 'Fast multiple-choice quizzes with speed scoring and streaks. Play a built-in quiz or write your own in the editor; it’s saved for everyone on this server.', start: VOICE_START },
  { id: 'market', name: 'Perp Arena', kind: 'voice', short: 'A trading simulator with play money', players: '1–16 players', how: 'Trade a fictional token with play money: long or short with leverage, funding, liquidations and yield farms. Ends with a personal debrief.', start: VOICE_START },
  { id: 'massreaction', name: 'Mass Reaction', kind: 'voice', short: 'Tap when it turns green. Built for big crowds', players: '2–100 players', how: 'The pad turns red, then green at a random moment. Tap too early, miss it, or be among the slowest and you’re out. Last one left wins.', start: VOICE_START },
  // ── Info ──
  { id: 'rules', name: 'Leaderboards & house rules', kind: 'info', short: 'How scoring works, and who can do what', players: '', how: '', start: '' },
];

const KIND_LABEL: Record<Kind, string> = { group: 'Group game in chat', duel: 'Duel in chat', voice: 'Voice channel game', info: '' };

function overview(): string {
  const list = (kind: Kind) => GUIDE.filter((g) => g.kind === kind).map((g) => g.name).join(' · ');
  return [
    'Pick a game from the list below to see how it works and how to start it.',
    '',
    '**Group games in chat** (anyone can start one, everyone joins with buttons)',
    list('group'),
    '',
    '**Duels** (challenge someone)',
    list('duel'),
    '',
    '**Voice channel games** (`/play` in a voice channel)',
    list('voice'),
  ].join('\n');
}

function rulesText(): string {
  return [
    '**Leaderboards**',
    '`/leaderboard` shows Today, This week, This month or All time, for all games or one game. Boards show positions, wins and games played.',
    '',
    '**Fair play**',
    '• Play fair, and be kind in clues, quizzes and chat.',
    '',
    '**Who can do what**',
    '• Everyone can start and join any game, and write quizzes in Quiz Arena.',
    '• Only the person who started a game (or a server manager) can stop it.',
    '• Only server managers can delete quizzes or the server’s data.',
    '• `/privacy` lets you see or delete your own records.',
  ].join('\n');
}

/** "`/trivia start` · options: `a`, `b`" → command on one line, options on the next. */
function startText(start: string): string {
  const [command, options] = start.split(/ · options?: /);
  return options ? `${command}\nOptions: ${options}` : start;
}

/** The card for one entry (or the overview). Exported for tests. */
export function guideCard(id: string | null) {
  const g = id ? GUIDE.find((e) => e.id === id) : undefined;
  if (!g) return { title: '🎮 Game menu', body: overview() };
  if (g.kind === 'info') return { title: g.name, body: rulesText() };
  return {
    title: g.name,
    body: [`-# ${KIND_LABEL[g.kind]} · ${g.players}`, '**How it works**', g.how, '', '**How to start**', startText(g.start)].join('\n'),
  };
}

function dropdown(id: string, selected: string | null) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(id)
      .setPlaceholder('Pick a game to learn more…')
      .addOptions(
        { label: 'Overview', value: 'overview', description: 'All games at a glance', default: selected === null },
        ...GUIDE.map((g) => ({
          label: g.name,
          value: g.id,
          description: (g.kind === 'info' ? g.short : `${KIND_LABEL[g.kind]} · ${g.short}`).slice(0, 100),
          default: g.id === selected,
        })),
      ),
  );
}

const MENU_MINUTES = 10;

export async function handleMenu(interaction: ChatInputCommandInteraction): Promise<void> {
  const id = `menu:${nonce()}`;
  const view = (selected: string | null, open = true) => {
    const c = guideCard(selected);
    return card({ color: 0x5865f2, title: c.title, body: c.body, footer: `${JUST_FOR_FUN} · /help for the rules on one page`, rows: open ? [dropdown(id, selected)] : [] });
  };
  const reply = await interaction.reply({ ...view(null), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, withResponse: true });
  const message = reply.resource?.message;
  if (!message) return;

  let selected: string | null = null;
  const collector = message.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: MENU_MINUTES * 60_000 });
  collector.on('collect', async (pick) => {
    if (pick.customId !== id) return;
    const value = pick.values[0] ?? 'overview';
    selected = value === 'overview' ? null : value;
    await pick.update(view(selected)).catch(() => {});
  });
  collector.once('end', () => {
    // Drop the dropdown once it stops responding, so it never looks broken.
    void interaction.editReply(view(selected, false)).catch(() => {});
  });
}
