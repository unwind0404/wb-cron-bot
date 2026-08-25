// API: изменить/удалить магазин (POST с action: mode | toggle | delete)
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from '../lib/auth.js'
import { updateShopMode, toggleShop, deleteShop } from '../lib/db.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { id, action, mode, enabled } = req.body as {
    id?: number
    action?: string
    mode?: string
    enabled?: boolean
  }
  if (!id || !action) return res.status(400).json({ error: 'Нужны id и action' })

  try {
    if (action === 'mode') {
      if (mode !== 'templates' && mode !== 'llm') {
        return res.status(400).json({ error: 'mode должен быть templates или llm' })
      }
      await updateShopMode(id, mode)
    } else if (action === 'toggle') {
      await toggleShop(id, Boolean(enabled))
    } else if (action === 'delete') {
      await deleteShop(id)
    } else {
      return res.status(400).json({ error: 'Неизвестный action' })
    }
    res.status(200).json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
}
