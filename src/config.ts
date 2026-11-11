export interface Config {
  token: string;
  clientId: string;
  clientSecret: string;
  port: number;
  host: string;
  dataDir: string;
  retentionDays: number;
  devGuildId: string | undefined;
  verifyActivityInstance: boolean;
  trustProxy: boolean;
  frameAncestors: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  return value;
}

function int(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

export function loadConfig(): Config {
  const clientId = required('DISCORD_CLIENT_ID');
  if (!/^\d{15,25}$/.test(clientId)) throw new Error('DISCORD_CLIENT_ID must be a numeric application ID');
  return {
    token: required('DISCORD_TOKEN'),
    clientId,
    clientSecret: required('DISCORD_CLIENT_SECRET'),
    port: int('PORT', 3000, 1, 65535),
    host: process.env.HOST?.trim() || '0.0.0.0',
    dataDir: process.env.DATA_DIR?.trim() || './data',
    retentionDays: int('DATA_RETENTION_DAYS', 90, 1, 3650),
    devGuildId: process.env.DEV_GUILD_ID?.trim() || undefined,
    verifyActivityInstance: process.env.VERIFY_ACTIVITY_INSTANCE !== 'false',
    trustProxy: process.env.TRUST_PROXY === 'true',
    frameAncestors:
      process.env.FRAME_ANCESTORS?.trim() ||
      "'self' https://discord.com https://*.discord.com https://*.discordsays.com https://discordapp.com https://*.discordapp.com",
  };
}
