// Two small hand-written custom elements, defined once at startup like any web component library.

// <star-field>: a form-associated element (static formAssociated): it submits its value under
// its name, even from outside the <form> through the `form` attribute, and fires a composed
// `rate` CustomEvent whose detail is the new value.
class StarField extends HTMLElement {
  static formAssociated = true
  #internals = this.attachInternals()
  #value = 0
  constructor() {
    super()
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        button { font-size: 1.3rem; background: none; border: 0; cursor: pointer; color: #b8bcc6; padding: 0 2px; }
        button[aria-pressed="true"] { color: #f5a524; }
      </style>
      <span role="group" aria-label="Stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" aria-label="${n} stars">★</button>`).join('')}</span>`
    this.shadowRoot.addEventListener('click', (e) => {
      const n = Number(e.target.dataset?.n)
      if (!n) return
      this.value = n
      this.dispatchEvent(new CustomEvent('rate', { detail: n, bubbles: true, composed: true }))
    })
  }
  get value() { return this.#value }
  set value(v) {
    this.#value = Number(v) || 0
    this.#internals.setFormValue(String(this.#value))
    for (const b of this.shadowRoot.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.n) <= this.#value))
  }
  get form() { return this.#internals.form }
}

// <chip-picker>: `list` is the element's own property (an array of strings), set as a property
// by Sygnal on hyphenated tags; picking a chip fires `pick` with the chip as its detail.
class ChipPicker extends HTMLElement {
  #list = []
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this.shadowRoot.addEventListener('click', (e) => {
      const chip = e.target.dataset?.chip
      if (chip) this.dispatchEvent(new CustomEvent('pick', { detail: chip, bubbles: true, composed: true }))
    })
  }
  get list() { return this.#list }
  set list(items) {
    this.#list = Array.isArray(items) ? items : []
    this.shadowRoot.innerHTML = `
      <style>
        button { margin: 2px; border: 1px solid #a5a8f5; border-radius: 999px; background: none; color: inherit; padding: 1px 10px; cursor: pointer; font: inherit; }
      </style>
      ${this.#list.map((c) => `<button type="button" data-chip="${c}">${c}</button>`).join('')}`
  }
}

if (!customElements.get('star-field')) customElements.define('star-field', StarField)
if (!customElements.get('chip-picker')) customElements.define('chip-picker', ChipPicker)
