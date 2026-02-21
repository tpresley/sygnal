export function createClipboardDriver() {
  return (fromApp$) => {
    fromApp$.addListener({
      next: async (request) => {
        if (!request || typeof request.text !== 'string') return

        try {
          if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(request.text)
          }
        } catch (error) {
          console.error('Clipboard write failed:', error)
        }
      },
      error: (error) => {
        console.error('Clipboard driver stream error:', error)
      },
      complete: () => {}
    })

    return {}
  }
}
