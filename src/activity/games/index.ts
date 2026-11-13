import type { GameId } from '../../shared/protocol.js';
import type { ScoreStore } from '../../store.js';
import type { GameRoom, RoomContext, RoomResult } from '../base.js';
import type { Hub } from '../hub.js';
import { Room } from '../room.js';
import { ForbiddenRoom } from './forbidden.js';
import { MarketRoom } from './market.js';
import { OddOneOutRoom } from './oddoneout.js';
import { QuizRoom } from './quiz.js';

interface Deps {
  store: Pick<ScoreStore, 'quizzes'>;
  onGameEnd(hub: Hub, game: GameId, results: RoomResult[]): void;
}

/** Custom quizzes are shared per server (or per channel outside servers). */
export const quizScope = (hub: Hub) => hub.guildId ?? (hub.channelId ? `channel:${hub.channelId}` : 'local');

/** Creates the room for whichever game the host picked. */
export function gameFactory({ store, onGameEnd }: Deps) {
  return (game: GameId, hub: Hub): GameRoom => {
    const ctx: RoomContext = {
      instanceId: hub.instanceId,
      guildId: hub.guildId,
      channelId: hub.channelId,
      onGameEnd: (results) => onGameEnd(hub, game, results),
      hostId: () => hub.hostId(),
    };
    switch (game) {
      case 'drawing':
        return new Room(hub.instanceId, hub.guildId, hub.channelId, { onGameEnd: (_room, results) => ctx.onGameEnd(results), hostId: ctx.hostId });
      case 'oddoneout':
        return new OddOneOutRoom(ctx);
      case 'forbidden':
        return new ForbiddenRoom(ctx);
      case 'quiz':
        return new QuizRoom(ctx, store.quizzes(quizScope(hub)));
      case 'market':
        return new MarketRoom(ctx);
    }
  };
}
