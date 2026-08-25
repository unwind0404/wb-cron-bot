// Telegram-отчёты через Bot API

function config() {
  return {
    botToken: process.env.TG_BOT_TOKEN ?? '',
    chatId: process.env.TG_CHAT_ID ?? '',
  }
}

/** Telegram опционален: отчёты шлются только если заданы обе переменные. */
export function isTelegramConfigured(): boolean {
  const { botToken, chatId } = config()
  return Boolean(botToken && chatId)
}

async function sendMessage(text: string): Promise<boolean> {
  const { botToken, chatId } = config()
  if (!botToken || !chatId) {
    console.log('[tg] не настроен, пропускаю уведомление')
    return false
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
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

export function reportRun(summary: {
  total: number
  answered: number
  failed: number
  details: string[]
}): Promise<boolean> {
  const lines =
    `🤖 <b>WB Review Bot — отчёт</b>\n` +
    `📅 ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}\n\n` +
    `Новых отзывов: <b>${summary.total}</b>\n` +
    `✅ Отвечено: ${summary.answered}\n` +
    (summary.failed ? `❌ Ошибок: ${summary.failed}\n` : '') +
    (summary.details.length ? `\n${summary.details.slice(0, 15).join('\n')}` : '')
  return sendMessage(lines)
}

export function reportError(context: string, error: string): Promise<boolean> {
  return sendMessage(`⚠️ <b>Ошибка WB Review Bot</b>\n${context}\n<code>${error.slice(0, 400)}</code>`)
}
