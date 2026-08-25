// API: добавить магазин
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from '../lib/auth.js'
import { addShop, initDb } from '../lib/db.js'
import { WbClient } from '../lib/wb-client.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { name, token, mode } = req.body as { name?: string; token?: string; mode?: string }
  if (!name?.trim() || !token?.trim()) {
    return res.status(400).json({ error: 'Нужны name и token' })
  }
  const validModes = ['templates', 'drafts', 'llm']
  if (!validModes.includes(validMode)) {
    return res.status(400).json({ error: 'mode: templates, drafts или llm' })
  }

  // проверяем токен перед сохранением
  try {
    await new WbClient(token.trim()).getUnansweredFeedbacks(1, 0)
  } catch (e) {
    return res.status(400).json({
      error: `Токен не работает: ${e instanceof Error ? e.message : e}`,
    })
  }

  await initDb()
  const id = await addShop(name.trim(), token.trim(), validMode)
  res.status(200).json({ ok: true, id })
}
