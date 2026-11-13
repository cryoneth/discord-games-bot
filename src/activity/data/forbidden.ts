/** Forbidden Words cards: "word: five, banned, words, for, it". */

function parse(lines: string): { word: string; banned: string[] }[] {
  return lines
    .trim()
    .split('\n')
    .map((l) => {
      const [word, rest] = l.split(':');
      return { word: word!.trim(), banned: rest!.split(',').map((b) => b.trim()) };
    });
}

export const GENERAL_CARDS = parse(`
pizza: cheese, Italy, slice, dough, pepperoni
beach: sand, sea, sun, waves, towel
birthday: cake, candles, party, age, presents
coffee: drink, morning, caffeine, cup, beans
guitar: strings, music, play, rock, instrument
airport: plane, flight, travel, gate, luggage
snowman: winter, carrot, cold, build, frosty
library: books, read, quiet, borrow, shelf
volcano: lava, eruption, mountain, hot, ash
dentist: teeth, doctor, drill, mouth, brush
umbrella: rain, wet, open, weather, handle
penguin: bird, ice, black, white, Antarctica
toothbrush: teeth, paste, clean, bathroom, morning
camping: tent, fire, outdoors, sleeping bag, forest
wedding: marriage, bride, ring, church, dress
pirate: ship, treasure, parrot, sea, captain
astronaut: space, rocket, moon, NASA, helmet
popcorn: movie, corn, butter, snack, pop
rainbow: colors, rain, sky, arc, pot
elevator: floor, up, down, button, building
magician: trick, hat, rabbit, wand, cards
hospital: doctor, nurse, sick, patient, emergency
football: ball, goal, team, kick, soccer
chocolate: sweet, cocoa, brown, bar, candy
vampire: blood, fangs, night, Dracula, bite
skateboard: wheels, ride, tricks, board, park
honey: bee, sweet, sticky, golden, jar
alarm clock: wake, morning, ring, time, snooze
sunglasses: eyes, sun, shades, wear, dark
passport: travel, country, border, photo, document
museum: art, history, exhibit, old, painting
ninja: Japan, sword, stealth, black, warrior
karaoke: sing, song, microphone, bar, lyrics
fireworks: explode, sky, celebration, colors, New Year
dinosaur: extinct, fossil, T-Rex, Jurassic, big
lighthouse: light, sea, ships, tower, coast
ice cream: cold, scoop, cone, flavor, dessert
spider: web, legs, eight, insect, crawl
sushi: fish, rice, Japan, raw, roll
treadmill: run, gym, machine, exercise, belt
superhero: powers, cape, save, comic, villain
garden: plants, flowers, grow, soil, vegetables
wifi: internet, password, connection, router, signal
selfie: photo, phone, camera, picture, face
pyramid: Egypt, triangle, pharaoh, desert, ancient
podcast: listen, episode, audio, host, show
zombie: dead, undead, brains, walk, apocalypse
bicycle: pedal, wheels, ride, bike, chain
breakfast: morning, eat, meal, eggs, cereal
mirror: reflection, glass, look, see, bathroom
traffic jam: cars, road, stuck, slow, rush hour
jungle: trees, animals, rainforest, wild, vines
tattoo: ink, skin, needle, design, arm
calendar: date, month, year, days, schedule
headphones: music, ears, listen, sound, wireless
robot: machine, metal, artificial, android, program
detective: crime, solve, mystery, clues, police
waterfall: water, fall, river, cliff, Niagara
backpack: bag, school, carry, straps, hiking
yoga: stretch, pose, mat, meditation, exercise
sandcastle: beach, build, sand, bucket, tower
haircut: barber, scissors, hair, salon, short
thunderstorm: lightning, rain, loud, weather, clouds
cookbook: recipe, kitchen, chef, food, pages
marathon: run, race, miles, long, finish
escape room: puzzle, locked, clues, team, key
time travel: past, future, machine, history, clock
jigsaw: puzzle, pieces, picture, fit, box
compass: north, direction, needle, navigate, map
chess: king, queen, board, checkmate, pawn
hot dog: sausage, bun, mustard, ketchup, grill
sunscreen: sun, skin, burn, lotion, beach
cactus: desert, spikes, plant, green, water
parachute: jump, sky, plane, fall, open
microwave: heat, kitchen, food, oven, fast
lottery: ticket, win, numbers, money, jackpot
crossword: puzzle, words, clues, newspaper, grid
igloo: ice, snow, house, Arctic, cold
hammock: swing, relax, hang, trees, sleep
tornado: wind, storm, spin, twister, Kansas
`);

