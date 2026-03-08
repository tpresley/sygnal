// Detect Sygnal on the inspected page and create the DevTools panel
function detectSygnal(callback) {
  chrome.devtools.inspectedWindow.eval(
    '!!(window.__SYGNAL_DEVTOOLS__)',
    (result, error) => callback(!error && result)
  )
}

function tryCreate() {
  detectSygnal((found) => {
    if (found) {
      chrome.devtools.panels.create(
        'Sygnal',
        'icons/icon16.png',
        'panel.html'
      )
    } else {
      // Retry — app may not have initialized yet
      setTimeout(tryCreate, 1000)
    }
  })
}

tryCreate()
