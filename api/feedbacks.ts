// API: список обработанных отзывов
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from '../lib/auth.js'
import { listFeedbacks, initDb } from '../lib/db.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAuth(req, res)) return
  await initDb()
  const shopId = req.query.shop_id ? Number(req.query.shop_id) : null
  const status = (req.query.status as string) || null
  const feedbacks = await listFeedbacks(shopId, status)
  res.status(200).json(feedbacks)
}
