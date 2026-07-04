import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import type { Config } from "../config.js";
import { logger } from "../util/logger.js";

/** Build and start a GramJS client authenticated as a bot. */
export async function startClient(config: Config): Promise<TelegramClient> {
  const client = new TelegramClient(
    new StringSession(""),
    config.apiId,
    config.apiHash,
    { connectionRetries: 5 },
  );
  await client.start({ botAuthToken: config.botToken });
  logger.info("Telegram client started");
  return client;
}
