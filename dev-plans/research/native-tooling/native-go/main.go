// sygnal-native (Go): the prototype's four rules (../lite/facts-estree.mjs, mirrored function by
// function) on esbuild's parser, as one native binary. See ../README.md "Native prototype".
//
//	sygnal-native [-j N] [-time] <dir>
//
// Prints the normalized finding lines of ../lite/common.mjs (`CODE file:line:column`, sorted,
// columns in UTF-16 units like Babel's). Files are parsed and their facts extracted on N
// goroutines (default: all CPUs); -j 1 is the single-threaded comparison with the JS checker.
//
// The esbuild packages are internal/ to esbuild's module, so build.sh copies them into this
// module (MIT, github.com/evanw/esbuild); they are not committed.
package main

import (
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"sygnalnative/internal/config"
	"sygnalnative/internal/helpers"
	"sygnalnative/internal/js_ast"
	"sygnalnative/internal/js_parser"
	"sygnalnative/internal/logger"
)

// ---------------------------------------------------------------------------
// Files (common.mjs listSources)

var srcExt = regexp.MustCompile(`\.(jsx|tsx|js|ts|mjs|mts|cjs|cts)$`)
var testFile = regexp.MustCompile(`\.(test|spec)\.`)
var ignored = map[string]bool{"node_modules": true, "dist": true, "build": true, "coverage": true, ".git": true, ".astro": true, ".vite": true, ".next": true, ".svelte-kit": true, ".turbo": true, "out": true}

func listSources(dir string) []string {
	var out []string
	filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if p != dir && ignored[d.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		n := d.Name()
		if srcExt.MatchString(n) && !testFile.MatchString(n) && !strings.HasSuffix(n, ".d.ts") {
			out = append(out, p)
		}
		return nil
	})
	sort.Strings(out)
	return out
}

// ---------------------------------------------------------------------------
// Parsing

func parse(path, text string) (js_ast.AST, bool) {
	var opts config.Options
	opts.JSX.Parse = true
	opts.JSX.Preserve = true // keep EJSXElement (no lowering to createElement calls)
	ext := filepath.Ext(path)
	if strings.Contains(ext, "ts") {
		opts.TS.Parse = true
		opts.TS.Config.VerbatimModuleSyntax = config.True // keep unused value imports (SYG302)
		opts.JSX.Parse = ext == ".tsx"
	}
	log := logger.NewDeferLog(logger.DeferLogNoVerboseOrDebug, nil)
	src := logger.Source{Index: 0, KeyPath: logger.Path{Text: path}, Contents: text}
	return js_parser.Parse(log, src, js_parser.OptionsFromConfig(&opts))
}

// ---------------------------------------------------------------------------
// Helpers (facts-estree.mjs: keyName, strValue, isFn)

type file struct {
	path string
	text string
	ast  js_ast.AST
}

func (f *file) sym(r js_ast.Expr) (string, bool) {
	switch e := r.Data.(type) {
	case *js_ast.EIdentifier:
		return f.ast.Symbols[e.Ref.InnerIndex].OriginalName, true
	case *js_ast.EImportIdentifier:
		return f.ast.Symbols[e.Ref.InnerIndex].OriginalName, true
	}
	return "", false
}

func strValue(e js_ast.Expr) (string, bool) {
	switch v := e.Data.(type) {
	case *js_ast.EString:
		return helpers.UTF16ToString(v.Value), true
	case *js_ast.EJSXText: // a JSX attribute string: Raw keeps its quotes (entities left as written)
		if len(v.Raw) >= 2 {
			return v.Raw[1 : len(v.Raw)-1], true
		}
	case *js_ast.ETemplate:
		if v.TagOrNil.Data == nil && len(v.Parts) == 0 {
			return helpers.UTF16ToString(v.HeadCooked), true
		}
	}
	return "", false
}

func keyName(p js_ast.Property) (string, bool) {
	if s, ok := p.Key.Data.(*js_ast.EString); ok {
		return helpers.UTF16ToString(s.Value), true
	}
	return "", false
}

