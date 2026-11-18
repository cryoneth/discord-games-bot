import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ContainerBuilder,
  MessageFlags,
  SeparatorSpacingSize,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { celebrationGif } from '../render/animate.js';
import type { Scene } from '../render/boards.js';
import { png } from '../render/canvas.js';

export interface Image {
  name: string;
  data: Buffer;
  alt?: string;
}

export interface Card {
  color: number;
  title: string;
  body?: string;
  image?: Image;
  /** Small grey text under the image. */
  footer?: string;
  rows?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}

/** Renders a scene as a PNG, or as a looping confetti GIF for big moments. */
export function sceneImage(scene: Scene, name: string, alt: string, celebrate = false): Image {
  return celebrate
    ? { name: `${name}.gif`, data: celebrationGif(scene.draw, scene.w, scene.h), alt }
    : { name: `${name}.png`, data: png((ctx) => scene.draw(ctx, 0), scene.w, scene.h), alt };
}

/**
 * Builds a Components V2 message: one accent-coloured container with title,
 * body, optional image and buttons. Works for sending, editing and updating:
 * `attachments: []` drops the previous image when a new one is attached.
 */
export function card(c: Card) {
  const container = new ContainerBuilder().setAccentColor(c.color);
  container.addTextDisplayComponents((t) => t.setContent(`### ${c.title}${c.body ? `\n${c.body}` : ''}`));
  if (c.image) {
    const { name, alt } = c.image;
    container.addMediaGalleryComponents((g) =>
      g.addItems((i) => {
        i.setURL(`attachment://${name}`);
        return alt ? i.setDescription(alt) : i;
      }),
    );
  }
  if (c.footer) container.addTextDisplayComponents((t) => t.setContent(`-# ${c.footer}`));
  if (c.rows?.length) {
    container.addSeparatorComponents((s) => s.setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    container.addActionRowComponents(...c.rows);
  }
  return {
    components: [container],
    files: c.image ? [new AttachmentBuilder(c.image.data, { name: c.image.name })] : [],
    attachments: [],
    flags: MessageFlags.IsComponentsV2 as const,
  };
}

/** Minimal card used as a quick acknowledgement while something heavier renders. */
export function noticeCard(color: number, title: string, body: string) {
  return card({ color, title, body });
}

/** Unique-enough suffix for custom IDs. */
export function nonce(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export const ROW = () => new ActionRowBuilder<ButtonBuilder>();
