import type { Quiz } from '../../shared/quiz.js';

/** Quizzes available on every server. Ids start with "builtin:" so they never collide with saved ones. */
export const BUILTIN_QUIZZES: Quiz[] = [
  {
    id: 'builtin:crypto-basics',
    title: 'Crypto basics',
    questions: [
      { q: 'What is the maximum supply of Bitcoin?', answers: ['100 million', '21 million', '18 million', 'There is no cap'], correct: 1, seconds: 20 },
      { q: 'What does "gas" pay for on Ethereum?', answers: ['Mining hardware', 'Exchange listing fees', 'Computation and storage for transactions', 'Wallet backups'], correct: 2, seconds: 20 },
      { q: "Roughly every four years, Bitcoin's block reward…", answers: ['Halves', 'Doubles', 'Resets to 50 BTC', 'Stays the same'], correct: 0, seconds: 20 },
      { q: 'Where should a seed phrase live?', answers: ['In a support chat when asked', 'Offline, never shared with anyone', 'In a cloud note', 'In your Discord DMs'], correct: 1, seconds: 20 },
      { q: 'Which consensus mechanism has Ethereum used since The Merge in 2022?', answers: ['Proof of Work', 'Proof of Authority', 'Proof of History', 'Proof of Stake'], correct: 3, seconds: 20 },
      { q: 'What is a stablecoin designed to do?', answers: ['Track the value of an asset like the US dollar', 'Double in value every year', 'Only pay staking rewards', 'Stay at exactly zero'], correct: 0, seconds: 20 },
      { q: 'What does DYOR stand for?', answers: ["Don't Yield On Rallies", 'Do Your Own Research', 'Deposit Your Own Reserves', 'Decentralized Yield Optimizer Router'], correct: 1, seconds: 20 },
      { q: 'What is a "rug pull"?', answers: ['A planned network upgrade', 'A type of hardware wallet', 'Developers abandoning a project and running off with the funds', 'Moving liquidity to a new chain'], correct: 2, seconds: 20 },
      { q: 'What is the smallest unit of Bitcoin called?', answers: ['Gwei', 'Wei', 'Lamport', 'Satoshi'], correct: 3, seconds: 20 },
      { q: 'A "layer 2" is usually…', answers: ['A network that settles to a base chain to help it scale', 'A second wallet for backups', "A token's second airdrop", 'A validator on standby'], correct: 0, seconds: 20 },
      { q: 'What can you do with a block explorer?', answers: ['Recover a lost private key', 'Look up transactions and addresses', 'Reverse a transaction', 'Mine blocks faster'], correct: 1, seconds: 20 },
      { q: '"Not your keys, not your coins" means…', answers: ['Keys can be shared safely', 'Exchanges can never freeze funds', "If someone else holds the keys, you don't fully control the funds", 'Coins work without keys'], correct: 2, seconds: 20 },
    ],
  },
  {
    id: 'builtin:perps-defi',
    title: 'Perps & DeFi 101',
    questions: [
      { q: 'What makes a perpetual future different from a regular future?', answers: ['It always settles in BTC', 'It has no expiry date', "It can't use leverage", 'It expires every week'], correct: 1, seconds: 20 },
      { q: 'When the funding rate is positive, who pays whom?', answers: ['Shorts pay longs', 'The exchange pays everyone', 'Longs pay shorts', 'Nobody pays anything'], correct: 2, seconds: 20 },
      { q: 'At 10x leverage, roughly what move against you wipes out your margin (ignoring fees)?', answers: ['1%', '10%', '50%', '100%'], correct: 1, seconds: 20 },
      { q: 'What is a liquidation?', answers: ['A forced close of a position when its margin runs too low', 'Swapping tokens for cash on purpose', 'A bonus paid to long-term holders', 'Claiming an airdrop'], correct: 0, seconds: 20 },
      { q: 'What does "open interest" measure?', answers: ["Today's trading volume", 'The number of exchange users', 'Interest paid on deposits', 'The total size of contracts still open'], correct: 3, seconds: 20 },
      { q: 'In an AMM pool, impermanent loss happens when…', answers: ['The pool gets exploited', 'Gas fees go up', 'The prices of the two tokens drift apart after you deposit', 'You withdraw before a lockup ends'], correct: 2, seconds: 30 },
      { q: 'APY differs from APR because APY includes…', answers: ['Compounding', 'Trading fees only', 'Token emissions only', 'Nothing, they are the same'], correct: 0, seconds: 20 },
      { q: 'What is a stop-loss for?', answers: ['Raising your leverage automatically', 'Closing the position at a set price to cap the loss', 'Avoiding funding payments', 'Earning maker rebates'], correct: 1, seconds: 20 },
      { q: 'With isolated margin…', answers: ['Your whole account backs every position', "The position can't be liquidated", 'Margin is paid in a separate token', 'Only the margin assigned to that position is at risk'], correct: 3, seconds: 30 },
      { q: 'Perp exchanges mainly use the mark price for…', answers: ['Liquidations and unrealized PnL', 'Charts only', 'Setting gas fees', 'Paying stakers'], correct: 0, seconds: 20 },
      { q: 'Very high farm APRs are usually paid in…', answers: ['US dollars', 'Bitcoin', 'Newly minted reward tokens', 'Protocol trading fees only'], correct: 2, seconds: 20 },
      { q: 'What is a short squeeze?', answers: ['Shorts earning extra funding', 'Rising prices forcing shorts to buy back, pushing the price even higher', 'A sharp drop in price', 'An exchange banning short positions'], correct: 1, seconds: 30 },
      { q: 'What is slippage?', answers: ['A bridge fee', 'A failed transaction', 'Funding paid every hour', 'The gap between the expected and the executed price'], correct: 3, seconds: 20 },
      { q: 'What does TVL stand for?', answers: ['Total Value Locked', 'Token Validation Layer', 'Transaction Volume Limit', 'Treasury Vault Ledger'], correct: 0, seconds: 20 },
    ],
  },
];
