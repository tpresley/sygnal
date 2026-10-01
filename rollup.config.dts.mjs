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

  function emitAll(ctx) {
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
    const { diagnostics } = program.emit(undefined, (_fileName, text, _bom, _onError, sourceFiles) => {
      if (sourceFiles && sourceFiles.length === 1) {
        map.set(path.resolve(sourceFiles[0].fileName), text);
      }
    }, undefined, true);
    // Declaration-emit diagnostics (e.g. TS4xxx / TS9xxx) do not stop the
    // build, but must not be silent.
    for (const d of diagnostics) {
      const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
      let where = '';
      if (d.file && d.start !== undefined) {
        const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
        where = `${path.relative(process.cwd(), d.file.fileName)}:${line + 1}:${character + 1} `;
      }
      ctx.warn(`declaration emit: ${where}TS${d.code}: ${message}`);
    }
    return map;
  }

  return {
    name: 'ts-declarations-for-ts-sources',
    // Reset per build so watch mode re-emits from current sources.
    buildStart() {
      declarations = null;
    },
    load(id) {
      if (!/\.ts$/.test(id) || /\.d\.ts$/.test(id)) return null;
      if (!declarations) declarations = emitAll(this);
      const text = declarations.get(path.resolve(id));
      if (text === undefined) {
        this.error(
          `No emitted declarations for ${path.relative(process.cwd(), id)}: the file is not part of ` +
          `the tsconfig.json program (check "include"/"exclude"). Refusing to treat its raw source as a declaration file.`
        );
      }
      return text;
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
