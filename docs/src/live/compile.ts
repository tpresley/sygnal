// Compiles a live example with @babel/standalone (this module is its own lazy chunk): JSX with
// the classic runtime (Sygnal's createElement and Fragment, as on the Try It page), TypeScript
// for ts/tsx, ES modules to a CommonJS-style body the runtime evaluates with its own `require`.
import * as Babel from '@babel/standalone'

export interface Compiled {
  /** the function body: (require, module, exports, __h, __Fragment, __liveSet) */
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

export function compile(source: string, { lang, filename, component }: CompileOptions): Compiled {
  const ts = lang === 'ts' || lang === 'tsx' || lang === 'typescript'
  const result = Babel.transform(source, {
    filename,
    sourceType: 'module',
    babelrc: false,
    configFile: false,
    presets: ts ? [['typescript', { isTSX: true, allExtensions: true }]] : [],
    plugins: [
      pickComponent(component),
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
  return { code, requires }
}