func isFn(e js_ast.Expr) bool {
	switch e.Data.(type) {
	case *js_ast.EArrow, *js_ast.EFunction:
		return true
	}
	return false
}

func fnBody(e js_ast.Expr) []js_ast.Stmt {
	switch f := e.Data.(type) {
	case *js_ast.EArrow:
		return f.Body.Block.Stmts
	case *js_ast.EFunction:
		return f.Fn.Body.Block.Stmts
	}
	return nil
}

// ---------------------------------------------------------------------------
// Walker: every expression (pre-order, children after the parent) and every binding pattern

type walker struct {
	expr    func(js_ast.Expr) bool // false: skip the children
	binding func(js_ast.Binding)
}

func (w *walker) stmts(list []js_ast.Stmt) {
	for _, s := range list {
		w.stmt(s)
	}
}

func (w *walker) fn(f *js_ast.Fn) {
	for _, a := range f.Args {
		w.bind(a.Binding)
		w.e(a.DefaultOrNil)
	}
	w.stmts(f.Body.Block.Stmts)
}

func (w *walker) class(c *js_ast.Class) {
	w.e(c.ExtendsOrNil)
	for _, p := range c.Properties {
		w.prop(p)
		if p.ClassStaticBlock != nil {
			w.stmts(p.ClassStaticBlock.Block.Stmts)
		}
	}
}

func (w *walker) prop(p js_ast.Property) {
	w.e(p.Key)
	w.e(p.ValueOrNil)
	w.e(p.InitializerOrNil)
}

func (w *walker) bind(b js_ast.Binding) {
	if b.Data == nil {
		return
	}
	if w.binding != nil {
		w.binding(b)
	}
	switch v := b.Data.(type) {
	case *js_ast.BArray:
		for _, it := range v.Items {
			w.bind(it.Binding)
			w.e(it.DefaultValueOrNil)
		}
	case *js_ast.BObject:
		for _, p := range v.Properties {
			w.e(p.Key)
			w.bind(p.Value)
			w.e(p.DefaultValueOrNil)
		}
	}
}

func (w *walker) stmt(s js_ast.Stmt) {
	switch v := s.Data.(type) {
	case *js_ast.SBlock:
		w.stmts(v.Stmts)
	case *js_ast.SExpr:
		w.e(v.Value)
	case *js_ast.SExportDefault:
		w.stmt(v.Value)
	case *js_ast.SExportEquals:
		w.e(v.Value)
	case *js_ast.SLazyExport:
		w.e(v.Value)
	case *js_ast.SFunction:
		w.fn(&v.Fn)
	case *js_ast.SClass:
		w.class(&v.Class)
	case *js_ast.SLabel:
		w.stmt(v.Stmt)
	case *js_ast.SIf:
		w.e(v.Test)
		w.stmt(v.Yes)
		if v.NoOrNil.Data != nil {
			w.stmt(v.NoOrNil)
		}
	case *js_ast.SFor:
		if v.InitOrNil.Data != nil {
			w.stmt(v.InitOrNil)
		}
		w.e(v.TestOrNil)
		w.e(v.UpdateOrNil)
		w.stmt(v.Body)
	case *js_ast.SForIn:
		w.stmt(v.Init)
		w.e(v.Value)
		w.stmt(v.Body)
	case *js_ast.SForOf:
		w.stmt(v.Init)
		w.e(v.Value)
		w.stmt(v.Body)
	case *js_ast.SDoWhile:
		w.stmt(v.Body)
		w.e(v.Test)
	case *js_ast.SWhile:
		w.e(v.Test)
		w.stmt(v.Body)
	case *js_ast.SWith:
		w.e(v.Value)
		w.stmt(v.Body)
	case *js_ast.STry:
		w.stmts(v.Block.Stmts)
		if v.Catch != nil {
			if v.Catch.BindingOrNil.Data != nil {
				w.bind(v.Catch.BindingOrNil)
			}
			w.stmts(v.Catch.Block.Stmts)
		}
		if v.Finally != nil {
			w.stmts(v.Finally.Block.Stmts)
		}
	case *js_ast.SSwitch:
		w.e(v.Test)
		for _, c := range v.Cases {
			w.e(c.ValueOrNil)
			w.stmts(c.Body)
		}
	case *js_ast.SReturn:
		w.e(v.ValueOrNil)
	case *js_ast.SThrow:
		w.e(v.Value)
	case *js_ast.SLocal:
		for _, d := range v.Decls {
			w.bind(d.Binding)
			w.e(d.ValueOrNil)
		}
	case *js_ast.SNamespace:
		w.stmts(v.Stmts)
	}
}

