// Vercel Cron: раз в день проверяет неотвеченные отзывы и отвечает на них.
// Работает с магазинами из БД; если БД не настроена — с env-магазином (WB_API_TOKEN).

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { WbClient, RateLimitError, type WbFeedback } from '../lib/wb-client.js'
import { generateAnswer } from '../lib/generator.js'
import { reportRun, reportError, isTelegramConfigured, sendMessage } from '../lib/telegram.js'
import { getDb, initDb, listShops, saveFeedback, listFeedbacksSince, saveInsight, type FeedbackInput } from '../lib/db.js'
import { analyzeFeedbacks } from '../lib/insights.js'

type Target = { shopId: number | null; name: string; token: string; mode: string }

async function getTargets(): Promise<Target[]> {
  // приоритет: магазины из БД; если БД нет — env-магазин
  const db = getDb()
  if (db) {
    await initDb()
    const shops = await listShops()
    return shops
      .filter((s) => s.enabled)
      .map((s) => ({ shopId: s.id, name: s.name, token: s.token, mode: s.mode }))
  }
  const envToken = process.env.WB_API_TOKEN
  if (envToken) {
    return [{ shopId: null, name: 'Магазин (env)', token: envToken, mode: process.env.ANSWER_MODE || 'templates' }]
  }
  return []
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Авторизация: либо вызов от Vercel Cron, либо ручной запуск с CRON_SECRET.
  // ВАЖНО: если CRON_SECRET не задан, ручной запуск запрещён, а заголовок
  // x-vercel-cron принимается только от реального Vercel Cron (Vercel
  // блокирует этот заголовок из внешних запросов на серверлесс-функциях).
  const isVercelCron = req.headers['x-vercel-cron'] !== undefined
  const authHeader = req.headers.authorization
  const secret = process.env.CRON_SECRET
  const isManualAuthorized = Boolean(secret) && authHeader === `Bearer ${secret}`

  if (!isVercelCron && !isManualAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const targets = await getTargets()
  if (targets.length === 0) {
    const msg = 'Нет магазинов: задайте DATABASE_URL (панель) или WB_API_TOKEN (env)'
    console.error('[cron]', msg)
    return res.status(500).json({ error: msg })
  }

  console.log(`[cron] старт, магазинов: ${targets.length}`)

  let totalAnswered = 0
  let totalFailed = 0
  const details: string[] = []

  try {
    for (const target of targets) {
      const client = new WbClient(target.token)
      let feedbacks: WbFeedback[]
      try {
        feedbacks = await client.getUnansweredFeedbacks()
      } catch (e) {
        if (e instanceof RateLimitError) {
          // Лимит WB: ждём столько, сколько сказал WB (макс. 55с — лимит функции),
          // затем ОДНА повторная попытка. Если снова 429 — выходим без стука.
          const wait = Math.min(e.retryAfterSec, 55)
          console.log(`[cron] ${target.name}: 429, жду ${wait}с и пробую ещё раз`)
          await new Promise((r) => setTimeout(r, wait * 1000))
          try {
            feedbacks = await client.getUnansweredFeedbacks()
          } catch (e2) {
            const msg = e2 instanceof RateLimitError
              ? `Лимит WB всё ещё активен (429) — продолжится в следующем запуске`
              : e2 instanceof Error ? e2.message : String(e2)
            details.push(`⏳ ${target.name}: ${msg}`)
            totalFailed++
            continue
          }
        } else {
          const msg = e instanceof Error ? e.message : String(e)
          details.push(`❌ ${target.name}: ${msg.slice(0, 80)}`)
          totalFailed++
          continue
        }
      }
      console.log(`[cron] ${target.name}: неотвеченных ${feedbacks.length}`)

      // Базовый токен WB: лимит 5 запросов/час. За запуск обрабатываем
      // минимум: 1 (список) + 1 (ответ) = 2 запроса. Берём 1 свежий отзыв.
      // Лимит функции Vercel free — 60с. С паузами 1.5с успеваем ~15 отзывов.
      // Остальные обработает следующий запуск (cron ежедневно или вручную).
      const MAX_ANSWERS_PER_RUN = process.env.WB_TOKEN_TYPE === 'personal' ? 10 : 1
      const toAnswer = feedbacks.slice(0, MAX_ANSWERS_PER_RUN)

      for (const fb of toAnswer) {
        const video = fb.video ?? null
        const input: FeedbackInput = {
          rating: fb.productValuation ?? undefined,
          text: fb.text ?? undefined,
          pros: fb.pros ?? undefined,
          cons: fb.cons ?? undefined,
          productName: fb.productDetails?.productName ?? undefined,
          subjectName: fb.subjectName ?? undefined,
          userName: fb.userName ?? undefined,
        }
        const media = {
          id: fb.id,
          nmId: fb.productDetails?.nmId ?? null,
          productName: fb.productDetails?.productName ?? null,
          subjectName: fb.subjectName ?? null,
          userName: fb.userName ?? null,
          rating: fb.productValuation ?? null,
          text: fb.text ?? null,
          pros: fb.pros ?? null,
          cons: fb.cons ?? null,
          photoLinks: Array.isArray(fb.photoLinks) ? fb.photoLinks : [],
          videoUrl: typeof video?.src === 'string' ? video.src : null,
          videoPreview: typeof video?.preview === 'string' ? video.preview : null,
          createdDate: fb.createdDate ?? null,
        }
        try {
          if (target.mode === 'drafts') {
            // Черновик: генерируем ответ, но НЕ отправляем — ждём одобрения в панели
            const { answer, source } = await generateAnswer(input, 'llm')
            await saveFeedback(target.shopId ?? 0, media, answer, source, null, 'draft')
            details.push(`📝 ${target.name}: черновик готов`)
            console.log(`[cron] черновик готов для ${fb.id}`)
          } else {
            console.log(`[cron] генерирую ответ для ${fb.id} (режим ${target.mode})`)
            const { answer, source } = await generateAnswer(input, target.mode)
            console.log(`[cron] ответ получен, отправляю на WB...`)
            try {
              await client.answerFeedback(fb.id, answer)
            } catch (e) {
              if (e instanceof RateLimitError) {
                // Лимит исчерпан: сохраняем отзыв как «ожидающий» и выходим из цикла —
                // не стучимся дальше, остальные уйдут в следующем запуске
                console.log(`[cron] 429 на ответе — прекращаю цикл, продолжится в следующем запуске`)
                details.push(`⏳ ${target.name}: лимит WB, ${feedbacks.length - toAnswer.indexOf(fb)} отзывов ждут следующего запуска`)
                break
              }
              throw e
            }
            console.log(`[cron] отправлено, сохраняю в БД...`)
            totalAnswered++
            const stars = '★'.repeat(fb.productValuation ?? 0)
            details.push(`${stars} ${target.name}: ${source === 'template' ? 'шаблон' : 'LLM'}`)
            await saveFeedback(target.shopId ?? 0, media, answer, source, null)
            console.log(`[cron] отвечено на ${fb.id} (${source})`)
          }
        } catch (e) {
          totalFailed++
          const msg = e instanceof Error ? e.message : String(e)
          details.push(`❌ ${target.name} ${fb.id}: ${msg.slice(0, 80)}`)
          console.error(`[cron] ошибка на ${fb.id}:`, msg)
          try {
            await saveFeedback(target.shopId ?? 0, media, null, null, msg.slice(0, 400), 'error')
          } catch (dbErr) {
            console.error(`[cron] не удалось сохранить ошибку в БД:`, dbErr instanceof Error ? dbErr.message : dbErr)
          }
        }
        // пауза между обращениями к WB API (для персонального токена)
        if (MAX_ANSWERS_PER_RUN > 1) {
          await new Promise((r) => setTimeout(r, 1500))
        }
      }
    }

    await reportRun({ total: totalAnswered + totalFailed, answered: totalAnswered, failed: totalFailed, details })

    // Еженедельный авто-анализ: по воскресеньям (UTC) после ответов на отзывы
    const isSunday = new Date().getUTCDay() === 0
    if (isSunday && getDb()) {
      try {
        await runWeeklyInsights()
      } catch (e) {
        console.error('[cron] ошибка еженедельного анализа:', e instanceof Error ? e.message : e)
      }
    }

    return res.status(200).json({
      ok: true,
      answered: totalAnswered,
      failed: totalFailed,
      telegram: isTelegramConfigured() ? 'sent' : 'skipped (не настроен)',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[cron] фатальная ошибка:', msg)
    await reportError('Запуск cron', msg)
    // наружу не отдаём детали ошибки (могут содержать служебную информацию)
    return res.status(500).json({ error: 'Internal error, детали в логах Vercel' })
  }
}

/** Еженедельный LLM-анализ отзывов за месяц по каждому магазину + сводка в Telegram. */
async function runWeeklyInsights() {
  const shops = await listShops()
  for (const shop of shops) {
    if (!shop.enabled) continue
    try {
      const feedbacks = await listFeedbacksSince(shop.id, 30)
      if (feedbacks.length === 0) continue

      const result = await analyzeFeedbacks(feedbacks)
      await saveInsight(shop.id, 'month', result.themes, result.overview, feedbacks.length)

      if (isTelegramConfigured()) {
        const negative = result.themes.filter((t) => t.sentiment === 'negative')
        const top = negative.sort((a, b) => b.count - a.count).slice(0, 3)
        const lines = [
          `📊 <b>Недельная аналитика: ${shop.name}</b>`,
          `Отзывов за месяц: ${feedbacks.length}`,
          '',
          top.length
            ? top.map((t) => `🔴 ${t.title} — ${t.count} отз.`).join('\n')
            : '🔴 Серьёзных проблем не найдено',
          '',
          'Полный отчёт — во вкладке «Аналитика» панели.',
        ]
        await sendMessage(lines.join('\n'))
      }
      console.log(`[cron] недельный анализ готов: ${shop.name} (${feedbacks.length} отзывов)`)
    } catch (e) {
      console.error(`[cron] анализ ${shop.name} не удался:`, e instanceof Error ? e.message : e)
    }
  }
}
