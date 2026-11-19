/**
 * Perp Arena headlines. Everything here is invented: a fictional token,
 * fictional exchanges and funds, and no real people. Each headline carries a
 * price effect that roughly matches how markets tend to react, including the
 * classics that teach something: buy the rumour / sell the news, fake
 * breakouts, macro surprises, crowded leverage and hacks.
 */
import type { Rng } from './market-engine.js';

export type Tone = 'good' | 'bad' | 'neutral';

export interface Headline {
  text: string;
  tone: Tone;
  /** Range for the total log-return the headline causes. */
  move: [number, number];
  /** Ticks the move is spread over (default 3). */
  over?: number;
  /** Extra volatility afterwards (default 0.002). */
  vol?: number;
  /** Shift in funding pressure: positive means longs get crowded. */
  funding?: number;
  /** Chance the market shrugs and moves the other way instead. */
  fakeout?: number;
}

/** A headline with possible follow-ups a little later. */
export interface Story {
  first: Headline;
  then?: { p: number; h: Headline }[];
}

// ── Fictional cast ─────────────────────────────────────────────────────────

const FILL: Record<string, readonly string[]> = {
  exchange: ['Orbitex', 'BitHarbor', 'Kumo Exchange', 'Novabit', 'Meridian Markets', 'Tidepool'],
  fund: ['Halcyon Capital', 'Redwood Digital', 'Atlas Macro', 'Bluefin Partners', 'Northgate Asset Management'],
  company: ['a top-5 online retailer', 'a global payments network', 'a big airline', 'a major ride-hailing app', 'a popular game studio'],
  chain: ['ZetaBridge', 'the Portal bridge', 'HopLink'],
  pct: ['3', '4', '5', '6', '8'],
  big: ['40', '75', '120', '200', '350'],
  hours: ['2', '3', '4', '6'],
};

/** Fills {exchange}, {fund}, … with names picked from the fictional cast. Same key, same pick within one headline set. */
export function filler(rng: Rng): (text: string) => string {
  const chosen = new Map<string, string>();
  return (text) =>
    text.replace(/\{(\w+)\}/g, (_, k: string) => {
      if (!chosen.has(k)) {
        const pool = FILL[k];
        chosen.set(k, pool ? pool[Math.floor(rng() * pool.length)]! : k);
      }
      return chosen.get(k)!;
    });
}

// ── Everyday headlines: small moves, not always in the direction they sound ─

