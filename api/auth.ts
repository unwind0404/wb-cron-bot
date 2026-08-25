// API: вход/выход/статус авторизации
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { checkPassword, createSessionToken, setSessionCookie, clearSessionCookie, isAuthed } from '../lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = req.query.action

  if (action === 'status') {
    return res.status(200).json({ authed: isAuthed(req), configured: Boolean(process.env.ADMIN_PASSWORD) })
  }

  if (action === 'logout') {
    clearSessionCookie(res)
    return res.status(200).json({ ok: true })
  }

  // login
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const { password } = req.body as { password?: string }
  if (!checkPassword(password)) {
    // небольшая задержка против брутфорса
    await new Promise((r) => setTimeout(r, 800))
    return res.status(401).json({ error: 'Неверный пароль' })
  }
  setSessionCookie(res, createSessionToken())
  res.status(200).json({ ok: true })
}
