// Compiles a live example with @babel/standalone (this module is its own lazy chunk): JSX with
// the classic runtime (Sygnal's createElement and Fragment, as on the Try It page), TypeScript
// for ts/tsx, ES modules to a CommonJS-style body the runtime evaluates with its own `require`.
import * as Babel from '@babel/standalone'

export interface Compiled {
  /** the function body: (require, module, exports, __h, __Fragment, __liveSet, __liveImport) */
  code: string
  /** the specifiers it requires, in order */
  requires: string[]
}

export interface CompileOptions {
  lang: string
  filename: string
  /**
   * The component to report through __liveSet: a name (live=Name), 'auto' (the last top-level
   * capitalized function declaration, when there is no default export) or false (a live-file)
   */
  component: string | 'auto' | false
}

const isCap = (name?: string | null) => !!name && /^[A-Z]/.test(name)

/** a plugin that appends `__liveSet(() => Name)` for the component to mount */
const pickComponent = (component: CompileOptions['component']) => ({ types: t }: any) => ({
  visitor: {
    Program: {
      enter(path: any) {
        if (component === false) return
        let name: string | undefined
        if (component !== 'auto') name = component
        else {
          let hasDefault = false
          for (const node of path.node.body) {
            if (node.type === 'ExportDefaultDeclaration') hasDefault = true
            if (node.type === 'ExportNamedDeclaration' && node.specifiers?.some((s: any) => (s.exported?.name ?? s.exported?.value) === 'default')) hasDefault = true
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

const SPREAD = '__liveSpread'

/**
 * JSX spread children (`<div>{...slots.header}</div>`): transform-react-jsx refuses them, while
 * Sygnal's own pipeline (oxc / esbuild, automatic runtime) compiles them to a spread in the
 * children array (`jsxs('div', { children: [...slots.header] })`). The classic equivalent is a
 * spread argument, `__h('div', null, ...slots.header)`, which esbuild's classic mode emits too:
 * the spread child becomes a marker call `__liveSpread(x)`, and the marker argument of the
 * generated `__h(...)` call becomes `...x`.
 */
const spreadChildren = ({ types: t }: any) => ({
  visitor: {
    JSXSpreadChild(path: any) {
      path.replaceWith(t.jsxExpressionContainer(t.callExpression(t.identifier(SPREAD), [path.node.expression])))
    },
    CallExpression(path: any) {
      const args = path.node.arguments
      if (!args.some((a: any) => t.isCallExpression(a) && t.isIdentifier(a.callee, { name: SPREAD }))) return
      if (t.isIdentifier(path.node.callee, { name: SPREAD })) return
      path.node.arguments = args.map((a: any) =>
        t.isCallExpression(a) && t.isIdentifier(a.callee, { name: SPREAD }) ? t.spreadElement(a.arguments[0]) : a)
    },
  },
})

/**
 * Dynamic `import('spec')`: the runtime's resolver, not the browser's (a live-file or a module
 * of src/live/modules.ts). It becomes `__liveImport('spec')`, a Promise of the namespace; a
 * string-literal specifier is listed in `requires`, so the runtime loads it up front.
 */
const dynamicImports = (found: string[]) => ({ types: t }: any) => ({
  visitor: {
    CallExpression(path: any) {
      if (path.node.callee.type !== 'Import') return
      const arg = path.node.arguments[0]
      if (t.isStringLiteral(arg)) found.push(arg.value)
      else if (t.isTemplateLiteral(arg) && !arg.expressions.length) found.push(arg.quasis[0].value.cooked)
      path.node.callee = t.identifier('__liveImport')
    },
    ImportExpression(path: any) {
      const arg = path.node.source
      if (t.isStringLiteral(arg)) found.push(arg.value)
      path.replaceWith(t.callExpression(t.identifier('__liveImport'), [arg]))
    },
  },
})

export function compile(source: string, { lang, filename, component }: CompileOptions): Compiled {
  const dynamic: string[] = []
  const ts = lang === 'ts' || lang === 'tsx' || lang === 'typescript'
  const result = Babel.transform(source, {
    filename,
    sourceType: 'module',
    babelrc: false,
    configFile: false,
    presets: ts ? [['typescript', { isTSX: true, allExtensions: true }]] : [],
    plugins: [
      pickComponent(component),
      dynamicImports(dynamic),
      spreadChildren,
      ['transform-react-jsx', { runtime: 'classic', pragma: '__h', pragmaFrag: '__Fragment' }],
      ['transform-modules-commonjs', { strictMode: true }],
    ],
    sourceMaps: 'inline',
  } as any)
  const code = result.code || ''
  const requires: string[] = []
  // the requires Babel generated for the imports and re-exports (always a string literal)
  for (const m of code.matchAll(/\brequire\((["'])((?:(?!\1)[^\\]|\\.)+)\1\)/g)) {
    const spec = m[2].replace(/\\(.)/g, '$1')
    if (!requires.includes(spec)) requires.push(spec)
  }
  for (const spec of dynamic) if (!requires.includes(spec)) requires.push(spec)
  return { code, requires }
}
