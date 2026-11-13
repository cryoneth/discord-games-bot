/** Dev helper: renders every game image to a folder for visual checks. Usage: tsx scripts/preview-images.ts <outDir> */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { winningLine, type Cell } from '../src/games/logic.js';
import { scoreGuess } from '../src/games/logic.js';
import { celebrationGif } from '../src/render/animate.js';
import { bannerScene, fourInARowScene, rpsScene, ticTacToeScene, wordGridScene, type Scene } from '../src/render/boards.js';
import { png } from '../src/render/canvas.js';

const out = process.argv[2] ?? '.';
const save = (name: string, s: Scene, gif = false) => {
  const t0 = performance.now();
  const buf = gif ? celebrationGif(s.draw, s.w, s.h) : png((ctx) => s.draw(ctx, 0), s.w, s.h);
  writeFileSync(join(out, name), buf);
  console.log(name, `${(buf.length / 1024).toFixed(0)} KB`, `${(performance.now() - t0).toFixed(0)} ms`);
};
const b = (s: string) => [...s].map(Number) as Cell[];

save('ttt-mid.png', ticTacToeScene(b('120010200'), 4, []));
const tw = b('111220000');
save('ttt-win.gif', ticTacToeScene(tw, 2, winningLine(tw, 3, 3, 3)), true);

const c4 = b('000000000000000000000000000100000021200012211202122121'.padStart(42, '0').slice(-42));
save('c4-mid.png', fourInARowScene(c4, 7, 6, 30, []));
const c4w: Cell[] = Array(42).fill(0);
for (const [i, v] of [[38, 1], [31, 1], [24, 1], [17, 1], [39, 2], [32, 2], [40, 2], [25, 2], [41, 1], [33, 2]] as const) c4w[i] = v as Cell;
save('c4-win.gif', fourInARowScene(c4w, 7, 6, -1, winningLine(c4w, 7, 6, 4)), true);

const ans = 'crane';
const gs = ['adieu', 'stoop', 'grace', 'crane'].map((word) => ({ word, score: scoreGuess(word, ans) }));
save('word-mid.png', wordGridScene(gs.slice(0, 3), 8, -1));
save('word-win.gif', wordGridScene(gs, 8, 3), true);
save('word-12.png', wordGridScene(gs.slice(0, 2), 12, -1));

save('rps.png', rpsScene('rock', 'scissors', 1));
save('rps-tie.png', rpsScene('paper', 'paper', 0));
save('rps-win.gif', rpsScene('scissors', 'paper', 1), true);
save('banner.gif', bannerScene('LAST ONE STANDING', 'after 7 rounds of chaos', '#ffd23f'), true);
