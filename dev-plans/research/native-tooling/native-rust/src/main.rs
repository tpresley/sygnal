// sygnal-native (Rust): the prototype's four rules (../lite/facts-estree.mjs, mirrored function by
// function) on the oxc parser, the same parser oxc-parser's npm package wraps. See ../README.md
// "Rust (oxc) vs Go vs JS".
//
//   sygnal-native-rs [-j N] [-time] [-repeat N] <dir>
//
// Prints the normalized finding lines of ../lite/common.mjs (`CODE file:line:column`, sorted,
// columns in UTF-16 units like Babel's). Files are parsed and their facts extracted on N threads
// (default: all CPUs); -j 1 is the single-threaded comparison.
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Instant;

use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType};
use oxc_str::JSStr;

// ---------------------------------------------------------------------------
// Files (common.mjs listSources)

const IGNORED: &[&str] = &["node_modules", "dist", "build", "coverage", ".git", ".astro", ".vite", ".next", ".svelte-kit", ".turbo", "out"];
const EXTS: &[&str] = &[".jsx", ".tsx", ".js", ".ts", ".mjs", ".mts", ".cjs", ".cts"];

fn list_sources(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            if !IGNORED.contains(&name.as_str()) { list_sources(&p, out) }
        } else if EXTS.iter().any(|x| name.ends_with(x)) && !name.contains(".test.") && !name.contains(".spec.") && !name.ends_with(".d.ts") {
            out.push(p)
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers (facts-estree.mjs: unparen, keyName, strValue, isFn)

fn unparen<'a, 'b>(mut e: &'b Expression<'a>) -> &'b Expression<'a> {
    loop {
        e = match e {
            Expression::ParenthesizedExpression(p) => &p.expression,
            Expression::TSAsExpression(p) => &p.expression,
            Expression::TSSatisfiesExpression(p) => &p.expression,
            Expression::TSNonNullExpression(p) => &p.expression,
            _ => return e,
        }
    }
}

/// A JS string's value (a lone surrogate, which &str can't hold, as its display form).
fn js(s: &JSStr) -> String {
    s.as_str().map(str::to_string).unwrap_or_else(|| s.display().to_string())
}

fn key_name(key: &PropertyKey, computed: bool) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(id) if !computed => Some(id.name.to_string()),
        PropertyKey::StringLiteral(s) => Some(js(&s.value)),
        _ => None,
    }
}

fn str_value(e: &Expression) -> Option<String> {
    match unparen(e) {
        Expression::StringLiteral(s) => Some(js(&s.value)),
        Expression::TemplateLiteral(t) if t.expressions.is_empty() => t.quasis.first().and_then(|q| q.value.cooked.as_ref()).map(js),
        _ => None,
    }
}

fn is_fn(e: &Expression) -> bool {
    matches!(e, Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_))
}

/// A function's statements, and for an arrow with an expression body, that expression.
enum Body<'b, 'a> { Stmts(&'b [Statement<'a>]), Expr(&'b Expression<'a>), None }

fn body_of<'b, 'a>(e: &'b Expression<'a>) -> Body<'b, 'a> {
    match e {
        Expression::ArrowFunctionExpression(f) => match &f.body {
            ArrowFunctionBody::FunctionBody(b) => Body::Stmts(&b.statements),
            other => other.as_expression().map(Body::Expr).unwrap_or(Body::None),
        },
        Expression::FunctionExpression(f) => f.body.as_ref().map(|b| Body::Stmts(&b.statements)).unwrap_or(Body::None),
        _ => Body::None,
    }
}

fn visit_body<'a, V: Visit<'a>>(v: &mut V, b: &Body<'_, 'a>) {
    match b {
        Body::Stmts(list) => for s in list.iter() { v.visit_statement(s) },
        Body::Expr(e) => v.visit_expression(e),
        Body::None => {}
    }
}

// ---------------------------------------------------------------------------
// Facts (facts-estree.mjs fileFacts)

