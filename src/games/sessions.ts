export interface ActiveGame {
  game: string;
  ownerId: string;
  stop: () => void;
}

/** Ensures at most one chat game runs per channel, and lets it be stopped. */
export class ChannelSessions {
  private readonly active = new Map<string, ActiveGame>();

  start(channelId: string, game: ActiveGame): boolean {
    if (this.active.has(channelId)) return false;
    this.active.set(channelId, game);
    return true;
  }

  get(channelId: string): ActiveGame | undefined {
    return this.active.get(channelId);
  }

  end(channelId: string): void {
    this.active.delete(channelId);
  }

  stopAll(): void {
    for (const g of this.active.values()) g.stop();
  }
}
