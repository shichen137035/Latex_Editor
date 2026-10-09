import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const renderer = resolve(root, "apps/desktop/src/renderer");
const localeRoot = resolve(renderer, "i18n/locales");
const uiAttributes = new Set(["title", "placeholder", "aria-label", "alt", "label", "description", "message", "hint", "emptyMessage"]);
const uiProperties = new Set(["label", "description", "title", "message", "hint", "placeholder", "emptyMessage"]);
const technicalLabels = new Set(["TeXWeave", "PDF", "LaTeX", "TeX", "XML", "CSS", "JSON", "HTML", "SVG", "GUI", "AI", "API", "IPC", "UTF-8", "LF", "CRLF", "KaTeX", "Monaco", "pdfLaTeX", "XeLaTeX", "LuaLaTeX", "latexmk", "BibTeX", "Biber", "MakeIndex", "Copilot", "Codex", "GitHub", "Hunspell", "Hunspell (nspell)", "Ctrl", "Alt", "Shift", "Meta", "Command", "Ctrl K", "Space Grotesk", "Georgia", "Consolas", "Monospace", "px", "em", "ms", "KB", "MB", "GB", "TₑX", "Tₓ", "R", "L", "W", "X", "i", "Aa", "{booktabs}", "d{{…}}", "{{…}} · {{…}} KB"]);
const hasWords = value => /\p{L}/u.test(value) && !technicalLabels.has(value) && !/^[A-Z]+_[A-Z_]+:|^\s*\w+="/.test(value) && !/^\\|\\[a-z]|^--[\w-]+$|^https?:\/\/|^[\w.-]+\.(?:tex|sty|bib|cls|xml|json|md|exe)$|^@(?:article|book)\{/i.test(value);

function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}
function placeholders(text) { return [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]))].sort(); }

export function auditCatalogs(catalogs, selected = Object.keys(catalogs)) {
  const base = catalogs.en, keys = Object.keys(base);
  return selected.map(locale => {
    const catalog = catalogs[locale];
    if (!catalog) throw new Error(`Unknown locale: ${locale}`);
    const missing = keys.filter(key => typeof catalog[key] !== "string" || !catalog[key].trim());
    const mismatched = keys.filter(key => typeof catalog[key] === "string" && JSON.stringify(placeholders(base[key])) !== JSON.stringify(placeholders(catalog[key])));
    return { locale, total: keys.length, translated: keys.length - missing.length, missing: missing.map(key => ({ key, source: base[key] })), placeholders: mismatched.map(key => ({ key, expected: placeholders(base[key]), actual: placeholders(catalog[key]) })), extra: Object.keys(catalog).filter(key => !(key in base)), unchanged: keys.filter(key => catalog[key] === base[key] && hasWords(base[key])) };
  });
}