func (w *walker) e(x js_ast.Expr) {
	if x.Data == nil {
		return
	}
	if !w.expr(x) {
		return
	}
	switch v := x.Data.(type) {
	case *js_ast.EArray:
		for _, it := range v.Items {
			w.e(it)
		}
	case *js_ast.EUnary:
		w.e(v.Value)
	case *js_ast.EBinary:
		w.e(v.Left)
		w.e(v.Right)
	case *js_ast.ENew:
		w.e(v.Target)
		for _, a := range v.Args {
			w.e(a)
		}
	case *js_ast.ECall:
		w.e(v.Target)
		for _, a := range v.Args {
			w.e(a)
		}
	case *js_ast.EDot:
		w.e(v.Target)
	case *js_ast.EIndex:
		w.e(v.Target)
		w.e(v.Index)
	case *js_ast.EArrow:
		for _, a := range v.Args {
			w.bind(a.Binding)
			w.e(a.DefaultOrNil)
		}
		w.stmts(v.Body.Block.Stmts)
	case *js_ast.EFunction:
		w.fn(&v.Fn)
	case *js_ast.EClass:
		w.class(&v.Class)
	case *js_ast.EJSXElement:
		w.e(v.TagOrNil)
		for _, p := range v.Properties {
			w.prop(p)
		}
		for _, c := range v.NullableChildren {
			w.e(c)
		}
	case *js_ast.EObject:
		for _, p := range v.Properties {
			w.prop(p)
		}
	case *js_ast.ESpread:
		w.e(v.Value)
	case *js_ast.ETemplate:
		w.e(v.TagOrNil)
		for _, p := range v.Parts {
			w.e(p.Value)
		}
	case *js_ast.EInlinedEnum:
		w.e(v.Value)
	case *js_ast.EAnnotation:
		w.e(v.Value)
	case *js_ast.EAwait:
		w.e(v.Value)
	case *js_ast.EYield:
		w.e(v.ValueOrNil)
	case *js_ast.EIf:
		w.e(v.Test)
		w.e(v.Yes)
		w.e(v.No)
	case *js_ast.EImportCall:
		w.e(v.Expr)
		w.e(v.OptionsOrNil)
	}
}

// ---------------------------------------------------------------------------
// Facts (facts-estree.mjs fileFacts)

type key struct {
	name string
	loc  int32
}

type selector struct {
	kind, name string
	loc        int32
}

type view struct {
	classes, ids map[string]bool
	dynamic      bool
}

type component struct {
	name                 string
	intentKeys           []key // nil: unknown
	intentKnown          bool
	modelKeys            []key
	modelKnown, hasModel bool
	uses                 bool
	selectors            []selector
	view                 *view
}

type event struct {
	typ string
	loc int32
}

type facts struct {
	f                                *file
	components                       []component
	selected, emitted                []event
	dynamicSelected, dynamicEmitted  int
	xstreamDefault                   []int32
}

var simpleSel = regexp.MustCompile(`^([.#])([A-Za-z_][\w-]*)$`)

func returnedObject(fn js_ast.Expr) *js_ast.EObject {
	body := fnBody(fn)
	for i := len(body) - 1; i >= 0; i-- {
		if r, ok := body[i].Data.(*js_ast.SReturn); ok {
			o, _ := r.ValueOrNil.Data.(*js_ast.EObject)
			return o
		}
	}
	return nil
}