export const NOISE: Headline[] = [
  // Good-sounding
  { text: '🟢 {exchange} adds ZETA perpetuals with up to 50x leverage', tone: 'good', move: [0.01, 0.025], vol: 0.004, funding: 0.0001 },
  { text: '🟢 ZETA Foundation announces a {pct}% token buyback', tone: 'good', move: [0.015, 0.035] },
  { text: '🟢 {fund} discloses a ${big}M ZETA position', tone: 'good', move: [0.015, 0.03], fakeout: 0.3 },
  { text: '🟢 Network upgrade ships: transaction fees cut by 90%', tone: 'good', move: [0.01, 0.03], fakeout: 0.35 },
  { text: '🟢 Daily active ZETA wallets hit an all-time high', tone: 'good', move: [0.01, 0.02] },
  { text: '🟢 {company} starts accepting ZETA at checkout', tone: 'good', move: [0.015, 0.035] },
  { text: '🟢 Stablecoin deposits on exchanges jump: fresh money is arriving', tone: 'good', move: [0.01, 0.025] },
  { text: '🟢 Whales pull ZETA off exchanges into cold storage', tone: 'good', move: [0.01, 0.02] },
  { text: '🟢 Inflation report comes in cooler than expected', tone: 'good', move: [0.01, 0.025], vol: 0.004 },
  { text: '🟢 Stock markets rally to record highs', tone: 'good', move: [0.008, 0.02] },
  { text: '🟢 ZETA developer activity at a yearly high', tone: 'good', move: [0.005, 0.015], fakeout: 0.4 },
  // Bad-sounding
  { text: '🔴 Regulator opens an inquiry into the ZETA Foundation', tone: 'bad', move: [-0.035, -0.015] },
  { text: '🔴 Whale wallet moves {pct}% of supply to {exchange}', tone: 'bad', move: [-0.03, -0.012] },
  { text: '🔴 Token unlock: {pct}% of supply released to early investors', tone: 'bad', move: [-0.035, -0.015], fakeout: 0.3 },
  { text: '🔴 Network halted for {hours} hours after a consensus bug', tone: 'bad', move: [-0.04, -0.015], vol: 0.004 },
  { text: '🔴 Inflation report comes in hotter than expected', tone: 'bad', move: [-0.025, -0.01], vol: 0.004 },
  { text: '🔴 Stock markets slide: investors dump risky assets', tone: 'bad', move: [-0.025, -0.01] },
  { text: '🔴 ZETA co-founder sells ${big}M of tokens', tone: 'bad', move: [-0.035, -0.015] },
  { text: '🔴 {exchange} pauses ZETA withdrawals for "maintenance"', tone: 'bad', move: [-0.03, -0.01] },
  { text: '🔴 Popular ZETA wallet app hit by an outage', tone: 'bad', move: [-0.015, -0.005], fakeout: 0.4 },
  { text: '🔴 Mining pool with 30% of ZETA blocks goes offline', tone: 'bad', move: [-0.03, -0.01], vol: 0.003 },
  // Could go either way
  { text: '⚪ An influencer posts a rocket emoji about ZETA', tone: 'neutral', move: [-0.01, 0.02] },
  { text: '⚪ ZETA is trending on social media', tone: 'neutral', move: [-0.015, 0.02] },
  { text: '⚪ Analyst: "ZETA could go either way from here"', tone: 'neutral', move: [-0.01, 0.01] },
  { text: '⚪ Open interest hits a record: lots of leverage in the market', tone: 'neutral', move: [-0.01, 0.01], vol: 0.006, funding: 0.00015 },
  { text: '⚪ Quarterly futures expire today: expect choppy trading', tone: 'neutral', move: [-0.01, 0.01], vol: 0.006 },
  { text: '⚪ It\'s the weekend: thin order books make moves sharper', tone: 'neutral', move: [-0.01, 0.01], vol: 0.005 },
  { text: '⚪ ZETA Foundation schedules a "major announcement" for next week', tone: 'neutral', move: [0, 0.02] },
  { text: '⚪ Famous tech billionaire changes their profile picture to the ZETA logo', tone: 'neutral', move: [-0.005, 0.03], vol: 0.004 },
  { text: '⚪ Survey: most traders expect ZETA to go up', tone: 'neutral', move: [-0.015, 0.01], funding: 0.0001 },
  { text: '⚪ Survey: most traders expect ZETA to go down', tone: 'neutral', move: [-0.01, 0.015], funding: -0.0001 },
];

// ── Two-part stories: a rumour, then what really happened ──────────────────

