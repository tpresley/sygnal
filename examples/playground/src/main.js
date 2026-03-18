import { compile, evaluate, runComponent } from './compiler.js'
import * as examples from './examples.js'

const editor = document.getElementById('editor')
const errorPanel = document.getElementById('error-panel')
const exampleSelect = document.getElementById('examples')
const runBtn = document.getElementById('run-btn')
const autoRunCheckbox = document.getElementById('auto-run')

let debounceTimer = null

function showError(err) {
  errorPanel.textContent = err.message || String(err)
  errorPanel.className = 'has-error'
}

function clearError() {
  errorPanel.textContent = ''
  errorPanel.className = ''
}

function executeCode() {
  const code = editor.value
  if (!code.trim()) return

  clearError()
  try {
    const compiled = compile(code)
    const component = evaluate(compiled)
    runComponent(component)
  } catch (err) {
    showError(err)
  }
}

function scheduleRun() {
  if (!autoRunCheckbox.checked) return
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(executeCode, 600)
}

// Load example
function loadExample(name) {
  const code = examples[name]
  if (!code) return
  editor.value = code
  executeCode()
}

// Tab key support in textarea
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault()
    const start = editor.selectionStart
    const end = editor.selectionEnd
    editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end)
    editor.selectionStart = editor.selectionEnd = start + 2
    scheduleRun()
  }
})

editor.addEventListener('input', scheduleRun)
runBtn.addEventListener('click', executeCode)
exampleSelect.addEventListener('change', () => loadExample(exampleSelect.value))

// Load default example
loadExample('counter')
