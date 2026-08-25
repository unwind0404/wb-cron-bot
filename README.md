# WB Cron Bot — автоответы на отзывы Wildberries

Serverless-бот: раз в день проверяет неотвеченные отзывы на WB и отвечает на них (шаблон по звёздам или LLM), затем присылает отчёт в Telegram.

## Как работает

1. Vercel Cron раз в день (07:00 UTC) вызывает `/api/cron`
2. Бот берёт все неотвеченные отзывы через WB API
3. Генерирует ответ (шаблон по оценке или LLM через OpenRouter)
4. Отправляет ответы
5. Присылает отчёт в Telegram

WB сам помечает отзыв как «отвеченный», поэтому база данных не нужна.

## Переменные окружения (Vercel → Settings → Environment Variables)

| Переменная | Обязательна | Описание |
|---|---|---|
| `WB_API_TOKEN` | ✅ | Персональный токен WB (категория «Вопросы и отзывы») |
| `CRON_SECRET` | рекомендуется | Секрет для ручного запуска `/api/cron` с заголовком `Authorization: Bearer <секрет>` |
| `ANSWER_MODE` | нет | `templates` (по умолчанию) или `llm` |
| `OPENROUTER_API_KEY` | при llm | Ключ openrouter.ai |
| `LLM_MODEL` | нет | Основная модель (по умолчанию DeepSeek V3 free) |
| `LLM_FALLBACK_MODEL` | нет | Запасная модель (по умолчанию Llama 3.3 70B free) |
| `TEMPLATES_JSON` | нет | Свои шаблоны: `{"5": "текст", "4": "текст", ...}` |
| `TG_BOT_TOKEN` | для отчётов | Токен бота от @BotFather |
| `TG_CHAT_ID` | для отчётов | Ваш chat_id |

## Ручной запуск

```bash
curl -X POST https://<ваш-проект>.vercel.app/api/cron \
  -H "Authorization: Bearer <CRON_SECRET>"
```

## Локальный тест

```bash
npm i -g vercel
vercel dev
# в другом терминале:
curl -X POST http://localhost:3000/api/cron -H "Authorization: Bearer <CRON_SECRET>"
```

## Расписание

По умолчанию `0 7 * * *` (07:00 UTC = 10:00 МСК). Меняется в `vercel.json`.
