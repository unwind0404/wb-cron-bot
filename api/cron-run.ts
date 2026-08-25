// Ручной запуск cron из панели (требует авторизацию в панели)
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from '../lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  // Проксируем на cron-функцию с внутренним секретом
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return res.status(500).json({ error: 'CRON_SECRET не задан в настройках Vercel' })
  }

  const origin = `https://${req.headers.host}`
  const r = await fetch(`${origin}/api/cron`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  })
  const data = await r.json().catch(() => ({}))
  res.status(r.status).json(data)
}
