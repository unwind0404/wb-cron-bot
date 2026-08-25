// Клиент WB API «Вопросы и отзывы».
// Документация: https://dev.wildberries.ru (feedbacks-api.wildberries.ru)

const BASE_URL = 'https://feedbacks-api.wildberries.ru'

export type WbFeedbackPhoto = {
  /** Ссылка на фото (отдаётся WB API в photoLinks) */
  src: string
}

export type WbFeedbackVideo = {
  /** Ссылка на видео или превью (отдаётся WB API в video) */
  src?: string
  preview?: string
}

export type WbFeedback = {
  id: string
  text?: string
  pros?: string
  cons?: string
  productValuation?: number
  createdDate?: string
  userName?: string
  /** Фотографии покупателя */
  photoLinks?: string[]
  /** Видео покупателя (объект с полями ссылки/превью) */
  video?: WbFeedbackVideo | null
  /** Категория товара (например «Футболки-поло») */
  subjectName?: string
  /** Артикул, наименование и характеристики товара */
  productDetails?: {
    nmId?: number
    productName?: string
    imtId?: number
    [key: string]: unknown
  }
}

export class WbClient {
  constructor(private readonly token: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        ...init,
        headers: {
          Authorization: this.token,
          'Content-Type': 'application/json',
          ...init?.headers,
        },
      })
    } catch (e) {
      throw new Error(`Сеть недоступна: ${e instanceof Error ? e.message : e}`)
    }

    switch (res.status) {
      case 204:
        return undefined as T
      case 401:
        throw new Error('Токен WB невалиден или не имеет доступа к отзывам (401)')
      case 402:
        throw new Error('Требуется оплата тарифа WB API (402)')
      case 429:
        throw new Error('Превышен лимит запросов WB (429)')
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`WB API ${res.status}: ${body.slice(0, 300)}`)
    }

    return (await res.json()) as T
  }

  /** Список неотвеченных отзывов (новые сверху). */
  async getUnansweredFeedbacks(take = 100, skip = 0): Promise<WbFeedback[]> {
    const data = await this.request<{
      data: { feedbacks: WbFeedback[] }
      error: boolean
      errorText: string
    }>(`/api/v1/feedbacks?isAnswered=false&take=${take}&skip=${skip}&order=dateDesc`)

    return data.data?.feedbacks ?? []
  }

  /** Ответить на отзыв. Успех — 204 без тела. */
  async answerFeedback(feedbackId: string, text: string): Promise<void> {
    await this.request('/api/v1/feedbacks/answer', {
      method: 'POST',
      body: JSON.stringify({ id: feedbackId, text }),
    })
  }
}