export const STORIES: Story[] = [
  {
    first: { text: '⚪ Rumour: {exchange} is about to list ZETA', tone: 'neutral', move: [0.015, 0.035] },
    then: [
      { p: 0.45, h: { text: '🟢 Confirmed: ZETA goes live on {exchange}', tone: 'good', move: [0.015, 0.04] } },
      // Buy the rumour, sell the news.
      { p: 0.25, h: { text: '⚪ ZETA lists on {exchange}, but traders who bought the rumour cash out', tone: 'neutral', move: [-0.035, -0.015] } },
      { p: 0.3, h: { text: '🔴 {exchange} denies the listing rumour', tone: 'bad', move: [-0.05, -0.025] } },
    ],
  },
  {
    first: { text: '⚪ Report: {fund} is preparing a ZETA investment fund', tone: 'neutral', move: [0.01, 0.025] },
    then: [
      { p: 0.5, h: { text: '🟢 Regulator approves the {fund} ZETA fund', tone: 'good', move: [0.03, 0.06], over: 4, vol: 0.004 } },
      { p: 0.5, h: { text: '🔴 Regulator delays its decision on the {fund} ZETA fund', tone: 'bad', move: [-0.04, -0.015] } },
    ],
  },
  {
    first: { text: '🔴 Unusual outflows spotted on {chain}, the main ZETA bridge', tone: 'bad', move: [-0.025, -0.01], vol: 0.004 },
    then: [
      { p: 0.55, h: { text: '🚨 Confirmed: {chain} hacked for ${big}M', tone: 'bad', move: [-0.07, -0.035], over: 4, vol: 0.006 } },
      { p: 0.45, h: { text: '🟢 False alarm: {chain} says it was a planned migration', tone: 'good', move: [0.015, 0.03] } },
    ],
  },
  {
    first: { text: '🔴 Report: regulator preparing a case against {exchange}', tone: 'bad', move: [-0.025, -0.01] },
    then: [
      { p: 0.5, h: { text: '🔴 Regulator sues {exchange}; users rush to withdraw', tone: 'bad', move: [-0.05, -0.02], vol: 0.004 } },
      { p: 0.5, h: { text: '🟢 {exchange} settles with the regulator for a small fine', tone: 'good', move: [0.015, 0.035] } },
    ],
  },
  {
    first: { text: '⚪ ZETA Foundation teases a "huge partnership"', tone: 'neutral', move: [0.01, 0.03], funding: 0.0001 },
    then: [
      { p: 0.5, h: { text: '🟢 Partnership revealed: {company} builds on ZETA', tone: 'good', move: [0.02, 0.05] } },
      { p: 0.5, h: { text: '🔴 The "huge partnership" is a sticker deal with a minor esports team', tone: 'bad', move: [-0.045, -0.02] } },
    ],
  },
  {
    first: { text: '⚪ Central bank interest rate decision due in a few hours', tone: 'neutral', move: [-0.005, 0.005], vol: 0.005 },
    then: [
      { p: 0.35, h: { text: '🟢 Central bank cuts rates: cheaper money flows into risky assets', tone: 'good', move: [0.02, 0.045], vol: 0.004 } },
      { p: 0.35, h: { text: '🔴 Central bank surprises with a rate hike', tone: 'bad', move: [-0.045, -0.02], vol: 0.004 } },
      { p: 0.3, h: { text: '⚪ Central bank holds rates, as expected. Markets shrug', tone: 'neutral', move: [-0.008, 0.008] } },
    ],
  },
  {
    first: { text: '⚪ A whale wallet wakes up after 5 years of silence', tone: 'neutral', move: [-0.02, -0.005], vol: 0.003 },
    then: [
      { p: 0.5, h: { text: '🔴 The whale sends everything to {exchange} and starts selling', tone: 'bad', move: [-0.05, -0.02] } },
      { p: 0.5, h: { text: '🟢 The whale just moved to a new wallet. Nothing to see', tone: 'good', move: [0.01, 0.025] } },
    ],
  },
  {
    first: { text: '⚪ ZETA team schedules a network upgrade for tomorrow', tone: 'neutral', move: [0.005, 0.02] },
    then: [
      { p: 0.6, h: { text: '🟢 Upgrade goes smoothly: ZETA is faster and cheaper', tone: 'good', move: [0.01, 0.03] } },
      { p: 0.4, h: { text: '🔴 Upgrade botched: network stalls and needs a patch', tone: 'bad', move: [-0.05, -0.02], vol: 0.004 } },
    ],
  },
  {
    first: { text: '⚪ Rumour: {fund} is in trouble after bad bets', tone: 'neutral', move: [-0.02, -0.005] },
    then: [
      { p: 0.5, h: { text: '🔴 {fund} confirms losses and sells its ZETA to cover them', tone: 'bad', move: [-0.06, -0.03], over: 4 } },
      { p: 0.5, h: { text: '🟢 {fund} says it is fine and shows proof of its reserves', tone: 'good', move: [0.01, 0.03] } },
    ],
  },
];

// ── Each scenario's big moments, with several ways they can happen ─────────

export interface KeyEvent {
  /** When in the game, as a fraction of its length. */
  at: number;
  variants: Headline[];
}

