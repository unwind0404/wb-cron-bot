// Генерация ответов: шаблоны по звёздам или LLM через OpenRouter

export type FeedbackInput = {
  rating?: number
  text?: string
  pros?: string
  cons?: string
  productName?: string
  userName?: string
}

// Шаблоны по умолчанию (можно переопределить переменной TEMPLATES_JSON:
// {"5": "текст", "4": "текст", ...})
const DEFAULT_TEMPLATES: Record<number, string> = {
  5: 'Здравствуйте! Огромное спасибо за ваш отзыв и высокую оценку! Нам очень приятно, что покупка вас порадовала. Будем рады видеть вас снова!',
  4: 'Здравствуйте! Благодарим за отзыв и оценку! Рады, что покупка вам понравилась. Будем стараться стать ещё лучше. Ждём вас снова!',
  3: 'Здравствуйте! Спасибо за ваш отзыв. Нам жаль, что опыт покупки не был идеальным. Напишите нам, что можно улучшить — мы обязательно прислушаемся.',
  2: 'Здравствуйте! Приносим извинения за доставленные неудобства. Ваш отзыв важен для нас — напишите, пожалуйста, что пошло не так, и мы постараемся решить проблему.',
  1: 'Здравствуйте! Искренне сожалеем, что покупка вас разочаровала. Мы обязательно разберёмся в ситуации. Свяжитесь с нами, и мы сделаем всё возможное, чтобы исправить положение.',
}

function getTemplates(): Record<number, string> {
  const raw = process.env.TEMPLATES_JSON
  if (!raw) return DEFAULT_TEMPLATES
  try {
    return { ...DEFAULT_TEMPLATES, ...(JSON.parse(raw) as Record<number, string>) }
  } catch {
    return DEFAULT_TEMPLATES
  }
}

export function templateAnswer(rating = 3): string {
  const templates = getTemplates()
  // ищем точную оценку, иначе ближайшую
  if (templates[rating]) return templates[rating]
  const closest = Object.keys(templates)
    .map(Number)
    .sort((a, b) => Math.abs(a - rating) - Math.abs(b - rating))[0]
  return templates[closest] ?? 'Здравствуйте! Спасибо за ваш отзыв!'
}

function buildPrompt(fb: FeedbackInput): string {
  const stars = fb.rating ?? 3
  const tone =
    stars >= 4
      ? 'Поблагодари покупателя за отзыв и покупку. Будь радушным.'
      : stars === 3
        ? 'Поблагодари за отзыв, мягко вырази надежду на улучшение опыта, предложи обратиться в поддержку.'
        : 'Искренне извинись за негативный опыт, не оправдывайся, предложи связаться для решения проблемы.'

  return `Ты — сотрудник поддержки интернет-магазина на Wildberries. Напиши ответ на отзыв покупателя от лица магазина.

Правила:
- Пиши только текст ответа, без кавычек и пояснений.
- Обращайся на «Вы».
- Длина: 2–4 предложения.
- ${tone}
${fb.userName ? `- Можно обратиться к покупателю по имени (${fb.userName}).` : ''}
${fb.productName ? `- Товар: ${fb.productName}.` : ''}

Отзыв (оценка ${stars} из 5):
${fb.text || '(только оценка, без текста)'}
${fb.pros ? `Достоинства: ${fb.pros}` : ''}
${fb.cons ? `Недостатки: ${fb.cons}` : ''}`
}

export async function llmAnswer(fb: FeedbackInput): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('Не задан OPENROUTER_API_KEY')

  const model = process.env.LLM_MODEL || 'deepseek/deepseek-chat-v3-0324:free'
  const fallbackModel =
    process.env.LLM_FALLBACK_MODEL || 'meta-llama/llama-3.3-70b-instruct:free'

  for (const m of [model, fallbackModel]) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: m,
          max_tokens: 300,
          messages: [{ role: 'user', content: buildPrompt(fb) }],
        }),
      })
      if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 150)}`)
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      const answer = data.choices?.[0]?.message?.content?.trim()
      if (answer) return answer
      throw new Error('Пустой ответ модели')
    } catch (e) {
      console.error(`[llm] модель ${m} не сработала:`, e instanceof Error ? e.message : e)
    }
  }
  throw new Error('Обе LLM-модели недоступны')
}

/** Режим: templates | llm */
export async function generateAnswer(
  fb: FeedbackInput,
): Promise<{ answer: string; source: 'template' | 'llm' }> {
  const mode = process.env.ANSWER_MODE || 'templates'
  if (mode === 'templates') return { answer: templateAnswer(fb.rating), source: 'template' }
  const answer = await llmAnswer(fb)
  return { answer, source: 'llm' }
}
