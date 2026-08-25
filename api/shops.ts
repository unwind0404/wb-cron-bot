// API: список магазинов
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from '../lib/auth.js'
import { listShops, initDb } from '../lib/db.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAuth(req, res)) return
  await initDb()
  const shops = await listShops()
  // токен наружу не отдаём — только маску
  res.status(200).json(
    shops.map((s) => ({
      id: s.id,
      name: s.name,
      mode: s.mode,
      enabled: s.enabled,
      tokenMask: s.token.slice(0, 6) + '…' + s.token.slice(-4),
    })),
  )
}
