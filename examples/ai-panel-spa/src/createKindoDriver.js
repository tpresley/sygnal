import xs from 'xstream'

const DEFAULT_ENDPOINT = 'https://llm.kindo.ai/v1/chat/completions'

function normalizeError(error) {
  if (!error) return 'Unknown error'
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  try {
    return JSON.stringify(error)
  } catch (_error) {
    return String(error)
  }
}

export function createKindoDriver(defaultEndpoint = DEFAULT_ENDPOINT) {
  return (fromApp$) => {
    let pushToApp = () => {}

    const toApp$ = xs.create({
      start: (listener) => {
        pushToApp = listener.next.bind(listener)
      },
      stop: () => {}
    })

    fromApp$.addListener({
      next: async (request) => {
        if (!request || typeof request !== 'object') return

        const {
          requestId,
          kind,
          endpoint = defaultEndpoint,
          apiKey,
          body
        } = request

        if (!apiKey || !body) {
          pushToApp({
            type: 'error',
            request,
            error: 'Missing apiKey or request body for KINDO request'
          })
          return
        }

        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'api-key': apiKey,
              'content-type': 'application/json'
            },
            body: JSON.stringify(body)
          })

          let payload = null
          try {
            payload = await response.json()
          } catch (_error) {
            payload = null
          }

          if (!response.ok) {
            const statusReason = payload?.error?.message || payload?.message || `HTTP ${response.status}`
            pushToApp({
              type: 'error',
              request,
              error: `Kindo request failed (${statusReason})`
            })
            return
          }

          pushToApp({
            type: 'success',
            request: { ...request, requestId, kind },
            response: payload
          })
        } catch (error) {
          pushToApp({
            type: 'error',
            request,
            error: normalizeError(error)
          })
        }
      },
      error: (error) => {
        pushToApp({
          type: 'error',
          request: null,
          error: normalizeError(error)
        })
      },
      complete: () => {}
    })

    return {
      select: (selector) => {
        if (typeof selector === 'undefined') return toApp$
        if (typeof selector === 'function') return toApp$.filter(selector)
        return toApp$.filter((event) => event?.type === selector)
      }
    }
  }
}
