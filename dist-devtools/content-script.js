// Relay between page (window.postMessage) and extension (chrome.runtime)

const PAGE_SOURCE = '__SYGNAL_DEVTOOLS_PAGE__'
const EXT_SOURCE = '__SYGNAL_DEVTOOLS_EXTENSION__'

// Page → Extension
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (event.data?.source !== PAGE_SOURCE) return

  try {
    chrome.runtime.sendMessage(event.data)
  } catch (e) {
    // Extension context invalidated (e.g. reload)
  }
})

// Extension → Page
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.source !== EXT_SOURCE) return
  window.postMessage(msg, '*')
})