func objectKeys(o *js_ast.EObject, expand bool) ([]key, bool) {
	keys := []key{}
	for _, p := range o.Properties {
		if p.Kind == js_ast.PropertySpread {
			return nil, false
		}
		k, ok := keyName(p)
		if !ok {
			return nil, false
		}
		if expand {
			k = strings.TrimSpace(strings.SplitN(k, "|", 2)[0])
		}
		keys = append(keys, key{k, p.Key.Loc.Start})
	}
	return keys, true
}

func (f *file) viewOf(fn js_ast.Expr) *view {
	v := &view{classes: map[string]bool{}, ids: map[string]bool{}}
	w := &walker{expr: func(x js_ast.Expr) bool {
		el, ok := x.Data.(*js_ast.EJSXElement)
		if !ok {
			return true
		}
		for _, p := range el.Properties {
			if p.Kind == js_ast.PropertySpread {
				continue
			}
			name, ok := keyName(p)
			if !ok || (name != "className" && name != "class" && name != "id") {
				continue
			}
			s, ok := strValue(p.ValueOrNil)
			if !ok {
				v.dynamic = true
				continue
			}
			if name == "id" {
				v.ids[strings.TrimSpace(s)] = true
			} else {
				for _, t := range strings.Fields(s) {
					v.classes[t] = true
				}
			}
		}
		return true
	}}
	w.stmts(fnBody(fn))
	return v
}

var sygnalModule = regexp.MustCompile(`^sygnal(/|$)`)

