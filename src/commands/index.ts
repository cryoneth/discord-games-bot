import { dotsCommand, fourInARowCommand, gomokuCommand, higherLowerCommand, mancalaCommand, nimCommand, tictactoeCommand } from '../games/boardgames.js';
import { reactionCommand } from '../games/reaction.js';
import { hangmanCommand, numberDuelCommand } from '../games/secretduels.js';
import { royaleCommand } from '../games/royale.js';
import { rpsCommand } from '../games/rps.js';
import { triviaCommand } from '../games/trivia.js';
import { wordguessCommand } from '../games/wordguess.js';
import { wyrCommand } from '../games/wyr.js';
import { drawCommand, leaderboardCommand, playCommand, privacyCommand, serverDataCommand } from './meta.js';

export const commands = [
  triviaCommand,
  royaleCommand,
  wordguessCommand,
  tictactoeCommand,
  fourInARowCommand,
  rpsCommand,
  dotsCommand,
  nimCommand,
  gomokuCommand,
  mancalaCommand,
  higherLowerCommand,
  hangmanCommand,
  numberDuelCommand,
  reactionCommand,
  wyrCommand,
  playCommand,
  drawCommand,
  leaderboardCommand,
  privacyCommand,
  serverDataCommand,
];