export function inspectSource(text, filename, base) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hardcoded = [], unknown = [];
  const seen = new Set();
  const record = (list, node, value, kind) => {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    const identity = `${node.pos}:${value}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    list.push({ file: filename, line: position.line + 1, column: position.character + 1, start: node.getStart(source), end: node.getEnd(), kind, text: value });
  };
  const staticText = node => ts.isStringLiteralLike(node) ? node.text : ts.isTemplateExpression(node) ? node.head.text + node.templateSpans.map(span => "{{…}}" + span.literal.text).join("") : undefined;
  const translated = node => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["t", "nativeText"].includes(node.expression.text);
  const inspectUiExpression = (node, kind) => {
    if (!node || translated(node)) return;
    const value = staticText(node);
    if (value !== undefined) { if (hasWords(value.trim()) && !(value in base)) record(hardcoded, node, value, kind); return; }
    if (ts.isConditionalExpression(node)) { inspectUiExpression(node.whenTrue, kind); inspectUiExpression(node.whenFalse, kind); }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.PlusToken].includes(node.operatorToken.kind)) {
      // Conditions such as mode === "source" are not displayed text.
      if (node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) inspectUiExpression(node.left, kind);
      inspectUiExpression(node.right, kind);
    }
    if (ts.isParenthesizedExpression(node)) inspectUiExpression(node.expression, kind);
  };
  function visit(node) {
    if (translated(node)) {
      const key = node.arguments[0];
      if (key && ts.isStringLiteralLike(key) && !(key.text in base)) record(unknown, key, key.text, "translation key");
    }
    if (ts.isJsxText(node)) {
      const value = node.text.replace(/\s+/g, " ").trim();
      const parent = node.parent;
      const tag = ts.isJsxElement(parent) ? parent.openingElement.tagName.getText(source) : "";
      if (!["code", "pre"].includes(tag) && hasWords(value)) record(hardcoded, node, value, "JSX text");
    }
    if (ts.isJsxAttribute(node) && uiAttributes.has(node.name.getText(source)) && node.initializer) {
      inspectUiExpression(ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer, "UI attribute");
    }
    if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent)) inspectUiExpression(node.expression, "JSX expression");
    if (ts.isPropertyAssignment(node) && uiProperties.has(node.name.getText(source).replace(/^['"]|['"]$/g, "")) && !(ts.isStringLiteralLike(node.initializer) && /^[a-z][a-z-]*$/.test(node.initializer.text))) inspectUiExpression(node.initializer, "UI property");
    if (ts.isCallExpression(node) && /^(?:alert|confirm|prompt|setError|setNotice|setBlockNotice|set\w+(?:Error|Notice))$/.test(node.expression.getText(source).replace(/^window\./, ""))) inspectUiExpression(node.arguments[0], "UI message");
    if (ts.isNewExpression(node) && node.expression.getText(source) === "Error") inspectUiExpression(node.arguments?.[0], "UI error");
    if (ts.isVariableDeclaration(node) && /^(?:title|label|description|hint|message|notice|placeholder|emptyMessage)$/.test(node.name.getText(source))) inspectUiExpression(node.initializer, "UI variable");
    if (ts.isArrayLiteralExpression(node) && node.elements.length === 2 && ts.isStringLiteralLike(node.elements[0]) && ts.isStringLiteralLike(node.elements[1]) && /^[A-Z\p{Script=Han}]/u.test(node.elements[1].text)) inspectUiExpression(node.elements[1], "UI tuple");
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { hardcoded, unknown };
}

export function auditProject(selected) {
  const catalogs = Object.fromEntries(readdirSync(localeRoot).filter(name => name.endsWith(".json")).map(name => [name.slice(0, -5), JSON.parse(readFileSync(resolve(localeRoot, name), "utf8"))]));
  const sources = [...filesIn(renderer).filter(path => !path.includes(resolve(renderer, "i18n") + "/") && !path.includes("i18n\\")), resolve(root, "apps/desktop/src/main/index.ts")];
  const inspected = sources.map(path => inspectSource(readFileSync(path, "utf8"), relative(root, path).replaceAll("\\", "/"), catalogs.en));
  return { languages: auditCatalogs(catalogs, selected), hardcoded: inspected.flatMap(result => result.hardcoded), unknown: inspected.flatMap(result => result.unknown) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = process.argv.indexOf("--locale");
  const report = auditProject(option >= 0 ? [process.argv[option + 1]] : undefined);
  if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else {
    for (const language of report.languages) {
      console.log(`${language.locale}: ${language.translated}/${language.total}; missing ${language.missing.length}; placeholder mismatches ${language.placeholders.length}; extra ${language.extra.length}; unchanged ${language.unchanged.length}`);
      if (process.argv.includes("--details")) for (const item of [...language.missing, ...language.placeholders]) console.log(`  ${language.locale}: ${item.key}${item.source ? " — " + item.source : " — placeholder mismatch"}`);
    }
    console.log(`Undefined translation keys: ${report.unknown.length}; hardcoded UI candidates: ${report.hardcoded.length}`);
    if (process.argv.includes("--details")) for (const item of [...report.unknown, ...report.hardcoded]) console.log(`  ${item.file}:${item.line} ${item.kind} — ${item.text}`);
  }
  if (report.languages.some(language => language.missing.length || language.placeholders.length) || report.unknown.length || report.hardcoded.length) process.exitCode = 1;
}
