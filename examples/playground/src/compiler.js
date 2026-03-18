import * as Babel from '@babel/standalone'
import * as Sygnal from 'sygnal'
import { createElement } from 'sygnal'
import { Fragment } from 'sygnal/jsx-runtime'

export function compile(code) {
  const result = Babel.transform(code, {
    plugins: [
      ['transform-react-jsx', { pragma: 'h', pragmaFrag: 'Fragment' }],
    ],
  })
  return result.code
}

export function evaluate(compiled) {
  const fn = new Function('h', 'Fragment', 'Sygnal', `
    const { run, xs, createRef, createRef$, processForm, processDrag, Collection, Switchable, ABORT, collection, switchable, classes } = Sygnal;
    ${compiled}
    if (typeof Component !== 'undefined') return Component;
    throw new Error('Define a function named Component');
  `)
  return fn(createElement, Fragment, Sygnal)
}

let currentApp = null

export function runComponent(component, mountPoint = '#preview') {
  if (currentApp) {
    currentApp.dispose()
    currentApp = null
  }
  const el = document.querySelector(mountPoint)
  if (el) el.innerHTML = ''

  currentApp = Sygnal.run(component, {}, { mountPoint })
  return currentApp
}
