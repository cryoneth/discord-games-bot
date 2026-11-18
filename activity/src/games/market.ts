import {
  liquidationPrice,
  MARKET,
  MARKET_OPTIONS,
  positionEquity,
  positionPnl,
  SCENARIO_LABELS,
  simClock,
  type MarketResult,
  type MarketSettings,
  type MarketStateMessage,
  type Side,
  type TickMessage,
  type Vault,
} from '../../../src/shared/market';
import { MAX_CHAT_LENGTH } from '../../../src/shared/protocol';
import { icon, rich } from '../icons';
import { avatar, button, card, Chat, chips, el, money, podium, settingRow, startFooter, topLeft, type Ctx, type View } from '../core';

const pct = (n: number, d = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(d)}%`;
const px = (n: number) => n.toFixed(n >= 100 ? 2 : 3);

/** What each player should take away from their game. */
export function lessons(r: MarketResult): string[] {
  const s = r.stats;
  const pnl = r.equity - MARKET.startCash;
  const out: string[] = [];
  if (s.liquidations) {
    out.push(`💀 Liquidated ${s.liquidations}×. At ${s.maxLeverage}x, a move of about ${(100 / s.maxLeverage).toFixed(1)}% against you wipes the margin. Lower leverage gives a trade room to breathe.`);
  }
  if (s.farmLost > 0) out.push(`🌾 The farm exploit cost you ${money(s.farmLost)}. A sky-high APR usually means sky-high risk: contract bugs, reward tokens that dump, or both.`);
  if (s.funding > 25) out.push(`💸 You paid ${money(s.funding)} in funding. Sitting on the crowded side of a trade costs money every 8 hours.`);
  else if (s.funding < -25) out.push(`💰 You collected ${money(-s.funding)} in funding by taking the side the crowd wasn't on.`);
  if (s.fees > MARKET.startCash * 0.02) out.push(`🧾 Fees ate ${money(s.fees)}. Each open and close costs ${(MARKET.takerFee * 100).toFixed(2)}% of the position size, and leverage multiplies the size.`);
  if (s.maxDrawdown > 0.3) out.push(`📉 At your lowest you were down ${(s.maxDrawdown * 100).toFixed(0)}% from your peak. Losses compound: after −50% you need +100% to get back.`);
  if (s.stopsHit) out.push(`🛑 Your stop-loss closed ${s.stopsHit} trade${s.stopsHit === 1 ? '' : 's'} before ${s.stopsHit === 1 ? 'it' : 'they'} got worse. That's risk management doing its job.`);
  if (s.trades > 0) out.push(`🎯 ${s.wins} of ${s.trades} trade${s.trades === 1 ? ' was' : 's were'} profitable after fees and funding.`);
  if (s.trades === 0 && s.vaultEarned < 1 && s.farmLost === 0) out.push("😴 You didn't trade or farm. Cash can't get liquidated, but it doesn't grow either.");
  if (s.vaultEarned >= 1) out.push(`🏦 Vaults earned you ${money(s.vaultEarned)}${s.farmLost ? ' before the exploit' : ''}.`);
  if (pnl > 0 && !s.liquidations) out.push(`✅ You finished ${money(pnl)} up without getting liquidated.`);
  return out;
}

/** Phone held upright: the trading screen becomes chart + tabs + a sticky Long/Short bar, with the order ticket in a bottom sheet. Keep in sync with games.css. */
const PHONE = '(max-width: 800px) and (min-height: 501px)';

type Tab = 'pos' | 'board' | 'chat' | 'vaults';

