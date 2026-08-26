// LLM-анализ отзывов: группировка по темам с выводами и рекомендациями.

import type { FeedbackRow } from './db.js'

export type InsightTheme = {
  /** Название темы, например «Не тот принт на наволочках» */
  title: string
  /** sentiment: negative | positive | neutral */
  sentiment: 'negative' | 'positive' | 'neutral'
  /** Сколько отзывов в теме */
  count: number
  /** Краткая суть проблемы/похвалы */
  summary: string
  /** 1–2 короткие цитаты покупателей */
  quotes: string[]
  /** Рекомендация продавцу (для негативных тем) */
  recommendation?: string
}

export type InsightResult = {
  themes: InsightTheme[]
  /** Общий вывод по периоду */
  overview: string
}

const ANALYSIS_PROMPT = `Ты — аналитик интернет-магазина на Wildberries. Проанализируй отзывы покупателей и сгруппируй их по темам.

Правила:
- Группируй по смыслу: одна тема = одна проблема или одна похвала (например «Пришёл не тот принт», «Быстрая доставка», «Хорошее качество ткани»).
- Для каждой темы укажи sentiment: negative (жалоба), positive (похвала), neutral (вопрос/прочее).
- count — сколько отзывов относятся к теме.
- quotes — 1–2 короткие цитаты покупателей (до 100 символов, дословно из отзывов).
- recommendation — только для negative-тем: конкретный совет продавцу, что проверить/исправить.
- overview — общий вывод: какая главная проблема, что хвалят, на что обратить внимание в первую очередь.
- Не выдумывай отзывы. Если отзывов мало или они однотипные — тем будет меньше.
- Отвечай СТРОГО валидным JSON без markdown-обёртки, по схеме:
{"themes":[{"title":"...","sentiment":"negative","count":1,"summary":"...","quotes":["..."],"recommendation":"..."}],"overview":"..."}`

function buildFeedbacksText(feedbacks: FeedbackRow[]): string {
  return feedbacks
    .map((fb, i) => {
      const parts = [
        `${i + 1}. Оценка: ${fb.rating ?? '?'}/5`,
        fb.product_name ? `Товар: ${fb.product_name}` : '',
        fb.subject_name ? `Категория: ${fb.subject_name}` : '',
        fb.text ? `Отзыв: ${fb.text.slice(0, 500)}` : 'Отзыв: (без текста)',
        fb.pros ? `Плюсы: ${fb.pros}` : '',
        fb.cons ? `Минусы: ${fb.cons}` : '',
      ].filter(Boolean)
      return parts.join(' | ')
    })
    .join('\n')
}

function parseInsight(raw: string): InsightResult {
  // LLM иногда оборачивает JSON в ```json ... ``` — срезаем
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const parsed = JSON.parse(cleaned) as InsightResult

  if (!Array.isArray(parsed.themes)) throw new Error('Нет массива themes в ответе LLM')
  // нормализация и защита от мусора
  parsed.themes = parsed.themes
    .filter((t) => t && typeof t.title === 'string')
    .map((t) => ({
      title: String(t.title).slice(0, 120),
      sentiment: t.sentiment === 'positive' || t.sentiment === 'neutral' ? t.sentiment : 'negative',
      count: Number(t.count) || 1,
      summary: String(t.summary ?? '').slice(0, 500),
      quotes: Array.isArray(t.quotes) ? t.quotes.slice(0, 2).map((q) => String(q).slice(0, 150)) : [],
      recommendation: t.recommendation ? String(t.recommendation).slice(0, 400) : undefined,
    }))
  parsed.overview = String(parsed.overview ?? '').slice(0, 1000)
  return parsed
}

async function askLLM(prompt: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('Для анализа нужен OPENROUTER_API_KEY')

  const models = [
    process.env.LLM_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free',
    process.env.LLM_FALLBACK_MODEL || 'minimax/minimax-m2.7:free',
  ]

  let lastError: Error = new Error('Модели не настроены')
  for (const model of models) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 2000,
          messages: [
            { role: 'system', content: ANALYSIS_PROMPT },
            { role: 'user', content: prompt },
          ],
        }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`LLM ${res.status}: ${body.slice(0, 150)}`)
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      const content = data.choices?.[0]?.message?.content?.trim()
      if (!content) throw new Error('Пустой ответ модели')
      return content
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      console.error(`[insights] модель ${model} не сработала: ${lastError.message}`)
    }
  }
  throw new Error(`LLM недоступны: ${lastError.message}`)
}

/** Анализирует отзывы и возвращает сгруппированные темы. */
export async function analyzeFeedbacks(feedbacks: FeedbackRow[]): Promise<InsightResult> {
  if (feedbacks.length === 0) {
    return { themes: [], overview: 'За выбранный период отзывов нет.' }
  }

  const text = buildFeedbacksText(feedbacks)
  // защита от слишком длинного промпта (~30 отзывов за раз хватает)
  const trimmed = text.length > 25_000 ? text.slice(0, 25_000) : text

  const raw = await askLLM(
    `Проанализируй ${feedbacks.length} отзывов магазина за период:\n\n${trimmed}`,
  )
  return parseInsight(raw)
}
