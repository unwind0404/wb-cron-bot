// Vercel Cron: раз в день проверяет неотвеченные отзывы и отвечает на них.
// Защита: запросы без заголовка Authorization (CRON_SECRET) отклоняются,
// кроме легитимных вызовов от Vercel Cron (заголовок x-vercel-cron).

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { WbClient, type WbFeedback } from '../lib/wb-client.js'
import { generateAnswer } from '../lib/generator.js'
import { reportRun, reportError, isTelegramConfigured } from '../lib/telegram.js'

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

  const token = process.env.WB_API_TOKEN
  if (!token) {
    const msg = 'WB_API_TOKEN not set'
    console.error('[cron]', msg)
    return res.status(500).json({ error: msg })
  }

  console.log('[cron] старт')

  try {
    const client = new WbClient(token)
    const feedbacks = await client.getUnansweredFeedbacks()
    console.log(`[cron] неотвеченных отзывов: ${feedbacks.length}`)

    if (feedbacks.length === 0) {
      await reportRun({ total: 0, answered: 0, failed: 0, details: ['Новых отзывов нет 🎉'] })
      return res.status(200).json({
        ok: true,
        total: 0,
        answered: 0,
        failed: 0,
        telegram: isTelegramConfigured() ? 'sent' : 'skipped (не настроен)',
      })
    }

    let answered = 0
    let failed = 0
    const details: string[] = []

    for (const fb of feedbacks) {
      try {
        const { answer, source } = await generateAnswer(fb)
        await client.answerFeedback(fb.id, answer)
        answered++
        const stars = '★'.repeat(fb.rating ?? 0)
        details.push(`${stars} ${fb.productDetails?.productName ?? ''}: ${source === 'template' ? 'шаблон' : 'LLM'}`)
        console.log(`[cron] отвечено на ${fb.id} (${source})`)
      } catch (e) {
        failed++
        const msg = e instanceof Error ? e.message : String(e)
        details.push(`❌ ${fb.id}: ${msg.slice(0, 80)}`)
        console.error(`[cron] ошибка на ${fb.id}:`, msg)
      }
      // пауза между обращениями к WB API (лимит 3 req/s, берём запас)
      await new Promise((r) => setTimeout(r, 1500))
    }

    await reportRun({ total: feedbacks.length, answered, failed, details })
    return res.status(200).json({
      ok: true,
      total: feedbacks.length,
      answered,
      failed,
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
