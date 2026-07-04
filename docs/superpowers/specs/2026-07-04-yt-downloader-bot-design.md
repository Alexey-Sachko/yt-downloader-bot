# Дизайн: Telegram-бот скачивания YouTube через yt-dlp

> Дата: 2026-07-04. Дизайн реализации на базе [SPEC.md](../../../SPEC.md).
> Стек и архитектура зафиксированы в SPEC.md §3–5 и не пересматриваются.
> Этот документ уточняет модульную разбивку, поток данных, обработку ошибок,
> тестирование и разрешает открытые вопросы SPEC §13.

## 1. Разрешённые открытые вопросы (SPEC §13)

| Вопрос | Решение |
|---|---|
| Формат отправки | **video** с автоматическим фолбэком на **document** (если не mp4 / ошибка контейнера / проблема с размером) |
| Лимиты | **500 МБ** по размеру и **2 часа** по длительности |
| Конкурентность | **Глобальная очередь, 1 воркер** (concurrency=1); пользователь видит статус «в очереди» |
| Доступ | **Allowlist** по Telegram user ID из env (`ALLOWED_USER_IDS`) |
| Плейлисты | **Не поддерживаются.** Из URL плейлиста извлекаем id видео (`v=`); чистый playlist-URL без видео → просим ссылку на конкретное видео |

## 2. Язык и инструменты

- **TypeScript**, компиляция через `tsc`; dev-запуск через `tsx` (hot-reload).
- Тесты: **vitest** (быстрый, TS из коробки).
- Состояние — **in-memory**, но за интерфейсом `StateStore`, чтобы в будущем
  подменить на Redis без изменения вызывающих слоёв (требование масштабируемости).

## 3. Модульная структура

```
src/
  config.ts         — чтение и валидация env (BOT_TOKEN, API_ID, API_HASH,
                      ALLOWED_USER_IDS, MAX_FILESIZE_BYTES, MAX_DURATION_SEC, TEMP_DIR)
  index.ts          — точка входа: старт клиента, регистрация обработчиков, graceful shutdown
  telegram/
    client.ts       — инициализация GramJS TelegramClient (client.start({ botAuthToken }))
    handlers.ts     — обработка входящих сообщений и callback (нажатия кнопок)
    ui.ts           — рендер inline-кнопок из форматов, статус-сообщения, редактирование прогресса
  ytdlp/
    probe.ts        — `yt-dlp -J <url>` → парсинг форматов (спавн процесса)
    download.ts     — `yt-dlp -f <id> <url>` → файл + парсинг прогресса из stdout
    formats.ts      — фильтрация/группировка форматов в понятные варианты (чистая логика)
  state/
    store.ts        — интерфейс StateStore + InMemoryStore (Map + TTL-очистка)
  queue/
    queue.ts        — глобальная очередь, concurrency=1
  files/
    tempdir.ts      — создание temp-файлов и гарантированная очистка после отправки
  util/
    url.ts          — извлечение/валидация YouTube URL, обработка playlist-URL
    logger.ts       — структурное логирование
```

Каждый модуль имеет одну ответственность и тестируется независимо через
well-defined интерфейсы. Слои с внешними процессами (`ytdlp/*`) — тонкие обёртки.

## 4. Поток данных

1. Входящее сообщение → `handlers` проверяет `allowlist` (иначе `UnauthorizedError`
   → «доступ запрещён»).
2. `url.ts` валидирует ссылку: playlist-URL → извлекаем id видео (`v=`);
   если это чистый плейлист без конкретного видео — просим одиночную ссылку.
3. `probe` вызывает `yt-dlp -J` → `formats.ts` сводит форматы к вариантам качества
   (360/480/720/1080…), **отфильтровывая те, чья оценка размера превышает
   MAX_FILESIZE_BYTES или длительность > MAX_DURATION_SEC** → `ui.ts` рендерит
   inline-кнопки с ориентировочным размером.
4. `state` запоминает `{ userId → { url, promptMessageId } }` (TTL ~10 мин).
   В `callback_data` кладём `format_id` (короткий).
5. Нажатие кнопки → `handlers` достаёт url из `state` → ставит задачу в `queue`
   (1 воркер). Пока ждёт — статус «в очереди»; во время скачивания — «скачиваю N%»
   через редактирование сообщения (throttle обновлений).
6. `download` качает во временный файл (yt-dlp мержит потоки через ffmpeg сам) →
   **повторная проверка реального размера** файла против лимита (`TooLargeError`).
7. Отправка через GramJS `sendFile` как **video** (с video-атрибутами);
   при не-mp4 / ошибке контейнера / проблеме размера — фолбэк на **document**.
8. `finally` → удаление temp-файла и очистка записи состояния.

## 5. Обработка ошибок

Типизированные ошибки, бросаемые слоями и перехватываемые в `handlers`:

- `UnauthorizedError` — пользователь не в allowlist.
- `InvalidUrlError` — не YouTube-ссылка / плейлист без видео.
- `ProbeError` — `yt-dlp -J` вернул ненулевой код / невалидный JSON.
- `NoSuitableFormatError` — все форматы отфильтрованы лимитами.
- `DownloadError` — сбой скачивания/мержа (ненулевой exit + stderr).
- `TooLargeError` — реальный размер после скачивания превысил лимит.

Правила: внешние процессы — проверяем exit code и stderr; temp-файлы всегда
чистятся в `finally`; каждая ошибка маппится в понятное пользователю сообщение;
детали логируются через `logger`.

## 6. Тестирование (TDD)

Чистая логика — покрываем тестами до реализации:

- `formats.ts` — парсинг/фильтрация JSON-фикстур реального вывода `yt-dlp -J`
  (граничные случаи: раздельные потоки, отсутствие filesize, превышение лимитов).
- `url.ts` — валидные/невалидные ссылки, playlist-URL, short-URL (youtu.be), Shorts.
- `queue.ts` — порядок FIFO, concurrency=1, обработка ошибки задачи без остановки очереди.
- `config.ts` — валидация env, дефолты, парсинг списков ID.
- `state/store.ts` — CRUD, TTL-истечение.

Слои с побочными эффектами (`ytdlp/*`, `telegram/*`) — тонкие обёртки, тестируем
через моки `child_process` / GramJS-клиента.

## 7. Инфраструктура (SPEC §9–12, без изменений)

- `Dockerfile` — Node-база + `yt-dlp` + `ffmpeg`.
- `docker-compose.yml` — env, маунт исходников (hot-reload), маунт temp-папки.
- `.env` (gitignored) + `.env.example` с `BOT_TOKEN`, `API_ID`, `API_HASH`,
  `ALLOWED_USER_IDS`, лимитами.
- `scripts/setup-vps.sh` — идемпотентная подготовка VPS (Docker, ffmpeg, yt-dlp,
  пользователь/директории, cron).
- `scripts/update-ytdlp.sh` — обновление yt-dlp (ежедневный cron).
- `.github/workflows/deploy.yml` — push в main → build/push образа → SSH → `docker compose up -d`.

## 8. Порядок реализации (высокоуровнево)

1. Скелет проекта: package.json, tsconfig, vitest, структура папок, config.
2. Чистые модули с TDD: url, formats, state/store, queue.
3. ytdlp-обёртки (probe, download) поверх child_process.
4. files/tempdir.
5. telegram: client, ui, handlers — сборка сквозного сценария.
6. index.ts — точка входа, graceful shutdown.
7. Инфраструктура: Dockerfile, docker-compose, .env.example, scripts, CI.