struct Key { name: String, loc: u32 }
struct Selector { id: bool, name: String, loc: u32 }
struct View { classes: HashSet<String>, ids: HashSet<String>, dynamic: bool }
struct Component { intent_keys: Option<Vec<Key>>, model_keys: Option<Vec<Key>>, has_model: bool, uses: bool, selectors: Vec<Selector>, view: Option<View> }
#[derive(Default)]
struct Facts { components: Vec<Component>, selected: Vec<(String, u32)>, emitted: Vec<(String, u32)>, dynamic_selected: usize, dynamic_emitted: usize, xstream_default: Vec<u32> }

fn returned_object<'b, 'a>(fun: &'b Expression<'a>) -> Option<&'b ObjectExpression<'a>> {
    match body_of(fun) {
        Body::Expr(e) => if let Expression::ObjectExpression(o) = unparen(e) { Some(o) } else { None },
        Body::Stmts(list) => {
            for s in list.iter().rev() {
                if let Statement::ReturnStatement(r) = s {
                    return match r.argument.as_ref().map(unparen) { Some(Expression::ObjectExpression(o)) => Some(o), _ => None };
                }
            }
            None
        }
        Body::None => None,
    }
}

fn object_keys(o: &ObjectExpression, expand: bool) -> Option<Vec<Key>> {
    let mut keys = vec![];
    for p in o.properties.iter() {
        let ObjectPropertyKind::ObjectProperty(p) = p else { return None };
        let k = key_name(&p.key, p.computed)?;
        let name = if expand { k.split('|').next().unwrap().trim().to_string() } else { k };
        keys.push(Key { name, loc: p.key.span().start });
    }
    Some(keys)
}

/// '.name' or '#name' only (one token, no combinators, pseudo classes or attributes)
fn simple_selector(s: &str) -> Option<(bool, String)> {
    let s = s.trim();
    let (id, rest) = if let Some(r) = s.strip_prefix('.') { (false, r) } else if let Some(r) = s.strip_prefix('#') { (true, r) } else { return None };
    let mut chars = rest.chars();
    let first = chars.next()?;
    if !(first.is_ascii_alphabetic() || first == '_') { return None }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') { return None }
    Some((id, rest.to_string()))
}

struct ViewVisitor { view: View }
impl<'a> Visit<'a> for ViewVisitor {
    fn visit_jsx_attribute(&mut self, a: &JSXAttribute<'a>) {
        if let JSXAttributeName::Identifier(n) = &a.name {
            let name = n.name.as_str();
            if name == "className" || name == "class" || name == "id" {
                let s = match &a.value {
                    Some(JSXAttributeValue::StringLiteral(s)) => Some(js(&s.value)),
                    Some(JSXAttributeValue::ExpressionContainer(c)) => c.expression.as_expression().and_then(str_value),
                    _ => None,
                };
                match s {
                    None => self.view.dynamic = true,
                    Some(s) if name == "id" => { self.view.ids.insert(s.trim().to_string()); }
                    Some(s) => for t in s.split_whitespace() { self.view.classes.insert(t.to_string()); },
                }
            }
        }
        walk::walk_jsx_attribute(self, a);
    }
}

struct AliasVisitor { aliases: HashSet<String> }
impl<'a> Visit<'a> for AliasVisitor {
    fn visit_binding_property(&mut self, p: &BindingProperty<'a>) {
        if key_name(&p.key, p.computed).as_deref() == Some("EVENTS") {
            let id = match &p.value {
                BindingPattern::BindingIdentifier(id) => Some(id.name.to_string()),
                BindingPattern::AssignmentPattern(ap) => if let BindingPattern::BindingIdentifier(id) = &ap.left { Some(id.name.to_string()) } else { None },
                _ => None,
            };
            if let Some(id) = id { self.aliases.insert(id); }
        }
        walk::walk_binding_property(self, p);
    }
}

