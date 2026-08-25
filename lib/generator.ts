// Генерация ответов на отзывы: шаблоны по оценке или LLM через OpenRouter.

export type FeedbackInput = {
  rating?: number
  text?: string
  pros?: string
  cons?: string
  productName?: string
  userName?: string
}

export type AnswerSource = 'template' | 'llm'

// ---------- Шаблоны ----------

const DEFAULT_TEMPLATES: Record<number, string> = {
  5: 'Здравствуйте! Огромное спасибо за ваш отзыв и высокую оценку! Нам очень приятно, что покупка вас порадовала. Будем рады видеть вас снова!',
  4: 'Здравствуйте! Благодарим за отзыв и оценку! Рады, что покупка вам понравилась. Будем стараться стать ещё лучше. Ждём вас снова!',
  3: 'Здравствуйте! Спасибо за ваш отзыв. Нам жаль, что опыт покупки не был идеальным. Напишите нам, что можно улучшить — мы обязательно прислушаемся.',
  2: 'Здравствуйте! Приносим извинения за доставленные неудобства. Ваш отзыв важен для нас — напишите, пожалуйста, что пошло не так, и мы постараемся решить проблему.',
  1: 'Здравствуйте! Искренне сожалеем, что покупка вас разочаровала. Мы обязательно разберёмся в ситуации. Свяжитесь с нами, и мы сделаем всё возможное, чтобы исправить положение.',
}

/** Пользовательские шаблоны из TEMPLATES_JSON ({"5": "текст", ...}) поверх дефолтных. */
function getTemplates(): Record<number, string> {
  const raw = process.env.TEMPLATES_JSON
  if (!raw) return DEFAULT_TEMPLATES
  try {
    return { ...DEFAULT_TEMPLATES, ...JSON.parse(raw) }
  } catch {
    console.error('[templates] TEMPLATES_JSON невалиден, использую дефолтные')
    return DEFAULT_TEMPLATES
  }
}

export function templateAnswer(rating = 3): string {
  const templates = getTemplates()
  if (templates[rating]) return templates[rating]

  // ближайшая доступная оценка
  const closest = Object.keys(templates)
    .map(Number)
    .sort((a, b) => Math.abs(a - rating) - Math.abs(b - rating))[0]
  return templates[closest] ?? 'Здравствуйте! Спасибо за ваш отзыв!'
}

// ---------- LLM ----------

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'deepseek/deepseek-chat-v3-0324:free'
const DEFAULT_FALLBACK_MODEL = 'meta-llama/llama-3.3-70b-instruct:free'

function buildPrompt(fb: FeedbackInput): string {
  const stars = fb.rating ?? 3
  const tone =
    stars >= 4
      ? 'Поблагодари покупателя за отзыв и покупку. Будь радушным.'
      : stars === 3
        ? 'Поблагодари за отзыв, мягко вырази надежду на улучшение опыта, предложи обратиться в поддержку.'
        : 'Искренне извинись за негативный опыт, не оправдывайся, предложи связаться для решения проблемы.'

  return [
    'Ты — сотрудник поддержки интернет-магазина на Wildberries.',
    'Напиши ответ на отзыв покупателя от лица магазина.',
    '',
    'Правила:',
    '- Пиши только текст ответа, без кавычек и пояснений.',
    '- Обращайся на «Вы».',
    '- Длина: 2–4 предложения.',
    `- ${tone}`,
    fb.userName ? `- Можно обратиться к покупателю по имени (${fb.userName}).` : '',
    fb.productName ? `- Товар: ${fb.productName}.` : '',
    '',
    `Отзыв (оценка ${stars} из 5):`,
    fb.text || '(только оценка, без текста)',
    fb.pros ? `Достоинства: ${fb.pros}` : '',
    fb.cons ? `Недостатки: ${fb.cons}` : '',
  ].filter(Boolean).join('\n')
}

async function askModel(model: string, apiKey: string, prompt: string): Promise<string> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`LLM ${res.status}: ${body.slice(0, 150)}`)
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const answer = data.choices?.[0]?.message?.content?.trim()
  if (!answer) throw new Error('Пустой ответ модели')
  return answer
}

export async function llmAnswer(fb: FeedbackInput): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('Не задан OPENROUTER_API_KEY')

  const models = [
    process.env.LLM_MODEL || DEFAULT_MODEL,
    process.env.LLM_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL,
  ]

  const prompt = buildPrompt(fb)
  let lastError: Error = new Error('Модели не настроены')

  for (const model of models) {
    try {
      return await askModel(model, apiKey, prompt)
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      console.error(`[llm] модель ${model} не сработала: ${lastError.message}`)
    }
  }

  throw new Error(`Обе LLM-модели недоступны (последняя ошибка: ${lastError.message})`)
}

// ---------- Публичный API ----------

export async function generateAnswer(
  fb: FeedbackInput,
  mode: 'templates' | 'llm',
): Promise<{ answer: string; source: AnswerSource }> {
  if (mode === 'llm') {
    return { answer: await llmAnswer(fb), source: 'llm' }
  }
  return { answer: templateAnswer(fb.rating), source: 'template' }
}