export function createMarket(ctx: Ctx): View {
  let root: HTMLElement;
  let state: MarketStateMessage | null = null;
  let tick: TickMessage | null = null;
  let prices: number[] = [];
  let news: { i: number; text: string; tone: string }[] = [];
  const timers: number[] = [];
  let resize: ResizeObserver | null = null;
  const phone = window.matchMedia(PHONE);

  // Order ticket selections (kept between renders).
  let side: Side = 'long';
  let size = 25;
  let leverage = 5;
  let stop = 5;
  let take = 0;

  // Phone-only UI state.
  let tab: Tab = 'pos';
  let unread = 0;
  let sheetOpen = false;

  // Persistent elements.
  const statusEl = el('div', { className: 'pill' });
  const priceEl = el('div', { className: 'hint price' });
  const timerEl = el('div', { className: 'pill timer' });
  const lobbyEl = el('div', { className: 'stage-center market-lobby' });
  const boardEl = el('ol', { className: 'board-list' });
  const canvas = el('canvas', { className: 'chart' });
  const newsEl = el('ul', { className: 'news' });
  const stripEl = el('div', { className: 'mkt-strip' });
  const accountEl = el('div', { className: 'account' });
  const positionEl = el('div', { className: 'position' });
  const noPosEl = el('div', { className: 'no-pos' }, el('strong', { textContent: 'No open position' }), el('span', { textContent: 'Tap Long if you think ZETA will rise, Short if you think it will fall.' }));
  const ticketEl = el('div', { className: 'ticket' });
  const vaultsEl = el('div', { className: 'vaults' });
  const closeBtn = button('Close position', () => ctx.send({ t: 'close' }), 'danger wide');
  const chat = new Chat('Trading floor', (text) => ctx.send({ t: 'chat', text: text.slice(0, MAX_CHAT_LENGTH) }));
  const tradeEl = el('aside', { className: 'panel trade' }, accountEl, positionEl, noPosEl, ticketEl, vaultsEl);

  // Phone tabs under the chart.
  const tabBtns = new Map<Tab, HTMLButtonElement>();
  const boardTabLabel = el('span', { textContent: 'Board' });
  const chatBadge = el('span', { className: 'badge hidden' });
  const tabLabels: Record<Tab, (Node | string)[]> = { pos: ['Position'], board: [boardTabLabel], chat: ['Chat', chatBadge], vaults: ['Vaults'] };
  const tabsEl = el(
    'nav',
    { className: 'm-tabs' },
    ...(Object.keys(tabLabels) as Tab[]).map((k) => {
      const b = el('button', { type: 'button', className: 'm-tab' }, ...tabLabels[k]);
      b.onclick = () => setTab(k);
      tabBtns.set(k, b);
      return b;
    }),
  );

  // Phone action bar: Long/Short when flat, live PnL + Close while in a trade.
  const sideCta = (s: Side) => {
    const b = el('button', { type: 'button', className: `cta ${s}` }, el('span', { className: 'cta-main', textContent: s === 'long' ? '▲ Long' : '▼ Short' }), el('span', { className: 'cta-sub', textContent: s === 'long' ? 'price goes up' : 'price goes down' }));
    b.onclick = () => openSheet(s);
    return b;
  };
  const barPos = el('button', { type: 'button', className: 'bar-pos' });
  barPos.onclick = () => setTab('pos');
  const barClose = button('Close', () => ctx.send({ t: 'close' }), 'danger bar-close');
  const actionEl = el('div', { className: 'm-action' }, el('div', { className: 'flat' }, sideCta('long'), sideCta('short')), el('div', { className: 'open' }, barPos, barClose));

  // Phone bottom sheet that holds the order ticket.
  const sheetBody = el('div', { className: 'sheet-body' });
  const sheetEl = el(
    'div',
    { className: 'sheet', role: 'dialog' },
    el('div', { className: 'sheet-grab' }),
    el('div', { className: 'sheet-head' }, el('span', { textContent: `Trade ${MARKET.asset}` }), button('✕', () => closeSheet(), 'icon sheet-x')),
    sheetBody,
  );
  const backdropEl = el('div', { className: 'sheet-backdrop' });
  backdropEl.onclick = () => closeSheet();

  const gameEl = el(
    'main',
    { className: 'market-grid' },
    el('aside', { className: 'panel leaderboard' }, el('div', { className: 'board-sec' }, el('h2', { textContent: 'Leaderboard' }), boardEl), chat.root),
    el('section', { className: 'panel chart-panel' }, stripEl, el('div', { className: 'chart-wrap' }, canvas), newsEl),
    tabsEl,
    tradeEl,
    actionEl,
  );

  function setTab(t: Tab) {
    tab = t;
    gameEl.dataset.tab = t;
    for (const [k, b] of tabBtns) b.classList.toggle('active', k === t);
    if (t === 'chat') {
      unread = 0;
      chatBadge.classList.add('hidden');
    }
  }

  function openSheet(s: Side) {
    if (tick?.account.position) return;
    side = s;
    sheetOpen = true;
    renderTicket();
    sheetEl.classList.add('open');
    backdropEl.classList.add('open');
  }

  function closeSheet() {
    sheetOpen = false;
    sheetEl.classList.remove('open');
    backdropEl.classList.remove('open');
  }

  /** The ticket lives in the sidebar on wide screens and in the sheet on phones. */
  function placeTicket() {
    if (phone.matches) sheetBody.append(ticketEl);
    else {
      tradeEl.insertBefore(ticketEl, vaultsEl);
      closeSheet();
    }
    drawChart();
  }

  // ── Lobby / results ──────────────────────────────────────────────────────

  function settingsPanel(s: MarketSettings, isHost: boolean) {
    const summary = `${s.minutes} min · ${SCENARIO_LABELS[s.scenario]} · up to ${s.maxLeverage}x`;
    if (!isHost) return el('div', { className: 'settings summary' }, el('span', { className: 'label', textContent: 'Market' }), el('span', {}, ...rich(summary)));
    const update = (patch: Partial<MarketSettings>) => ctx.send({ t: 'settings', settings: { ...s, ...patch } });
    return el(
      'div',
      { className: 'settings' },
      el('div', { className: 'settings-title', textContent: 'Market settings' }),
      settingRow('Market', chips(MARKET_OPTIONS.scenario, s.scenario, (v) => SCENARIO_LABELS[v], true, (scenario) => update({ scenario }))),
      settingRow('Length', chips(MARKET_OPTIONS.minutes, s.minutes, (v) => `${v} min`, true, (minutes) => update({ minutes }))),
      settingRow('Max lev.', chips(MARKET_OPTIONS.maxLeverage, s.maxLeverage, (v) => `${v}x`, true, (maxLeverage) => update({ maxLeverage }))),
    );
  }

  function renderLobby(s: MarketStateMessage) {
    const isHost = s.players.find((p) => p.id === ctx.me())?.host ?? false;
    const connected = s.players.filter((p) => p.connected).length;
    const parts: (Node | null)[] = [];
    if (s.phase === 'finished' && s.results) {
      const ranking = s.results.map((r) => ({ id: r.id, name: r.name, score: Math.round(r.equity) }));
      const mine = s.results.find((r) => r.id === ctx.me());
      parts.push(
        el('div', { className: 'eyebrow' }, ...rich(`Market closed · it was a ${s.scenario ? SCENARIO_LABELS[s.scenario] : 'mystery'}`)),
        el('h1', { textContent: ranking[0] && ranking[0].score > MARKET.startCash ? `${ranking[0].name} wins!` : 'Nobody beat the market' }),
        podium(ranking, ctx.me(), '$'),
      );
      if (mine) {
        const pnl = mine.equity - MARKET.startCash;
        parts.push(
          el(
            'div',
            { className: 'debrief' },
            el('div', { className: 'debrief-head' }, el('span', { textContent: 'Your debrief' }), el('span', { className: pnl >= 0 ? 'up' : 'down', textContent: `${money(mine.equity)} (${pct(pnl / MARKET.startCash)})` })),
            el(
              'div',
              { className: 'stat-grid' },
              ...[
                ['Trades', String(mine.stats.trades)],
                ['Liquidations', String(mine.stats.liquidations)],
                ['Fees', money(mine.stats.fees)],
                ['Funding', money(mine.stats.funding)],
                ['Max drawdown', `${(mine.stats.maxDrawdown * 100).toFixed(0)}%`],
                ['Max leverage', mine.stats.maxLeverage ? `${mine.stats.maxLeverage}x` : '–'],
              ].map(([k, v]) => el('div', {}, el('span', { className: 'k', textContent: k }), el('span', { className: 'v', textContent: v }))),
            ),
            el('ul', { className: 'lessons' }, ...lessons(mine).map((l) => el('li', {}, ...rich(l)))),
          ),
        );
      }
    } else {
      parts.push(
        el('div', { className: 'logo' }, icon('chart')),
        el('h1', { textContent: 'Perp Arena' }),
        el('p', { className: 'sub', textContent: `Trade ${MARKET.asset}, a made-up token, with ${money(MARKET.startCash)} of play money. Highest balance when the market closes wins.` }),
        el(
          'ul',
          { className: 'howto' },
          el('li', { textContent: 'Go long if you think the price will rise, short if you think it will fall. Leverage multiplies gains and losses.' }),
          el('li', { textContent: 'Each position has a liquidation price. Touch it and the margin is gone. Stop-losses can get you out earlier.' }),
          el('li', { textContent: 'Funding settles every 8 simulated hours: when most traders are long, longs pay shorts (and the other way round).' }),
          el('li', { textContent: 'Park cash in SafeLend for a small yield, or ZetaFarm for a huge one, if it doesn’t get hacked.' }),
        ),
      );
    }
    parts.push(
      settingsPanel(s.settings, isHost),
      startFooter({
        isHost,
        connected,
        min: 1,
        hostName: s.players.find((p) => p.host)?.name,
        label: s.phase === 'finished' ? 'New market' : connected === 1 ? 'Open market (solo)' : `Open market · ${connected} traders`,
        onStart: () => ctx.send({ t: 'start' }),
      }),
      el('p', { className: 'sub small', textContent: 'Simulation for learning only. Fictional asset, synthetic prices, no real money, not financial advice.' }),
      ctx.menuButton(),
    );
    lobbyEl.replaceChildren(card(...parts));
  }

  // ── Trading screen ───────────────────────────────────────────────────────

  const summaryEl = el('div', { className: 'summary' });
  let openBtn: HTMLButtonElement | null = null;

  /** What the ticket would open right now, at the current price and cash. */
  function draft() {
    const price = tick?.price ?? MARKET.startPrice;
    const cash = tick?.account.cash ?? MARKET.startCash;
    const margin = (cash * size) / 100 / (1 + leverage * MARKET.takerFee);
    const qty = (margin * leverage) / price;
    const liq = liquidationPrice({ side, entry: price, qty, margin, funding: 0 });
    return { price, margin, notional: margin * leverage, fee: margin * leverage * MARKET.takerFee, liq };
  }

  /** Rebuilds the order ticket controls (only when a selection or the leverage cap changes). */
  function renderTicket() {
    if (!state) return;
    const max = state.settings.maxLeverage;
    if (leverage > max) leverage = max;
    const levs = MARKET.leverages.filter((l) => l <= max);
    const sideBtn = (s: Side) => button(s === 'long' ? '▲ Long' : '▼ Short', () => ((side = s), renderTicket()), `side ${s}${side === s ? ' active' : ''}`);
    openBtn = button('', () => {
      ctx.send({ t: 'open', side, size, leverage, stop, take });
      closeSheet();
    }, `primary ${side}`);
    ticketEl.replaceChildren(
      el('h3', { textContent: 'New position' }),
      el('div', { className: 'sides' }, sideBtn('long'), sideBtn('short')),
      settingRow('Size (share of free cash)', chips(MARKET.sizes, size as (typeof MARKET.sizes)[number], (v) => `${v}%`, true, (v) => ((size = v), renderTicket()))),
      settingRow('Leverage', chips(levs, leverage, (v) => `${v}x`, true, (v) => ((leverage = v), renderTicket()))),
      el(
        'div',
        { className: 'tpsl' },
        settingRow('Stop-loss', chips(MARKET.stops, stop as (typeof MARKET.stops)[number], (v) => (v ? `−${v}%` : 'Off'), true, (v) => ((stop = v), renderTicket()))),
        settingRow('Take profit', chips(MARKET.takes, take as (typeof MARKET.takes)[number], (v) => (v ? `+${v}%` : 'Off'), true, (v) => ((take = v), renderTicket()))),
      ),
      summaryEl,
      openBtn,
    );
    updatePreview();
  }

  /** Live numbers on the ticket; cheap enough to run every tick. */
  function updatePreview() {
    const d = draft();
    const hasPos = Boolean(tick?.account.position);
    const row = (k: string, v: string, cls = '') => el('div', { className: `sum-row ${cls}` }, el('span', { className: 'k', textContent: k }), el('span', { className: 'v', textContent: v }));
    const stopPastLiq = stop > 0 && 100 / leverage <= stop;
    summaryEl.replaceChildren(
      ...(hasPos
        ? [el('div', { className: 'sum-note', textContent: 'Close your position to open a new one.' })]
        : [
            row('Margin', money(d.margin, 2)),
            row('Position size', money(d.notional)),
            row('Liquidation price', `${px(d.liq)} (${pct((d.liq - d.price) / d.price)})`, 'liq'),
            row('Opening fee', money(d.fee, 2)),
            ...(stopPastLiq ? [el('div', { className: 'sum-note warn' }, ...rich('⚠️ Your stop-loss is past the liquidation price, so it will never trigger.'))] : []),
          ]),
    );
    if (openBtn) {
      openBtn.disabled = hasPos || d.margin < MARKET.minMargin;
      openBtn.replaceChildren(...rich(`${side === 'long' ? 'Long' : 'Short'} ${leverage}x · ${money(d.notional)}`));
    }
    if (hasPos && sheetOpen) closeSheet();
  }

  function vaultRow(v: Vault, label: string, apr: string, note: string, amount: number, disabled: boolean) {
    const dep = (n: number) => {
      const b = button(`+${n}%`, () => ctx.send({ t: 'deposit', vault: v, size: n }), 'small');
      b.disabled = disabled;
      return b;
    };
    const w = button('Withdraw', () => ctx.send({ t: 'withdraw', vault: v }), 'small');
    w.disabled = amount < 0.01;
    return el(
      'div',
      { className: `vault ${v}${disabled ? ' dead' : ''}` },
      el('div', { className: 'vault-head' }, el('span', { className: 'vault-name' }, ...rich(label)), el('span', { className: 'apr', textContent: apr })),
      el('div', { className: 'vault-note', textContent: note }),
      el('div', { className: 'vault-row' }, el('span', { className: 'vault-amt', textContent: money(amount, 2) }), dep(25), dep(100), w),
    );
  }

  let lastVaultKey = '';
  function renderAccount() {
    const t = tick;
    if (!t) return;
    const a = t.account;
    const pnl = t.equity - MARKET.startCash;
    const kv = (k: string, v: string) => el('div', {}, el('span', { className: 'k', textContent: k }), el('span', { className: 'v', textContent: v }));
    accountEl.replaceChildren(
      el('div', { className: 'equity' }, el('span', { className: 'k', textContent: 'Balance' }), el('span', { className: 'v', textContent: money(t.equity, 2) }), el('span', { className: `chg ${pnl >= 0 ? 'up' : 'down'}`, textContent: pct(pnl / MARKET.startCash) })),
      el('div', { className: 'acct-grid' }, kv('Free cash', money(a.cash, 2)), kv('In vaults', money(a.lend + a.farm, 2)), kv('In trade', a.position ? money(Math.max(0, positionEquity(a.position, t.price)), 2) : '–')),
    );
    const p = a.position;
    noPosEl.classList.toggle('hidden', Boolean(p));
    actionEl.classList.toggle('has-pos', Boolean(p));
    if (p) {
      const pos = positionPnl(p, t.price) - p.funding;
      const roe = pos / p.margin;
      const dist = Math.abs(t.price - p.liq) / t.price;
      // Share of the starting cushion still left before liquidation.
      const cushion = Math.max(0, Math.min(1, dist / Math.max(1e-9, Math.abs(p.entry - p.liq) / p.entry)));
      const risk = cushion < 0.25 ? 'high' : cushion < 0.5 ? 'mid' : 'low';
      const tone = pos >= 0 ? 'up' : 'down';
      positionEl.classList.remove('hidden');
      positionEl.replaceChildren(
        el('div', { className: `pos-head ${p.side}` }, el('span', { className: `tag ${p.side}`, textContent: `${p.side === 'long' ? '▲ LONG' : '▼ SHORT'} ${p.leverage}x` }), el('span', { className: 'pos-asset', textContent: MARKET.asset })),
        el('div', { className: 'pos-pnl' }, el('span', { className: `big ${tone}`, textContent: money(pos, 2) }), el('span', { className: `roe ${tone}`, textContent: `${pct(roe)} on margin` })),
        el(
          'div',
          { className: `liq-meter ${risk}` },
          el('div', { className: 'liq-label' }, el('span', { textContent: 'Distance to liquidation' }), el('span', { className: 'liq-pct', textContent: `${(dist * 100).toFixed(1)}%` })),
          el('div', { className: 'liq-bar' }, Object.assign(el('span'), { style: `width:${(cushion * 100).toFixed(1)}%` })),
        ),
        el(
          'div',
          { className: 'pos-grid' },
          ...[
            ['Entry', px(p.entry)],
            ['Mark', px(t.price)],
            ['Liquidation', px(p.liq)],
            ['Size', money(p.qty * t.price)],
            ['Funding paid', money(p.funding, 2)],
            ['Stop / target', `${p.stop ? px(p.stop) : '–'} / ${p.take ? px(p.take) : '–'}`],
          ].map(([k, v]) => el('div', {}, el('span', { className: 'k', textContent: k }), el('span', { className: `v${k === 'Liquidation' && dist < 0.02 ? ' danger' : ''}`, textContent: v }))),
        ),
        closeBtn,
      );
      barPos.className = `bar-pos ${p.side}`;
      barPos.replaceChildren(
        el('span', { className: `tag ${p.side}`, textContent: `${p.side === 'long' ? '▲' : '▼'} ${p.leverage}x` }),
        el('span', { className: `bar-pnl ${tone}`, textContent: money(pos, 2) }),
        el('span', { className: `bar-roe ${tone}`, textContent: pct(roe) }),
        el('span', { className: `bar-liq ${risk}`, textContent: `liq ${px(p.liq)}` }),
      );
    } else {
      positionEl.classList.add('hidden');
    }
    // Vault rows contain buttons; only rebuild when something visible changed.
    const key = `${a.lend.toFixed(2)}|${a.farm.toFixed(2)}|${t.farmExploited}|${Math.floor(a.cash)}`;
    if (key !== lastVaultKey) {
      lastVaultKey = key;
      vaultsEl.replaceChildren(
        el('h3', { textContent: 'Yield vaults' }),
        vaultRow('lend', '🏦 SafeLend', `${MARKET.lendApr * 100}% APR`, 'Over-collateralized lending. Boring, steady.', a.lend, false),
        vaultRow('farm', '🌾 ZetaFarm', t.farmExploited ? 'EXPLOITED' : `${MARKET.farmApr * 100}% APR`, t.farmExploited ? 'Drained by an exploit. Withdraw what’s left.' : 'Unaudited, paid in freshly minted tokens.', a.farm, t.farmExploited),
      );
    }
  }

  function renderBoard() {
    const t = tick;
    if (!t) return;
    boardEl.replaceChildren(
      ...t.board.map((b, i) =>
        el(
          'li',
          { className: `${b.id === ctx.me() ? 'me' : ''}${b.connected ? '' : ' offline'}` },
          el('span', { className: 'rank', textContent: String(i + 1) }),
          avatar(b.name),
          el('span', { className: 'name', textContent: b.name }),
          b.side ? el('span', { className: `tag ${b.side}`, textContent: `${b.leverage}x ${b.side === 'long' ? 'L' : 'S'}` }) : null,
          el('span', { className: `eq ${b.equity >= MARKET.startCash ? 'up' : 'down'}`, textContent: money(b.equity) }),
        ),
      ),
    );
    const rank = t.board.findIndex((b) => b.id === ctx.me());
    boardTabLabel.textContent = rank >= 0 && t.board.length > 1 ? `Board #${rank + 1}` : 'Board';
  }

  function renderNews() {
    newsEl.replaceChildren(...news.slice(-4).reverse().map((n) => el('li', { className: n.tone }, el('span', { className: 'when', textContent: simClock(n.i) }), ...rich(n.text))));
  }

  /** Market stats above the chart. */
  function renderStrip() {
    const t = tick;
    if (!t || !prices.length) return;
    const next = MARKET.fundingEveryTicks - (t.i % MARKET.fundingEveryTicks);
    const rate = t.fundingRate;
    const stat = (k: string, v: string, cls = '') => el('div', { className: 'stat' }, el('span', { className: 'k', textContent: k }), el('span', { className: `v ${cls}`, textContent: v }));
    const change = (t.price - MARKET.startPrice) / MARKET.startPrice;
    stripEl.replaceChildren(
      el('div', { className: 'stat main' }, el('span', { className: 'k', textContent: `${MARKET.asset}-PERP` }), el('span', { className: `v ${change >= 0 ? 'up' : 'down'}`, textContent: px(t.price) })),
      stat('Change', pct(change), change >= 0 ? 'up' : 'down'),
      stat('High', px(Math.max(...prices))),
      stat('Low', px(Math.min(...prices))),
      stat('Funding / 8h', `${rate >= 0 ? '' : '−'}${Math.abs(rate * 100).toFixed(3)}%`, rate > 0 ? 'down' : rate < 0 ? 'up' : ''),
      stat('Next funding', `${next * MARKET.hoursPerTick}h`),
      stat('Who pays', rate > 0 ? 'Longs pay' : rate < 0 ? 'Shorts pay' : 'Nobody'),
    );
  }

  function renderTop() {
    if (!state) return;
    const t = tick;
    if (state.phase !== 'running' || !t) {
      statusEl.textContent = state.phase === 'finished' ? 'Closed' : 'Lobby';
      priceEl.textContent = '';
      timerEl.textContent = '';
      return;
    }
    statusEl.textContent = simClock(t.i);
    const change = (t.price - MARKET.startPrice) / MARKET.startPrice;
    priceEl.replaceChildren(
      el('span', { className: 'ticker', textContent: `${MARKET.asset} ` }),
      el('span', { textContent: px(t.price) }),
      el('span', { className: change >= 0 ? 'up' : 'down', textContent: ` ${pct(change)}` }),
      el('span', { className: 'funding', textContent: ` · funding ${(t.fundingRate * 100).toFixed(3)}%/8h` }),
    );
    const left = state.endsAt ? Math.max(0, Math.ceil((state.endsAt - ctx.now()) / 1000)) : 0;
    timerEl.replaceChildren(icon('clock', 'inline'), ` ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
    timerEl.classList.toggle('low', left <= 20);
  }

  // ── Chart ────────────────────────────────────────────────────────────────

  function drawChart() {
    const c2d = canvas.getContext('2d');
    if (!c2d || !state) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    c2d.clearRect(0, 0, w, h);
    if (prices.length < 2) return;
    // The chart grows with the game (at least 2 sim-days wide) rather than squeezing into the full length.
    const total = Math.max(prices.length, 48);
    const pos = tick?.account.position;
    const levels = pos ? [pos.entry, pos.liq, pos.stop, pos.take].filter((v): v is number => v !== null && v > 0) : [];
    let lo = Math.min(...prices);
    let hi = Math.max(...prices);
    // Keep the liquidation line in view when it's close enough to matter.
    for (const l of levels) if (l > lo * 0.85 && l < hi * 1.15) ((lo = Math.min(lo, l)), (hi = Math.max(hi, l)));
    const padY = (hi - lo) * 0.1 || 1;
    lo -= padY;
    hi += padY;
    const right = 56;
    const x = (i: number) => (i / (total - 1)) * (w - right);
    const padTop = 14;
    const padBottom = 10;
    const y = (p: number) => padTop + (1 - (p - lo) / (hi - lo)) * (h - padTop - padBottom);

    // Grid and price labels.
    c2d.font = '11px system-ui, sans-serif';
    c2d.textBaseline = 'middle';
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) * k) / 4;
      c2d.strokeStyle = 'rgba(43,45,66,0.1)';
      c2d.beginPath();
      c2d.moveTo(0, y(v));
      c2d.lineTo(w - right, y(v));
      c2d.stroke();
      c2d.fillStyle = '#6b7088';
      c2d.fillText(px(v), w - right + 6, y(v));
    }

    const last = prices[prices.length - 1]!;
    const up = last >= prices[0]!;
    const line = up ? '#3ba55d' : '#ed4245';
    const grad = c2d.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, up ? 'rgba(59,165,93,0.28)' : 'rgba(237,66,69,0.28)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    c2d.beginPath();
    c2d.moveTo(x(0), y(prices[0]!));
    for (let i = 1; i < prices.length; i++) c2d.lineTo(x(i), y(prices[i]!));
    c2d.strokeStyle = line;
    c2d.lineWidth = 2.5;
    c2d.stroke();
    c2d.lineTo(x(prices.length - 1), h);
    c2d.lineTo(x(0), h);
    c2d.closePath();
    c2d.fillStyle = grad;
    c2d.fill();

    // News markers.
    for (const n of news) {
      if (n.i >= prices.length) continue;
      c2d.fillStyle = n.tone === 'good' ? '#3ba55d' : n.tone === 'bad' ? '#ed4245' : '#a3a6ad';
      c2d.beginPath();
      c2d.arc(x(n.i), y(prices[n.i]!), 4, 0, Math.PI * 2);
      c2d.fill();
    }

    // Position levels.
    const level = (v: number | null, color: string, label: string, dash: number[]) => {
      if (v === null || v < lo || v > hi) return;
      c2d.setLineDash(dash);
      c2d.strokeStyle = color;
      c2d.lineWidth = 1.5;
      c2d.beginPath();
      c2d.moveTo(0, y(v));
      c2d.lineTo(w - right, y(v));
      c2d.stroke();
      c2d.setLineDash([]);
      c2d.fillStyle = color;
      c2d.fillText(label, 6, y(v) - 8);
    };
    if (pos) {
      level(pos.entry, '#4f74f0', `entry ${px(pos.entry)}`, [4, 4]);
      level(pos.liq, '#ed4245', `liquidation ${px(pos.liq)}`, [2, 3]);
      level(pos.stop, '#faa61a', 'stop', [6, 3]);
      level(pos.take, '#3ba55d', 'target', [6, 3]);
    }

    // Current price tag.
    c2d.fillStyle = line;
    c2d.fillRect(w - right + 2, y(last) - 9, right - 4, 18);
    c2d.fillStyle = '#fff';
    c2d.fillText(px(last), w - right + 6, y(last));
  }

  // ── Wiring ───────────────────────────────────────────────────────────────

  function render() {
    if (!state) return;
    const running = state.phase === 'running';
    ctx.setPlaying(running);
    gameEl.classList.toggle('hidden', !running);
    lobbyEl.classList.toggle('hidden', running);
    if (!running) {
      closeSheet();
      renderLobby(state);
    } else {
      renderTicket();
      renderAccount();
      renderBoard();
      renderNews();
      renderStrip();
      drawChart();
    }
    renderTop();
  }

  return {
    mount(r) {
      root = r;
      root.replaceChildren(el('div', { className: 'app market' }, el('header', { className: 'topbar' }, topLeft(statusEl), priceEl, timerEl), gameEl, lobbyEl, backdropEl, sheetEl));
      gameEl.classList.add('hidden');
      lobbyEl.replaceChildren(card(el('h1', { textContent: 'Joining…' })));
      setTab('pos');
      placeTicket();
      phone.addEventListener('change', placeTicket);
      resize = new ResizeObserver(() => drawChart());
      resize.observe(canvas);
      timers.push(window.setInterval(renderTop, 500));
    },
    unmount() {
      for (const t of timers) clearInterval(t);
      resize?.disconnect();
      phone.removeEventListener('change', placeTicket);
    },
    onMessage(m) {
      switch (m.t) {
        case 'state': {
          const prev = state?.phase;
          state = m as MarketStateMessage;
          ctx.setClock(state.now);
          if (state.phase === 'running' && prev !== 'running') {
            news = [];
            tick = null;
            lastVaultKey = '';
            unread = 0;
            chatBadge.classList.add('hidden');
            setTab('pos');
          }
          render();
          break;
        }
        case 'history':
          prices = m.prices as number[];
          renderStrip();
          drawChart();
          break;
        case 'tick': {
          const t = m as TickMessage;
          tick = t;
          if (prices.length <= t.i) prices.push(t.price);
          if (state?.phase !== 'running') return;
          renderAccount();
          renderBoard();
          renderTop();
          renderStrip();
          drawChart();
          updatePreview();
          break;
        }
        case 'news':
          news.push({ i: m.i, text: m.text, tone: m.tone });
          renderNews();
          break;
        case 'chat':
          chat.add(m.kind, m.text, m.name);
          if (phone.matches && tab !== 'chat' && m.kind !== 'system') {
            unread++;
            chatBadge.textContent = unread > 9 ? '9+' : String(unread);
            chatBadge.classList.remove('hidden');
          }
          break;
      }
    },
  };
}