export const CRYPTO_CARDS = parse(`
bitcoin: BTC, Satoshi, first, digital gold, coin
ethereum: ETH, Vitalik, smart contract, gas, second
wallet: keys, store, MetaMask, address, funds
seed phrase: words, twelve, backup, recover, private
airdrop: free, tokens, claim, eligible, farm
liquidation: margin, forced, close, leverage, wiped
leverage: borrow, multiply, x, margin, risk
funding rate: perpetual, longs, shorts, pay, hours
stablecoin: dollar, peg, USDC, USDT, stable
gas fee: transaction, pay, gwei, network, cost
whale: big, holder, large, ocean, wallet
rug pull: scam, developers, run, liquidity, exit
bull market: up, rising, prices, green, cycle
bear market: down, falling, red, winter, cycle
short: sell, bet, down, borrow, position
long: buy, bet, up, position, bullish
staking: lock, rewards, validator, proof, yield
yield farming: APY, rewards, liquidity, harvest, crops
liquidity pool: pair, AMM, deposit, LP, swap
impermanent loss: pool, divergence, LP, price, temporary
smart contract: code, Ethereum, program, deploy, Solidity
NFT: picture, token, unique, JPEG, collection
DAO: governance, vote, decentralized, organization, token
halving: Bitcoin, reward, four years, half, miners
mining: proof of work, hash, blocks, energy, rigs
validator: stake, blocks, proof of stake, node, verify
bridge: chain, cross, transfer, move, hack
layer 2: rollup, scaling, Ethereum, cheap, Arbitrum
oracle: price, feed, data, Chainlink, offchain
exploit: hack, bug, drain, attacker, stolen
private key: secret, sign, wallet, password, own
hardware wallet: cold, device, Ledger, offline, USB
order book: bids, asks, limit, exchange, depth
market maker: liquidity, spread, quotes, bid, ask
slippage: price, trade, difference, tolerance, swap
stop-loss: order, limit, protect, exit, risk
take profit: order, close, gain, target, sell
open interest: contracts, open, total, futures, positions
candlestick: chart, wick, body, green, red
all-time high: ATH, record, highest, price, peak
FOMO: fear, missing out, buy, rush, chase
FUD: fear, doubt, uncertainty, rumors, panic
HODL: hold, sell, typo, long, diamond hands
degen: risky, gamble, ape, crazy, YOLO
memecoin: dog, joke, pump, community, Doge
token unlock: vesting, supply, release, sell pressure, cliff
burn: destroy, supply, tokens, remove, deflation
governance: vote, proposal, DAO, token, decide
multisig: signatures, wallet, keys, approve, safe
testnet: test, fake, tokens, developers, mainnet
block explorer: Etherscan, transactions, look up, address, hash
mempool: pending, transactions, queue, gas, unconfirmed
MEV: miners, extract, front-run, sandwich, bots
collateral: deposit, loan, borrow, backing, margin
APY: yield, annual, percent, compound, interest
TVL: total, locked, value, DeFi, deposits
perpetual: futures, expiry, funding, contract, perp
spot: buy, own, price, immediate, exchange
short squeeze: shorts, price, up, forced, liquidations
dip: buy, down, drop, price, small
moon: up, rocket, lambo, pump, price
paper hands: sell, weak, panic, early, diamond hands
cold storage: offline, wallet, safe, hardware, keys
lambo: car, rich, moon, Lamborghini, gains
DEX: decentralized, exchange, swap, Uniswap, AMM
CEX: centralized, exchange, Binance, KYC, custody
KYC: identity, verify, documents, exchange, know
circuit breaker: halt, trading, stop, crash, pause
`);