struct EventsVisitor<'f> { aliases: &'f HashSet<String>, emit_helpers: &'f HashSet<String>, facts: &'f mut Facts }
impl<'a, 'f> Visit<'a> for EventsVisitor<'f> {
    fn visit_import_declaration(&mut self, _: &ImportDeclaration<'a>) {}
    fn visit_call_expression(&mut self, n: &CallExpression<'a>) {
        let arg0 = n.arguments.first().and_then(|a| a.as_expression());
        match unparen(&n.callee) {
            Expression::StaticMemberExpression(c) if c.property.name == "select" => {
                let is_events = match unparen(&c.object) {
                    Expression::Identifier(o) => self.aliases.contains(o.name.as_str()),
                    Expression::StaticMemberExpression(o) => o.property.name == "EVENTS",
                    _ => false,
                };
                if is_events && !n.arguments.is_empty() {
                    match arg0.and_then(str_value) {
                        Some(t) => self.facts.selected.push((t, n.arguments[0].span().start)),
                        None => self.facts.dynamic_selected += 1,
                    }
                }
            }
            Expression::Identifier(c) if self.emit_helpers.contains(c.name.as_str()) => {
                match arg0.and_then(str_value) {
                    Some(t) => self.facts.emitted.push((t, n.arguments[0].span().start)),
                    None => self.facts.dynamic_emitted += 1,
                }
            }
            _ => {}
        }
        walk::walk_call_expression(self, n);
    }
}

struct SelectorVisitor { selectors: Vec<Selector> }
impl<'a> Visit<'a> for SelectorVisitor {
    fn visit_call_expression(&mut self, n: &CallExpression<'a>) {
        if let Some(arg) = n.arguments.first() {
            let obj = match unparen(&n.callee) {
                Expression::StaticMemberExpression(m) => Some(&m.object),
                Expression::ComputedMemberExpression(m) => Some(&m.object),
                _ => None,
            };
            if let Some(Expression::Identifier(o)) = obj.map(unparen) {
                if o.name == "DOM" {
                    if let Some((id, name)) = arg.as_expression().and_then(str_value).as_deref().and_then(simple_selector) {
                        self.selectors.push(Selector { id, name, loc: arg.span().start });
                    }
                }
            }
        }
        walk::walk_call_expression(self, n);
    }
}

fn file_facts(program: &Program) -> Facts {
    let mut facts = Facts::default();
    let mut fns: HashMap<String, Body> = HashMap::new();
    let mut statics: Vec<(String, [Option<&Expression>; 3])> = vec![]; // intent, model, uses
    let mut emit_helpers = HashSet::new();
    for s in program.body.iter() {
        match s {
            Statement::ImportDeclaration(d) if !d.import_kind.is_type() => {
                let src = d.source.value.as_str().unwrap_or("");
                let specs: Vec<&ImportDeclarationSpecifier> = d.specifiers.iter().flatten().collect();
                if src == "xstream" && specs.iter().any(|sp| matches!(sp, ImportDeclarationSpecifier::ImportDefaultSpecifier(_))) {
                    facts.xstream_default.push(d.span.start);
                }
                if src == "sygnal" || src.starts_with("sygnal/") {
                    for sp in specs {
                        if let ImportDeclarationSpecifier::ImportSpecifier(sp) = sp {
                            if sp.import_kind.is_type() { continue }
                            let imported = sp.imported.name();
                            if imported.as_str() == "emit" || imported.as_str() == "event" { emit_helpers.insert(sp.local.name.to_string()); }
                        }
                    }
                }
            }
            _ => {}
        }
        // (an export's declaration counts as the statement itself)
        let decl_fn = |f: &Function| f.id.as_ref().map(|id| id.name.to_string());
        match s {
            Statement::FunctionDeclaration(f) => if let (Some(n), Some(b)) = (decl_fn(f), f.body.as_ref()) { fns.insert(n, Body::Stmts(&b.statements)); },
            Statement::ExportDeclaration(e) => match &e.declaration {
                Declaration::FunctionDeclaration(f) => if let (Some(n), Some(b)) = (decl_fn(f), f.body.as_ref()) { fns.insert(n, Body::Stmts(&b.statements)); },
                Declaration::VariableDeclaration(v) => add_var_fns(v, &mut fns),
                _ => {}
            },
            Statement::ExportDefaultDeclaration(e) => if let ExportDefaultDeclarationKind::FunctionDeclaration(f) = &e.declaration {
                if let (Some(n), Some(b)) = (decl_fn(f), f.body.as_ref()) { fns.insert(n, Body::Stmts(&b.statements)); }
            },
            Statement::VariableDeclaration(v) => add_var_fns(v, &mut fns),
            Statement::ExpressionStatement(es) => {
                if let Expression::AssignmentExpression(a) = &es.expression {
                    if a.operator != AssignmentOperator::Assign { continue }
                    if let AssignmentTarget::StaticMemberExpression(m) = &a.left {
                        if let Expression::Identifier(obj) = &m.object {
                            let k = match m.property.name.as_str() { "intent" => 0, "model" => 1, "uses" => 2, _ => continue };
                            let name = obj.name.to_string();
                            let i = match statics.iter().position(|(n, _)| *n == name) { Some(i) => i, None => { statics.push((name, [None, None, None])); statics.len() - 1 } };
                            statics[i].1[k] = Some(unparen(&a.right));
                        }
                    }
                }
            }
            _ => {}
        }
    }

    let mut av = AliasVisitor { aliases: ["EVENTS".to_string()].into_iter().collect() };
    av.visit_program(program);
    let aliases = av.aliases;
    {
        let mut ev = EventsVisitor { aliases: &aliases, emit_helpers: &emit_helpers, facts: &mut facts };
        ev.visit_program(program);
    }

    for (name, [intent, model, uses]) in statics.iter() {
        let mut c = Component { intent_keys: None, model_keys: None, has_model: model.is_some(), uses: uses.is_some(), selectors: vec![], view: None };
        if let Some(i) = intent.filter(|e| is_fn(e)) {
            if let Some(o) = returned_object(i) { c.intent_keys = object_keys(o, false) }
            let mut sv = SelectorVisitor { selectors: vec![] };
            visit_body(&mut sv, &body_of(i));
            c.selectors = sv.selectors;
        }
        if let Some(Expression::ObjectExpression(o)) = model { c.model_keys = object_keys(o, true) }
        if let Some(b) = fns.get(name) {
            let mut vv = ViewVisitor { view: View { classes: HashSet::new(), ids: HashSet::new(), dynamic: false } };
            visit_body(&mut vv, b);
            c.view = Some(vv.view);
        }
        facts.components.push(c);
    }
    facts
}

fn add_var_fns<'b, 'a>(v: &'b VariableDeclaration<'a>, fns: &mut HashMap<String, Body<'b, 'a>>) {
    for d in v.declarations.iter() {
        if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&d.id, d.init.as_ref()) {
            let init = unparen(init);
            if is_fn(init) { fns.insert(id.name.to_string(), body_of(init)); }
        }
    }
}

