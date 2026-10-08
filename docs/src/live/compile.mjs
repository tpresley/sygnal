// The compiler of the live examples, shared by the build (src/plugins/remark-live.mjs compiles
// every live block, live-file and live-server block of a page) and the browser (src/live/
// runtime.ts loads it, and with it Babel, only when a reader runs edited code).
//
// @babel/standalone: JSX with the classic runtime (Sygnal's createElement and Fragment, as on
// the Try It page; spread children as oxc / esbuild compile them), TypeScript for ts/tsx, and ES
// modules to a CommonJS-style function body the runtime evaluates with its own `require`:
//   (require, module, exports, __h, __Fragment, __liveSet, __liveImport)
// The specifiers it needs are collected from the import / export / import() nodes (not from the
// generated code), so `requires` is exactly what the module imports.
import * as BabelNS from '@babel/standalone'

const Babel = /** @type {any} */ (BabelNS).transform ? BabelNS : /** @type {any} */ (BabelNS).default

/**
 * @typedef {{ code: string, requires: string[] }} Compiled
 * @typedef {{ lang: string, filename: string, component: string | false, sourceMaps?: boolean }} CompileOptions
 *   component: the component to report through __liveSet: a name (live=Name), 'auto' (the
 *   `export default`, else the last top-level capitalized function declaration) or false (a
 *   live-file or a live-server block)
 */

/** a code-frame error at the node, with its `loc` (the build reports the page's line from it) */
const refuse = (path, message) => Object.assign(path.buildCodeFrameError(message), { loc: path.node.loc?.start })

const isCap = (name) => !!name && /^[A-Z]/.test(name)
const SPREAD = '__liveSpread'

/** appends `__liveSet('Name', () => Name)` for the component to mount */
const pickComponent = (component) => ({ types: t }) => ({
  visitor: {
    Program: {
      enter(path) {
        if (component === false) return
        let name
        if (component !== 'auto') name = component
        else {
          let hasDefault = false
          for (const node of path.node.body) {
            if (node.type === 'ExportDefaultDeclaration') hasDefault = true
            if (node.type === 'ExportNamedDeclaration' && node.specifiers?.some((s) => (s.exported?.name ?? s.exported?.value) === 'default')) hasDefault = true
            const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : node
            if (decl?.type === 'FunctionDeclaration' && isCap(decl.id?.name)) name = decl.id.name
          }
          if (hasDefault) name = undefined
        }
        if (!name) return
        path.pushContainer('body', t.expressionStatement(
          t.callExpression(t.identifier('__liveSet'), [t.stringLiteral(name), t.arrowFunctionExpression([], t.identifier(name))]),
        ))
      },
    },
  },
})

/**
 * The module's specifiers, from the AST: static imports and re-exports (not type-only ones; read
 * when the Program is left, after TypeScript removed the imports it only uses as types, before
 * the CommonJS transform replaced them), and import('literal'). `import(x)` becomes
 * `__liveImport(x)`: the runtime's resolver, not the browser's. Top-level await and
 * import.meta are refused: the module body runs as a plain function.
 */
const imports = (found) => ({ types: t }) => {
  const add = (s) => { if (!found.includes(s)) found.push(s) }
  return {
    visitor: {
      Program: {
        exit(path) {
          for (const node of path.node.body) {
            if (node.type === 'ImportDeclaration' && node.importKind !== 'type' && node.importKind !== 'typeof') add(node.source.value)
            else if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source && node.exportKind !== 'type') add(node.source.value)
          }
        },
      },
      CallExpression(path) {
        if (path.node.callee.type !== 'Import') return
        const arg = path.node.arguments[0]
        if (t.isStringLiteral(arg)) add(arg.value)
        else if (t.isTemplateLiteral(arg) && !arg.expressions.length) add(arg.quasis[0].value.cooked)
        path.node.callee = t.identifier('__liveImport')
      },
      ImportExpression(path) {
        const arg = path.node.source
        if (t.isStringLiteral(arg)) add(arg.value)
        path.replaceWith(t.callExpression(t.identifier('__liveImport'), [arg]))
      },
      AwaitExpression(path) {
        if (!path.getFunctionParent()) throw refuse(path, 'Top-level await is not supported in a live example: the module runs as a plain function. Move it into a function (an EFFECT, a resource, an async helper)')
      },
      ForOfStatement(path) {
        if (path.node.await && !path.getFunctionParent()) throw refuse(path, 'Top-level for await is not supported in a live example: move it into an async function')
      },
      MetaProperty(path) {
        if (path.node.meta.name === 'import' && path.node.property.name === 'meta') throw refuse(path, 'import.meta is not available in a live example (the code is not loaded as a module file)')
      },
    },
  }
}

/**
 * JSX spread children (`<div>{...slots.header}</div>`): transform-react-jsx refuses them, while
 * Sygnal's own pipeline (oxc / esbuild, automatic runtime) compiles them to a spread in the
 * children array (`jsxs('div', { children: [...slots.header] })`). The classic equivalent is a
 * spread argument, `__h('div', null, ...slots.header)`, which esbuild's classic mode emits too:
 * the spread child becomes a marker call `__liveSpread(x)`, and the marker argument of the
 * generated `__h(...)` call becomes `...x`.
 */
const spreadChildren = ({ types: t }) => {
  const isMarker = (a) => t.isCallExpression(a) && t.isIdentifier(a.callee, { name: SPREAD })
  return {
    visitor: {
      JSXSpreadChild(path) {
        path.replaceWith(t.jsxExpressionContainer(t.callExpression(t.identifier(SPREAD), [path.node.expression])))
      },
      CallExpression(path) {
        if (isMarker(path.node) || !path.node.arguments.some(isMarker)) return
        path.node.arguments = path.node.arguments.map((a) => (isMarker(a) ? t.spreadElement(a.arguments[0]) : a))
      },
    },
  }
}

/**
 * @param {string} source
 * @param {CompileOptions} options
 * @returns {Compiled}
 */
export function compile(source, { lang, filename, component, sourceMaps = false }) {
  const requires = []
  const ts = lang === 'ts' || lang === 'tsx' || lang === 'typescript'
  const result = Babel.transform(source, {
    filename,
    sourceType: 'module',
    babelrc: false,
    configFile: false,
    presets: ts ? [['typescript', { isTSX: true, allExtensions: true }]] : [],
    plugins: [
      pickComponent(component),
      imports(requires),
      spreadChildren,
      ['transform-react-jsx', { runtime: 'classic', pragma: '__h', pragmaFrag: '__Fragment' }],
      ['transform-modules-commonjs', { strictMode: true }],
    ],
    sourceMaps: sourceMaps ? 'inline' : false,
  })
  return { code: result.code || '', requires }
}

export { isRelative, fileKey, resolveLiveFile } from './paths.mjs'
