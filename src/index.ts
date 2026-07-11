import { Api } from "telegram";
import { NewMessage } from "telegram/events/index.js";
import { CallbackQuery } from "telegram/events/CallbackQuery.js";
import { Button } from "telegram/tl/custom/button.js";
import { loadConfig } from "./config.js";
import { startClient } from "./telegram/client.js";
import { InMemoryStore } from "./state/store.js";
import { Queue } from "./queue/queue.js";
import { probe } from "./ytdlp/probe.js";
import { download } from "./ytdlp/download.js";
import { handleMessage, handleCallback, type Bot, type Deps } from "./telegram/handlers.js";
import { logger } from "./util/logger.js";
import fs from "node:fs/promises";

async function main() {
  const config = loadConfig();
  if (config.allowedUserIds.length === 0) {
    logger.warn("ALLOWED_USER_IDS is empty — the bot is open to everyone");
  }
  await fs.mkdir(config.tempDir, { recursive: true });

  const client = await startClient(config);
  const store = new InMemoryStore();
  const queue = new Queue(1);

  const bot: Bot = {
    async reply(chatId, text, buttons) {
      const gramButtons = buttons?.map((row) =>
        row.map((b) => Button.inline(b.text, Buffer.from(b.data))));
      const msg = await client.sendMessage(chatId, { message: text, buttons: gramButtons });
      return msg.id;
    },
    async editText(chatId, messageId, text) {
      await client.editMessage(chatId, { message: messageId, text });
    },
    async sendVideo(chatId, filePath, opts) {
      const attributes = opts.asDocument ? undefined : [
        new Api.DocumentAttributeVideo({
          duration: Math.round(opts.durationSec ?? 0),
          w: opts.width ?? 0,
          h: opts.height ?? 0,
          supportsStreaming: true,
        }),
      ];
      const progressCallback = opts.onProgress
        ? (p: number) => opts.onProgress!(p * 100)
        : undefined;
      try {
        await client.sendFile(chatId, {
          file: filePath,
          caption: opts.title,
          attributes,
          forceDocument: opts.asDocument,
          supportsStreaming: !opts.asDocument,
          progressCallback,
        });
      } catch (err) {
        if (!opts.asDocument) {
          logger.warn("video send failed, retrying as document", { err: String(err) });
          await client.sendFile(chatId, { file: filePath, caption: opts.title, forceDocument: true, progressCallback });
        } else {
          throw err;
        }
      }
    },
    async sendAudio(chatId, filePath, opts) {
      await client.sendFile(chatId, {
        file: filePath,
        caption: opts.title,
        attributes: [
          new Api.DocumentAttributeAudio({
            duration: Math.round(opts.durationSec ?? 0),
            title: opts.title,
            voice: false,
          }),
        ],
        progressCallback: opts.onProgress
          ? (p: number) => opts.onProgress!(p * 100)
          : undefined,
      });
    },
  };

  const deps: Deps = { config, store, queue, bot, probe, download };

  client.addEventHandler(async (event: any) => {
    const message = event.message;
    if (!message || !message.text || message.out) return;
    const userId = Number(event.senderId ?? message.senderId);
    const chatId = String(event.chatId ?? message.chatId);
    await handleMessage(deps, { userId, chatId, text: message.text });
  }, new NewMessage({}));

  client.addEventHandler(async (event: any) => {
    const userId = Number(event.senderId);
    const chatId = String(event.chatId);
    const data = event.data ? Buffer.from(event.data).toString() : "";
    await event.answer().catch(() => {});
    await handleCallback(deps, { userId, chatId, data, messageId: event.messageId });
  }, new CallbackQuery({}));

  logger.info("Bot is running");

  const shutdown = async () => {
    logger.info("Shutting down…");
    await client.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("Fatal startup error", { err: String(err) });
  process.exit(1);
});
