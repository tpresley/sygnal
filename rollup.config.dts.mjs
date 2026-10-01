import path from 'node:path';
import ts from 'typescript';
import dts from 'rollup-plugin-dts';

/**
 * Feed rollup-plugin-dts generated declarations for `.ts` sources (B-001).
 *
 * The entry point is a hand-written `.d.ts` (src/index.d.ts) that re-exports
 * from `.ts` implementation modules (e.g. `./cycle/dom/index`). With a `.d.ts`
 * entry, rollup-plugin-dts creates no TypeScript program and therefore treats
 * each reached `.ts` file's raw source *as if it were a declaration file*. Any
 * runtime statement in those modules (e.g. `(isolate as any).reset = ...`)
 * then fails with "Syntax not yet supported".
 *
 * This plugin runs before dts() and, for `.ts` (non-`.d.ts`) modules, returns
 * the declaration text emitted by the TypeScript compiler instead of the raw
 * source. Build-time only: no effect on the runtime bundles.
 */
function tsDeclarationsForTsSources() {
  let declarations = null;

  function emitAll() {
    const configPath = path.resolve('tsconfig.json');
    const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, path.dirname(configPath));
    const options = {
      ...parsed.options,
      declaration: true,
      emitDeclarationOnly: true,
      noEmit: false,
      noEmitOnError: false,
      allowJs: false,
    };
    const rootNames = parsed.fileNames.filter((f) => /\.ts$/.test(f));
    const program = ts.createProgram(rootNames, options);
    const map = new Map();
    program.emit(undefined, (_fileName, text, _bom, _onError, sourceFiles) => {
      if (sourceFiles && sourceFiles.length === 1) {
        map.set(path.resolve(sourceFiles[0].fileName), text);
      }
    }, undefined, true);
    return map;
  }

  return {
    name: 'ts-declarations-for-ts-sources',
    load(id) {
      if (!/\.ts$/.test(id) || /\.d\.ts$/.test(id)) return null;
      if (!declarations) declarations = emitAll();
      return declarations.get(path.resolve(id)) ?? null;
    },
  };
}

export default {
  input: 'src/index.d.ts',  // Your type definitions entry point
  output: {
    file: 'dist/index.d.ts',
    format: 'es'
  },
  plugins: [tsDeclarationsForTsSources(), dts()]
};
