import compiler from 'typescript'
import typescriptPlugin from '@rollup/plugin-typescript'
import path from 'node:path'

// Keep each build's compiler out of the configuration array's lifetime. In particular,
// TypeScript's watch-program API can schedule an update that runs after program.close(),
// recreating watchers and retaining closed builds. Ordinary builds need no file watchers.
export default function typescript(options = {}) {
  let inner
  let watching = false
  const programs = new Set()
  const ts = options.typescript || compiler
  const release = () => {
    for (const program of programs) program.close()
    inner = undefined
  }
  const create = () => typescriptPlugin({...options, typescript: {
    ...ts,
    createWatchCompilerHost(...args) {
      const host = ts.createWatchCompilerHost(...args)
      if (!watching) host.watchFile = host.watchDirectory = () => ({close() {}})
      return host
    },
    createWatchProgram(host) {
      // TypeScript 5.4's close() does not cancel every scheduled program update.
      // A late update must not recreate watchers after Rollup has closed the build.
      const timers = new Set()
      const set = host.setTimeout || ts.sys.setTimeout
      const clear = host.clearTimeout || ts.sys.clearTimeout
      let closed = false
      host.setTimeout = (callback, delay, ...args) => {
        if (closed) return undefined
        const timer = set(() => {
          timers.delete(timer)
          if (!closed) callback(...args)
        }, delay)
        timers.add(timer)
        return timer
      }
      host.clearTimeout = timer => {
        timers.delete(timer)
        clear(timer)
      }
      const cancel = () => {
        closed = true
        for (const timer of timers) clear(timer)
        timers.clear()
      }
      let program
      try { program = ts.createWatchProgram(host) }
      catch (error) { cancel(); throw error }
      const close = program.close.bind(program)
      program.close = () => {
        if (closed) return
        cancel()
        programs.delete(program)
        close()
      }
      programs.add(program)
      return program
    },
  }})
  const plugin = {
    name: 'typescript',
    closeBundle() {
      // Rollup closes each watch result too; retain its compiler for the next rebuild.
      if (!watching) release()
    },
    closeWatcher() {
      release()
    },
  }
  for (const name of ['buildStart', 'watchChange', 'buildEnd', 'renderStart', 'resolveId', 'load', 'generateBundle']) {
    plugin[name] = function (...args) {
      if (name === 'buildStart') watching = this.meta.watchMode === true
      inner ||= create()
      const hook = inner[name]
      const result = (typeof hook === 'function' ? hook : hook?.handler)?.apply(this, args)
      if (name === 'buildStart' && watching) {
        if (typeof options.tsconfig === 'string') this.addWatchFile(path.resolve(options.tsconfig))
        // Type-only dependencies can change emitted JS (for example a const enum) even
        // though they disappear from Rollup's module graph. Let Rollup rebuild for them.
        for (const program of programs) {
          const p = program.getProgram().getProgram()
          for (const file of p.getSourceFiles()) if (!p.isSourceFileDefaultLibrary(file)) this.addWatchFile(file.fileName)
        }
      }
      return result
    }
  }
  return plugin
}