export const KEY_EVENTS: Record<'bull' | 'bear' | 'chop' | 'squeeze' | 'crash', KeyEvent[]> = {
  bull: [
    {
      at: 0.35,
      variants: [
        { text: '🔴 A whale takes profit and dumps on the market', tone: 'bad', move: [-0.07, -0.05], over: 4, vol: 0.004 },
        { text: '🔴 Too many longs: overheated funding triggers a flush', tone: 'bad', move: [-0.07, -0.05], over: 4, vol: 0.005, funding: -0.0002 },
        { text: '🔴 Rumours of a regulatory crackdown spook traders', tone: 'bad', move: [-0.07, -0.05], over: 4, vol: 0.004 },
        { text: '🔴 Early investors cash out after the big run', tone: 'bad', move: [-0.07, -0.05], over: 4, vol: 0.004 },
      ],
    },
    {
      at: 0.6,
      variants: [
        { text: '🟢 First ZETA exchange-traded fund approved', tone: 'good', move: [0.1, 0.14], over: 6, vol: 0.006 },
        { text: '🟢 ZETA halving: new supply cut in half from today', tone: 'good', move: [0.1, 0.14], over: 6, vol: 0.006 },
        { text: '🟢 {company} adds ZETA to its balance sheet', tone: 'good', move: [0.1, 0.14], over: 6, vol: 0.006 },
        { text: '🟢 {exchange} opens ZETA trading to its 50 million users', tone: 'good', move: [0.1, 0.14], over: 6, vol: 0.006 },
      ],
    },
  ],
  bear: [
    {
      at: 0.3,
      variants: [
        { text: '🔴 A big lender holding ZETA pauses withdrawals', tone: 'bad', move: [-0.14, -0.1], over: 6, vol: 0.007 },
        { text: '🔴 {exchange} is insolvent: customer withdrawals frozen', tone: 'bad', move: [-0.14, -0.1], over: 6, vol: 0.007 },
        { text: '🔴 Regulator sues the ZETA Foundation', tone: 'bad', move: [-0.14, -0.1], over: 6, vol: 0.007 },
        { text: '🔴 The stablecoin most ZETA traders use loses its $1 peg', tone: 'bad', move: [-0.14, -0.1], over: 6, vol: 0.007 },
      ],
    },
    {
      at: 0.58,
      variants: [
        { text: '🟢 Rescue deal rumoured for the troubled lender', tone: 'good', move: [0.06, 0.08], over: 4 },
        { text: '🟢 Short sellers take profits: relief rally', tone: 'good', move: [0.06, 0.08], over: 4, funding: 0.0001 },
        { text: '🟢 ZETA Foundation promises to cover users\' losses', tone: 'good', move: [0.06, 0.08], over: 4 },
      ],
    },
  ],
  chop: [
    {
      at: 0.3,
      variants: [
        { text: '🟢 Breakout! ZETA clears a key resistance level', tone: 'good', move: [0.04, 0.05], over: 3 },
        { text: '🟢 ZETA pumps on a surprise partnership hint', tone: 'good', move: [0.04, 0.05], over: 3 },
        { text: '🟢 Big buy order spotted: ZETA jumps', tone: 'good', move: [0.04, 0.05], over: 3 },
      ],
    },
    {
      at: 0.65,
      variants: [
        { text: '🔴 Breakdown: ZETA loses support', tone: 'bad', move: [-0.05, -0.04], over: 3 },
        { text: '🔴 Fake breakout: the pump fades and late buyers get trapped', tone: 'bad', move: [-0.05, -0.04], over: 3 },
        { text: '🔴 Big sell order spotted: ZETA slips', tone: 'bad', move: [-0.05, -0.04], over: 3 },
      ],
    },
  ],
  squeeze: [
    {
      at: 0.42,
      variants: [
        { text: '⚪ Short interest hits a record: almost everyone is betting on a fall', tone: 'neutral', move: [-0.015, 0], funding: -0.0002 },
        { text: '⚪ Funding goes deeply negative: shorts are paying to stay short', tone: 'neutral', move: [-0.015, 0], funding: -0.0002 },
      ],
    },
    {
      at: 0.6,
      variants: [
        { text: '🧨 Shorts are getting squeezed: forced buybacks everywhere', tone: 'good', move: [0.18, 0.22], over: 10, vol: 0.01, funding: 0.0003 },
        { text: '🧨 Surprise listing on {exchange} sends shorts scrambling', tone: 'good', move: [0.18, 0.22], over: 10, vol: 0.01, funding: 0.0003 },
        { text: '🧨 A whale market-buys ${big}M and shorts are forced to cover', tone: 'good', move: [0.18, 0.22], over: 10, vol: 0.01, funding: 0.0003 },
      ],
    },
  ],
  crash: [
    {
      at: 0.55,
      variants: [
        { text: '⚪ Leverage at record highs: funding spikes as longs pile in', tone: 'neutral', move: [0, 0.015], funding: 0.0003 },
        { text: '⚪ "This can only go up": euphoria everywhere', tone: 'neutral', move: [0, 0.015], funding: 0.0003 },
      ],
    },
    {
      at: 0.65,
      variants: [
        { text: '💥 Liquidation cascade: ZETA nukes in minutes', tone: 'bad', move: [-0.3, -0.26], over: 8, vol: 0.012, funding: -0.0004 },
        { text: '💥 {exchange} halts withdrawals; panic selling everywhere', tone: 'bad', move: [-0.3, -0.26], over: 8, vol: 0.012, funding: -0.0004 },
        { text: '💥 Price oracle glitch triggers mass liquidations', tone: 'bad', move: [-0.3, -0.26], over: 8, vol: 0.012, funding: -0.0004 },
        { text: '💥 {fund} blows up and dumps all its ZETA at once', tone: 'bad', move: [-0.3, -0.26], over: 8, vol: 0.012, funding: -0.0004 },
      ],
    },
    {
      at: 0.8,
      variants: [
        { text: '🟢 Dip buyers step in after the crash', tone: 'good', move: [0.03, 0.05], over: 4 },
        { text: '🟢 Bargain hunters buy the panic', tone: 'good', move: [0.03, 0.05], over: 4 },
      ],
    },
  ],
};
