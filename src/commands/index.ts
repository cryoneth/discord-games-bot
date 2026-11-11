import { royaleCommand } from '../games/royale.js';
import { triviaCommand } from '../games/trivia.js';
import { drawCommand, leaderboardCommand, privacyCommand, serverDataCommand } from './meta.js';

export const commands = [triviaCommand, royaleCommand, drawCommand, leaderboardCommand, privacyCommand, serverDataCommand];