func fileFacts(f *file) *facts {
	out := &facts{f: f}
	fns := map[string]js_ast.Expr{}
	type st struct{ intent, model, uses js_ast.Expr }
	statics := map[string]*st{}
	var order []string
	emitRefs := map[uint32]bool{} // symbols of emit/event imported from sygnal
	var top []js_ast.Stmt
	for _, part := range f.ast.Parts {
		top = append(top, part.Stmts...)
	}
	for _, s := range top {
		if d, ok := s.Data.(*js_ast.SExportDefault); ok {
			s = d.Value
		}
		switch v := s.Data.(type) {
		case *js_ast.SImport:
			src := f.ast.ImportRecords[v.ImportRecordIndex].Path.Text
			if src == "xstream" && v.DefaultName != nil {
				out.xstreamDefault = append(out.xstreamDefault, s.Loc.Start)
			}
			if sygnalModule.MatchString(src) && v.Items != nil {
				for _, it := range *v.Items {
					if it.Alias == "emit" || it.Alias == "event" {
						emitRefs[it.Name.Ref.InnerIndex] = true
					}
				}
			}
		case *js_ast.SFunction:
			if v.Fn.Name != nil {
				fns[f.ast.Symbols[v.Fn.Name.Ref.InnerIndex].OriginalName] = js_ast.Expr{Data: &js_ast.EFunction{Fn: v.Fn}}
			}
		case *js_ast.SLocal:
			for _, d := range v.Decls {
				if b, ok := d.Binding.Data.(*js_ast.BIdentifier); ok && isFn(d.ValueOrNil) {
					fns[f.ast.Symbols[b.Ref.InnerIndex].OriginalName] = d.ValueOrNil
				}
			}
		case *js_ast.SExpr:
			a, ok := v.Value.Data.(*js_ast.EBinary)
			if !ok || a.Op != js_ast.BinOpAssign {
				continue
			}
			dot, ok := a.Left.Data.(*js_ast.EDot)
			if !ok {
				continue
			}
			obj, ok := dot.Target.Data.(*js_ast.EIdentifier)
			if !ok || (dot.Name != "intent" && dot.Name != "model" && dot.Name != "uses") {
				continue
			}
			name := f.ast.Symbols[obj.Ref.InnerIndex].OriginalName
			if statics[name] == nil {
				statics[name] = &st{}
				order = append(order, name)
			}
			switch dot.Name {
			case "intent":
				statics[name].intent = a.Right
			case "model":
				statics[name].model = a.Right
			case "uses":
				statics[name].uses = a.Right
			}
		}
	}

	// EVENTS aliases ({ EVENTS: ev } anywhere), then selects and emits
	aliases := map[string]bool{"EVENTS": true}
	w := &walker{expr: func(js_ast.Expr) bool { return true }, binding: func(b js_ast.Binding) {
		o, ok := b.Data.(*js_ast.BObject)
		if !ok {
			return
		}
		for _, p := range o.Properties {
			if p.IsSpread || p.IsComputed {
				continue
			}
			if k, ok := p.Key.Data.(*js_ast.EString); ok && helpers.UTF16ToString(k.Value) == "EVENTS" {
				if id, ok := p.Value.Data.(*js_ast.BIdentifier); ok {
					aliases[f.ast.Symbols[id.Ref.InnerIndex].OriginalName] = true
				}
			}
		}
	}}
	w.stmts(top)
	w = &walker{expr: func(x js_ast.Expr) bool {
		call, ok := x.Data.(*js_ast.ECall)
		if !ok {
			return true
		}
		switch c := call.Target.Data.(type) {
		case *js_ast.EDot:
			if c.Name != "select" {
				return true
			}
			isEvents := false
			if n, ok := f.sym(c.Target); ok && aliases[n] {
				isEvents = true
			} else if d, ok := c.Target.Data.(*js_ast.EDot); ok && d.Name == "EVENTS" {
				isEvents = true
			}
			if isEvents && len(call.Args) > 0 {
				if t, ok := strValue(call.Args[0]); ok {
					out.selected = append(out.selected, event{t, call.Args[0].Loc.Start})
				} else {
					out.dynamicSelected++
				}
			}
		case *js_ast.EImportIdentifier:
			if emitRefs[c.Ref.InnerIndex] {
				if len(call.Args) > 0 {
					if t, ok := strValue(call.Args[0]); ok {
						out.emitted = append(out.emitted, event{t, call.Args[0].Loc.Start})
						return true
					}
				}
				out.dynamicEmitted++
			}
		}
		return true
	}}
	w.stmts(top)

	for _, name := range order {
		s := statics[name]
		c := component{name: name, hasModel: s.model.Data != nil, uses: s.uses.Data != nil}
		if isFn(s.intent) {
			if o := returnedObject(s.intent); o != nil {
				c.intentKeys, c.intentKnown = objectKeys(o, false)
			}
			iw := &walker{expr: func(x js_ast.Expr) bool {
				call, ok := x.Data.(*js_ast.ECall)
				if !ok || len(call.Args) == 0 {
					return true
				}
				dot, ok := call.Target.Data.(*js_ast.EDot)
				if !ok {
					return true
				}
				if n, ok := f.sym(dot.Target); ok && n == "DOM" {
					if sv, ok := strValue(call.Args[0]); ok {
						if m := simpleSel.FindStringSubmatch(strings.TrimSpace(sv)); m != nil {
							kind := "class"
							if m[1] == "#" {
								kind = "id"
							}
							c.selectors = append(c.selectors, selector{kind, m[2], call.Args[0].Loc.Start})
						}
					}
				}
				return true
			}}
			iw.stmts(fnBody(s.intent))
		}
		if o, ok := s.model.Data.(*js_ast.EObject); ok {
			c.modelKeys, c.modelKnown = objectKeys(o, true)
		}
		if fn, ok := fns[name]; ok {
			c.view = f.viewOf(fn)
		}
		out.components = append(out.components, c)
	}
	return out
}

// ---------------------------------------------------------------------------
// Rules (facts-estree.mjs rules) and output

type finding struct {
	code string
	f    *file
	loc  int32
}

