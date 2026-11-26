import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Client } from 'discord.js';
import { Hub } from '../src/activity/hub.js';
import { ActivityInvites } from '../src/activity/invites.js';
import type { GameRoom } from '../src/activity/base.js';

const settle = () => new Promise((r) => setTimeout(r, 3100));

function fakeDiscord(systemChannelId: string | null = null) {
  const sent: { title: string; buttons: number; to?: string }[] = [];
  const fetched: string[] = [];
  const view = (p: any) => ({ title: p.embeds[0].data.title as string, buttons: p.components.length });
  const message = { edit: async (p: any) => (sent.push(view(p)), message) };
  const channel = { isSendable: () => true, send: async (p: any) => (sent.push(view(p)), message) };
  const guilds = { cache: new Map([['guild', { systemChannelId }]]) };
  const discord = { guilds, channels: { fetch: async (id: string) => (fetched.push(id), channel) } } as unknown as Client;
  return { discord, sent, fetched };
}

const fakeRoom = (): GameRoom => ({ idle: true, lastActivity: 0, join: () => true, leave() {}, handle() {}, dispose() {} }) as unknown as GameRoom;

test('posts one invite when the Activity opens, edits it, and marks it ended', async () => {
  const { discord, sent, fetched } = fakeDiscord('system');
  const invites = new ActivityInvites(discord);
  invites.noteLaunch('guild', 'a', 'text');
  const hub = new Hub('i', 'guild', 'voice', fakeRoom);
  invites.track(hub);
  const a = { send() {} };
  const b = { send() {} };
  hub.join({ id: 'a', name: 'A' }, a);
  hub.join({ id: 'b', name: 'B' }, b);
  await settle();
  assert.equal(sent.length, 1, 'quick joins are batched into one post');
  assert.match(sent[0]!.title, /Games are on/);
  assert.equal(sent[0]!.buttons, 1);
  assert.deepEqual(fetched, ['text'], 'posted where /play was typed');

  hub.handle('a', { t: 'choose', game: 'drawing' });
  await settle();
  assert.equal(sent.length, 2);
  assert.match(sent[1]!.title, /Sketch Party/);

  hub.leave('a', a);
  hub.leave('b', b);
  await settle();
  assert.match(sent.at(-1)!.title, /ended/);
  assert.equal(sent.at(-1)!.buttons, 0);
});

test('no invite without a known channel', async () => {
  const { discord, sent } = fakeDiscord();
  const hub = new Hub('i', 'guild', null, fakeRoom);
  new ActivityInvites(discord).track(hub);
  hub.join({ id: 'a', name: 'A' }, { send() {} });
  await settle();
  assert.equal(sent.length, 0);
});

test('without /play it uses the system channel, and never the voice chat', async () => {
  const sys = fakeDiscord('system');
  const hub = new Hub('i', 'guild', 'voice', fakeRoom);
  const invites = new ActivityInvites(sys.discord);
  invites.noteLaunch('guild', 'a', 'voice'); // /play typed in the voice channel's chat
  invites.track(hub);
  hub.join({ id: 'a', name: 'A' }, { send() {} });
  await settle();
  assert.deepEqual(sys.fetched, ['system']);

  const none = fakeDiscord(null);
  const hub2 = new Hub('j', 'guild', 'voice', fakeRoom);
  new ActivityInvites(none.discord).track(hub2);
  hub2.join({ id: 'a', name: 'A' }, { send() {} });
  await settle();
  assert.equal(none.sent.length, 0);
  assert.deepEqual(none.fetched, []);
});
