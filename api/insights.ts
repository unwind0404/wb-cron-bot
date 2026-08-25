// API: аналитика отзывов — запуск анализа и история
// GET  /api/insights?shop_id=N          — история анализов магазина
// POST /api/insights  {shop_id, period} — запустить анализ ('month' | 'quarter')
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from '../lib/auth.js'
import { getDb, initDb, listInsights, listFeedbacksSince, saveInsight } from '../lib/db.js'
import { analyzeFeedbacks } from '../lib/insights.js'

const PERIOD_DAYS: Record<string, number> = { month: 30, quarter: 90 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAuth(req, res)) return

  const db = getDb()
  if (!db) {
    return res.status(500).json({ error: 'БД не настроена (DATABASE_URL)' })
  }
  await initDb()

  // --- Запуск анализа ---
  if (req.method === 'POST') {
    const { shop_id, period } = req.body as { shop_id?: number; period?: string }
    if (!shop_id) return res.status(400).json({ error: 'Нужен shop_id' })
    const days = PERIOD_DAYS[period ?? 'month']
    if (!days) return res.status(400).json({ error: 'period: month или quarter' })

    const feedbacks = await listFeedbacksSince(shop_id, days)
    if (feedbacks.length === 0) {
      return res.status(200).json({
        ok: true,
        empty: true,
        message: `За последние ${days} дней отзывов нет — анализировать нечего.`,
      })
    }

    try {
      const result = await analyzeFeedbacks(feedbacks)
      const id = await saveInsight(shop_id, period ?? 'month', result.themes, result.overview, feedbacks.length)
      return res.status(200).json({ ok: true, id, feedbacks_count: feedbacks.length, ...result })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[insights] ошибка анализа:', msg)
      return res.status(500).json({ error: msg })
    }
  }

  // --- История анализов ---
  if (req.method === 'GET') {
    const shopId = Number(req.query.shop_id)
    if (!shopId) return res.status(400).json({ error: 'Нужен shop_id' })
    const insights = await listInsights(shopId)
    return res.status(200).json(insights)
  }

  res.status(405).json({ error: 'GET или POST' })
}
