// Service worker: routes messages between content scripts and DevTools panels
const panelPorts = new Map() // tabId → port

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sygnal-devtools-panel') return

  let tabId = null

  port.onMessage.addListener((msg) => {
    // First message from panel identifies the tab
    if (msg.type === 'INIT' && msg.tabId) {
      tabId = msg.tabId
      panelPorts.set(tabId, port)

      // Tell content script to connect
      chrome.tabs.sendMessage(tabId, {
        source: '__SYGNAL_DEVTOOLS_EXTENSION__',
        type: 'CONNECT',
        payload: {}
      }).catch(() => {})
      return
    }

    // Forward panel → content script (page)
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        source: '__SYGNAL_DEVTOOLS_EXTENSION__',
        ...msg
      }).catch(() => {})
    }
  })

  port.onDisconnect.addListener(() => {
    if (tabId) {
      panelPorts.delete(tabId)
      chrome.tabs.sendMessage(tabId, {
        source: '__SYGNAL_DEVTOOLS_EXTENSION__',
        type: 'DISCONNECT',
        payload: {}
      }).catch(() => {})
    }
  })
})

// Content script → panel
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.source !== '__SYGNAL_DEVTOOLS_PAGE__') return
  const tabId = sender.tab?.id
  if (!tabId) return

  const port = panelPorts.get(tabId)
  if (port) {
    port.postMessage(msg)
  }
})
