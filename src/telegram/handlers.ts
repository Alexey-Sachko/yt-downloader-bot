import type { Config } from "../config.js";
import type { StateStore } from "../state/store.js";
import type { Queue } from "../queue/queue.js";
import type { VideoInfo } from "../types.js";
import { extractYouTubeVideoId, isPlaylistOnly } from "../util/url.js";
import { buildQualityOptions } from "../ytdlp/formats.js";
import { buttonRows, statusText, parseCallbackData } from "./ui.js";
import { createWorkspace } from "../files/tempdir.js";
import { formatBytes } from "../util/format-bytes.js";
import {
  InvalidUrlError, NoSuitableFormatError, TooLargeError,
} from "../errors.js";
import { logger } from "../util/logger.js";
import fs from "node:fs/promises";

/** I/O port over GramJS so handlers stay testable. */
export interface Bot {
  reply(chatId: string, text: string, buttons?: { text: string; data: string }[][]): Promise<number>;
  editText(chatId: string, messageId: number, text: string): Promise<void>;
  sendVideo(chatId: string, filePath: string, opts: { durationSec: number | null; title: string; width: number | null; height: number | null; asDocument: boolean; onProgress?: (percent: number) => void }): Promise<void>;
  sendAudio(chatId: string, filePath: string, opts: { durationSec: number | null; title: string; onProgress?: (percent: number) => void }): Promise<void>;
}

export interface Deps {
  config: Config;
  store: StateStore;
  queue: Queue;
  bot: Bot;
  probe: (url: string) => Promise<VideoInfo>;
  download: (a: { url: string; formatSelector: string; videoId: string; outDir: string; audioOnly?: boolean; onProgress: (p: number) => void }) => Promise<string>;
}

/** Handle an incoming text message (expected to be a YouTube link). */
export async function handleMessage(
  deps: Deps,
  input: { userId: number; chatId: string; text: string },
): Promise<void> {
  const { config, store, bot } = deps;

  if (!config.isAllowed(input.userId)) {
    await bot.reply(input.chatId, "⛔ Sorry, you are not allowed to use this bot.");
    return;
  }

  const url = input.text.trim();
  try {
    if (isPlaylistOnly(url)) {
      throw new InvalidUrlError("playlist");
    }
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) {
      throw new InvalidUrlError("not-a-video");
    }

    await bot.reply(input.chatId, "🔎 Analyzing the video…");
    const info = await deps.probe(url);

    if (info.durationSec != null && info.durationSec > config.maxDurationSec) {
      const hrs = (config.maxDurationSec / 3600).toFixed(0);
      await bot.reply(input.chatId, `⛔ Video is too long (limit ${hrs}h).`);
      return;
    }

    const options = buildQualityOptions(info, {
      maxBytes: config.maxFilesizeBytes,
      maxDurationSec: config.maxDurationSec,
    });
    if (options.length === 0) {
      throw new NoSuitableFormatError();
    }

    const promptId = await bot.reply(
      input.chatId,
      `🎬 ${info.title}\nChoose a quality:`,
      buttonRows(options),
    );

    store.set(input.userId, {
      url,
      title: info.title,
      durationSec: info.durationSec,
      options,
      promptMessageId: promptId,
      createdAt: Date.now(),
    });
  } catch (err) {
    await replyForError(bot, input.chatId, err, config);
  }
}

async function replyForError(bot: Bot, chatId: string, err: unknown, config: Config): Promise<void> {
  if (err instanceof InvalidUrlError) {
    const msg = err.message === "playlist"
      ? "This is a playlist link. Send a link to a single video."
      : "That doesn't look like a YouTube video link.";
    await bot.reply(chatId, `⚠️ ${msg}`);
  } else if (err instanceof NoSuitableFormatError) {
    await bot.reply(chatId, `⛔ No quality fits the ${formatBytes(config.maxFilesizeBytes)} size limit.`);
  } else if (err instanceof TooLargeError) {
    await bot.reply(chatId, `⛔ The downloaded file exceeds the ${formatBytes(config.maxFilesizeBytes)} limit.`);
  } else {
    logger.error("handler error", { err: String(err) });
    await bot.reply(chatId, "❌ Something went wrong. Please try again.");
  }
}

/** Handle a quality-button press. */
export async function handleCallback(
  deps: Deps,
  input: { userId: number; chatId: string; data: string; messageId: number },
): Promise<void> {
  const { config, store, queue, bot } = deps;

  if (!config.isAllowed(input.userId)) return;

  const index = parseCallbackData(input.data);
  const session = store.get(input.userId);
  if (index == null || !session || !session.options[index]) {
    await bot.editText(input.chatId, input.messageId, "⌛ This choice expired. Please send the link again.");
    return;
  }

  const option = session.options[index];
  const position = queue.size() + 1;
  await bot.editText(input.chatId, input.messageId, statusText({ kind: "queued", position }));

  await queue.add(async () => {
    const ws = await createWorkspace(config.tempDir);
    try {
      let lastShown = -1;
      const filePath = await deps.download({
        url: session.url,
        formatSelector: option.formatSelector,
        videoId: extractYouTubeVideoId(session.url) ?? "video",
        outDir: ws.dir,
        audioOnly: option.kind === "audio",
        onProgress: (p) => {
          if (Math.floor(p) >= lastShown + 5) {
            lastShown = Math.floor(p);
            void bot.editText(input.chatId, input.messageId, statusText({ kind: "downloading", percent: p }));
          }
        },
      });

      const size = (await fs.stat(filePath)).size;
      if (size > config.maxFilesizeBytes) throw new TooLargeError();

      await bot.editText(input.chatId, input.messageId, statusText({ kind: "uploading", percent: 0 }));
      let lastUploaded = -1;
      const onUpload = (p: number) => {
        if (Math.floor(p) >= lastUploaded + 5) {
          lastUploaded = Math.floor(p);
          void bot.editText(input.chatId, input.messageId, statusText({ kind: "uploading", percent: p }));
        }
      };
      if (option.kind === "audio") {
        await bot.sendAudio(input.chatId, filePath, {
          durationSec: session.durationSec,
          title: session.title,
          onProgress: onUpload,
        });
      } else {
        await bot.sendVideo(input.chatId, filePath, {
          durationSec: session.durationSec,
          title: session.title,
          width: option.width,
          height: option.height,
          asDocument: false,
          onProgress: onUpload,
        });
      }
      await bot.editText(input.chatId, input.messageId, statusText({ kind: "done" }));
    } catch (err) {
      await replyForError(bot, input.chatId, err, config);
    } finally {
      await ws.cleanup();
      store.delete(input.userId);
    }
  });
}