func rules(all []*facts) []finding {
	var out []finding
	emitted, selected := map[string]bool{}, map[string]bool{}
	for _, f := range all {
		for _, e := range f.emitted {
			emitted[e.typ] = true
		}
		for _, s := range f.selected {
			selected[s.typ] = true
		}
	}
	for _, f := range all {
		for _, l := range f.xstreamDefault {
			out = append(out, finding{"SYG302", f.f, l})
		}
		for _, c := range f.components {
			if c.intentKnown && !c.uses && (c.modelKnown || !c.hasModel) {
				model := map[string]bool{}
				for _, k := range c.modelKeys {
					model[k.name] = true
				}
				for _, k := range c.intentKeys {
					if !model[k.name] {
						out = append(out, finding{"SYG101", f.f, k.loc})
					}
				}
			}
			if c.view != nil && !c.view.dynamic {
				for _, s := range c.selectors {
					set := c.view.classes
					if s.kind == "id" {
						set = c.view.ids
					}
					if !set[s.name] {
						out = append(out, finding{"SYG110", f.f, s.loc})
					}
				}
			}
		}
		for _, s := range f.selected {
			if !emitted[s.typ] {
				out = append(out, finding{"SYG105", f.f, s.loc})
			}
		}
		for _, e := range f.emitted {
			if !selected[e.typ] {
				out = append(out, finding{"SYG105", f.f, e.loc})
			}
		}
	}
	return out
}

// 1-based line, and column in UTF-16 units (Babel's) from a byte offset
func lineCol(text string, off int32) (int, int) {
	line, start := 1, 0
	for i := 0; i < int(off) && i < len(text); i++ {
		if text[i] == '\n' {
			line++
			start = i + 1
		}
	}
	col := 0
	for _, r := range text[start:min(int(off), len(text))] {
		if r >= 0x10000 {
			col += 2
		} else {
			col++
		}
	}
	return line, col + 1
}

func main() {
	jobs := flag.Int("j", runtime.NumCPU(), "parallel parse/facts workers")
	timing := flag.Bool("time", false, "print phase times to stderr")
	repeat := flag.Int("repeat", 1, "run the whole check N times in-process (median printed with -time)")
	flag.Parse()
	dir, _ := filepath.Abs(flag.Arg(0))
	t0 := time.Now()
	paths := listSources(dir)
	var lines []string
	var walls []time.Duration
	for r := 0; r < *repeat; r++ {
		tr := time.Now()
		all := make([]*facts, len(paths))
		next := make(chan int)
		var wg sync.WaitGroup
		for j := 0; j < *jobs; j++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for i := range next {
					b, err := os.ReadFile(paths[i])
					if err != nil {
						continue
					}
					f := &file{path: paths[i], text: string(b)}
					ast, ok := parse(f.path, f.text)
					if !ok {
						continue
					}
					f.ast = ast
					all[i] = fileFacts(f)
				}
			}()
		}
		for i := range paths {
			next <- i
		}
		close(next)
		wg.Wait()
		parsed := all[:0]
		for _, f := range all {
			if f != nil {
				parsed = append(parsed, f)
			}
		}
		found := rules(parsed)
		seen := map[string]bool{}
		lines = lines[:0]
		for _, d := range found {
			rel, _ := filepath.Rel(dir, d.f.path)
			l, c := lineCol(d.f.text, d.loc)
			s := fmt.Sprintf("%s %s:%d:%d", d.code, rel, l, c)
			if !seen[s] {
				seen[s] = true
				lines = append(lines, s)
			}
		}
		sort.Strings(lines)
		walls = append(walls, time.Since(tr))
	}
	if *timing {
		sort.Slice(walls, func(a, b int) bool { return walls[a] < walls[b] })
		fmt.Fprintf(os.Stderr, "{\"files\":%d,\"jobs\":%d,\"checkMs\":%.1f,\"totalMs\":%.1f}\n", len(paths), *jobs, float64(walls[len(walls)/2].Microseconds())/1000, float64(time.Since(t0).Microseconds())/1000)
	}
	fmt.Println(strings.Join(lines, "\n"))
}
