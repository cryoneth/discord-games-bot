import { fourInARowCommand, tictactoeCommand } from '../games/boardgames.js';
import { royaleCommand } from '../games/royale.js';
import { rpsCommand } from '../games/rps.js';
import { triviaCommand } from '../games/trivia.js';
import { wordguessCommand } from '../games/wordguess.js';
import { wyrCommand } from '../games/wyr.js';
import { drawCommand, leaderboardCommand, privacyCommand, serverDataCommand } from './meta.js';

export const commands = [
  triviaCommand,
  royaleCommand,
  wordguessCommand,
  tictactoeCommand,
  fourInARowCommand,
  rpsCommand,
  wyrCommand,
  drawCommand,
  leaderboardCommand,
  privacyCommand,
  serverDataCommand,
];
