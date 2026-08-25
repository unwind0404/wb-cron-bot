// Telegram-уведомления через Bot API. Полностью опциональны:
// если TG_BOT_TOKEN или TG_CHAT_ID не заданы, уведомления пропускаются.

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TG_BOT_TOKEN && process.env.TG_CHAT_ID)
}

export async function sendMessage(text: string): Promise<boolean> {
  if (!isTelegramConfigured()) {
    console.log('[tg] не настроен, пропускаю уведомление')
    return false
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TG_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })

    if (!res.ok) {
      console.error(`[tg] ошибка ${res.status}: ${(await res.text()).slice(0, 200)}`)
      return false
    }
    return true
  } catch (e) {
    console.error('[tg] ошибка:', e instanceof Error ? e.message : e)
    return false
  }
}

export type RunSummary = {
  total: number
  answered: number
  failed: number
  details: string[]
}

export function reportRun(summary: RunSummary): Promise<boolean> {
  const now = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
  const lines = [
    '🤖 <b>WB Review Bot — отчёт</b>',
    `📅 ${now}`,
    '',
    `Новых отзывов: <b>${summary.total}</b>`,
    `✅ Отвечено: ${summary.answered}`,
    summary.failed ? `❌ Ошибок: ${summary.failed}` : '',
    summary.details.length ? '' : '',
    ...summary.details.slice(0, 15),
  ].filter((line) => line !== '')

  return sendMessage(lines.join('\n'))
}

export function reportError(context: string, error: string): Promise<boolean> {
  return sendMessage(
    `⚠️ <b>Ошибка WB Review Bot</b>\n${context}\n<code>${error.slice(0, 400)}</code>`,
  )
}
