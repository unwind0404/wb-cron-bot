// API: работа с черновиками
// GET  /api/drafts?shop_id=N            — черновики на одобрение
// POST /api/drafts {shop_id, feedback_id, action, answer}
//   action: 'approve' (отправить на WB) | 'reject' | 'regenerate'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from '../lib/auth.js'
import { getDb, listFeedbacks, updateFeedbackDraft } from '../lib/db.js'
import { WbClient } from '../lib/wb-client.js'
import { llmAnswer } from '../lib/generator.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAuth(req, res)) return

  // --- Список черновиков ---
  if (req.method === 'GET') {
    const shopId = req.query.shop_id ? Number(req.query.shop_id) : null
    const drafts = await listFeedbacks(shopId, 'draft')
    return res.status(200).json(drafts)
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'GET или POST' })

  const { shop_id, feedback_id, action, answer } = req.body as {
    shop_id?: number
    feedback_id?: string
    action?: string
    answer?: string
  }
  if (!shop_id || !feedback_id || !action) {
    return res.status(400).json({ error: 'Нужны shop_id, feedback_id и action' })
  }

  const db = getDb()
  if (!db) return res.status(500).json({ error: 'БД не настроена' })

  // --- Отклонить черновик ---
  if (action === 'reject') {
    await updateFeedbackDraft(shop_id, feedback_id, answer ?? '', 'rejected')
    return res.status(200).json({ ok: true })
  }

  // --- Одобрить и отправить на WB ---
  if (action === 'approve') {
    const text = answer?.trim()
    if (!text) return res.status(400).json({ error: 'Пустой текст ответа' })

    const shops = await db`SELECT token FROM shops WHERE id = ${shop_id}` as { token: string }[]
    if (!shops[0]) return res.status(404).json({ error: 'Магазин не найден' })

    try {
      await new WbClient(shops[0].token).answerFeedback(feedback_id, text)
      await updateFeedbackDraft(shop_id, feedback_id, text, 'answered')
      return res.status(200).json({ ok: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return res.status(500).json({ error: `WB не принял ответ: ${msg}` })
    }
  }

  // --- Перегенерировать черновик ---
  if (action === 'regenerate') {
    const rows = await db`
      SELECT rating, text, pros, cons, product_name, subject_name, user_name
      FROM feedbacks WHERE id = ${feedback_id} AND shop_id = ${shop_id} AND status = 'draft'
    ` as {
      rating: number | null
      text: string | null
      pros: string | null
      cons: string | null
      product_name: string | null
      subject_name: string | null
      user_name: string | null
    }[]
    if (!rows[0]) return res.status(404).json({ error: 'Черновик не найден' })

    const fb = rows[0]
    try {
      const newAnswer = await llmAnswer({
        rating: fb.rating ?? undefined,
        text: fb.text ?? undefined,
        pros: fb.pros ?? undefined,
        cons: fb.cons ?? undefined,
        productName: fb.product_name ?? undefined,
        userName: fb.user_name ?? undefined,
      })
      await updateFeedbackDraft(shop_id, feedback_id, newAnswer, 'rejected') // сброс в rejected, ниже вернём в draft
      await db`
        UPDATE feedbacks SET status = 'draft', answer = ${newAnswer}
        WHERE id = ${feedback_id} AND shop_id = ${shop_id}
      `
      return res.status(200).json({ ok: true, answer: newAnswer })
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  res.status(400).json({ error: 'action: approve | reject | regenerate' })
}
