// stars.js
export const stars = {
  kind: 'widget',
  vnode: ({ value = 0, max = 5, ...props }, children, h) =>
    h('span', { ...props, role: 'img', 'aria-label': `${value} of ${max} stars` }, '★'.repeat(value) + '☆'.repeat(max - value)),
  commands: {
    flash: (element, { ms = 300 }) => {
      element.classList.add('flash')
      setTimeout(() => element.classList.remove('flash'), ms)
    },
  },
}
