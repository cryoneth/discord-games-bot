import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Client } from 'discord.js';
import { Hub } from '../src/activity/hub.js';
import { ActivityInvites } from '../src/activity/invites.js';
import type { GameRoom } from '../src/activity/base.js';

const settle = () => new Promise((r) => setTimeout(r, 3100));

function fakeDiscord() {
  const sent: { title: string; buttons: number }[] = [];
  const view = (p: any) => ({ title: p.embeds[0].data.title as string, buttons: p.components.length });
  const message = { edit: async (p: any) => (sent.push(view(p)), message) };
  const channel = { isSendable: () => true, send: async (p: any) => (sent.push(view(p)), message) };
  const discord = { channels: { fetch: async () => channel } } as unknown as Client;
  return { discord, sent };
}

const fakeRoom = (): GameRoom => ({ idle: true, lastActivity: 0, join: () => true, leave() {}, handle() {}, dispose() {} }) as unknown as GameRoom;

test('posts one invite when the Activity opens, edits it, and marks it ended', async () => {
  const { discord, sent } = fakeDiscord();
  const invites = new ActivityInvites(discord);
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