// ---------------------------------------------------------------------------
// Rules (facts-estree.mjs rules) and output

fn rules(all: &[(usize, &Facts)], out: &mut Vec<(&'static str, usize, u32)>) {
    let emitted: HashSet<&str> = all.iter().flat_map(|(_, f)| f.emitted.iter().map(|e| e.0.as_str())).collect();
    let selected: HashSet<&str> = all.iter().flat_map(|(_, f)| f.selected.iter().map(|e| e.0.as_str())).collect();
    for (i, f) in all {
        for l in &f.xstream_default { out.push(("SYG302", *i, *l)) }
        for c in &f.components {
            if let Some(ik) = &c.intent_keys {
                if !c.uses && (c.model_keys.is_some() || !c.has_model) {
                    let model: HashSet<&str> = c.model_keys.iter().flatten().map(|k| k.name.as_str()).collect();
                    for k in ik { if !model.contains(k.name.as_str()) { out.push(("SYG101", *i, k.loc)) } }
                }
            }
            if let Some(v) = c.view.as_ref().filter(|v| !v.dynamic) {
                for s in &c.selectors {
                    let set = if s.id { &v.ids } else { &v.classes };
                    if !set.contains(&s.name) { out.push(("SYG110", *i, s.loc)) }
                }
            }
        }
        for (t, l) in &f.selected { if !emitted.contains(t.as_str()) { out.push(("SYG105", *i, *l)) } }
        for (t, l) in &f.emitted { if !selected.contains(t.as_str()) { out.push(("SYG105", *i, *l)) } }
    }
}

/// 1-based line, and column in UTF-16 units (Babel's) from a byte offset
fn line_col(text: &str, off: u32) -> (usize, usize) {
    let off = (off as usize).min(text.len());
    let before = &text[..off];
    let line = before.matches('\n').count() + 1;
    let start = before.rfind('\n').map(|i| i + 1).unwrap_or(0);
    (line, before[start..].encode_utf16().count() + 1)
}

fn check_file(path: &Path) -> Option<(String, Facts)> {
    let text = std::fs::read_to_string(path).ok()?;
    let alloc = Allocator::default();
    let st = SourceType::from_path(path).ok()?;
    let ret = Parser::new(&alloc, &text, st).parse();
    if ret.diagnostics.has_errors() { return None }
    let facts = file_facts(&ret.program);
    Some((text, facts))
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut jobs = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
    let (mut timing, mut repeat, mut dir) = (false, 1usize, None);
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "-j" => jobs = it.next().unwrap().parse().unwrap(),
            "-time" => timing = true,
            "-repeat" => repeat = it.next().unwrap().parse().unwrap(),
            _ => dir = Some(PathBuf::from(a)),
        }
    }
    let dir = std::fs::canonicalize(dir.expect("usage: sygnal-native-rs [-j N] [-time] [-repeat N] <dir>")).unwrap();
    let t0 = Instant::now();
    let mut paths = vec![];
    list_sources(&dir, &mut paths);
    paths.sort();
    let mut walls = vec![];
    let mut lines: Vec<String> = vec![];
    for _ in 0..repeat {
        let tr = Instant::now();
        let next = std::sync::atomic::AtomicUsize::new(0);
        let slots: Vec<std::sync::Mutex<Option<(String, Facts)>>> = (0..paths.len()).map(|_| std::sync::Mutex::new(None)).collect();
        std::thread::scope(|s| {
            for _ in 0..jobs {
                s.spawn(|| loop {
                    let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    if i >= paths.len() { break }
                    *slots[i].lock().unwrap() = check_file(&paths[i]);
                });
            }
        });
        let results: Vec<Option<(String, Facts)>> = slots.into_iter().map(|s| s.into_inner().unwrap()).collect();
        let texts: Vec<&str> = results.iter().map(|r| r.as_ref().map(|x| x.0.as_str()).unwrap_or("")).collect();
        let all: Vec<(usize, &Facts)> = results.iter().enumerate().filter_map(|(i, r)| r.as_ref().map(|x| (i, &x.1))).collect();
        let mut found = vec![];
        rules(&all, &mut found);
        let mut set: Vec<String> = found.iter().map(|(code, i, loc)| {
            let (l, c) = line_col(texts[*i], *loc);
            format!("{} {}:{}:{}", code, paths[*i].strip_prefix(&dir).unwrap().to_string_lossy(), l, c)
        }).collect::<HashSet<_>>().into_iter().collect();
        set.sort();
        lines = set;
        walls.push(tr.elapsed());
    }
    if timing {
        walls.sort();
        eprintln!("{{\"files\":{},\"jobs\":{},\"checkMs\":{:.1},\"totalMs\":{:.1}}}", paths.len(), jobs, walls[walls.len() / 2].as_secs_f64() * 1000.0, t0.elapsed().as_secs_f64() * 1000.0);
    }
    println!("{}", lines.join("\n"));
}
