const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// ── Dependency-free source lint using the existing TypeScript parser ──
// The old `next lint` command had no ESLint installation or configuration.
// Keep the prompt's dependency budget: only Three.js and its types are added.
let errors = 0,
  files = 0;
function check(filename) {
  files++;
  const source = ts.createSourceFile(
    filename,
    fs.readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const court =
    filename.replaceAll('\\', '/').includes('/court/') ||
    /Court(Canvas|Environment|Progress)\.tsx$/.test(filename);
  const report = (node, rule) => {
    const line =
      source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    process.stderr.write(`${filename}:${line}: ${rule}\n`);
    errors++;
  };
  for (const diagnostic of source.parseDiagnostics) {
    process.stderr.write(
      `${filename}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}\n`,
    );
    errors++;
  }
  function visit(node) {
    if (node.kind === ts.SyntaxKind.DebuggerStatement)
      report(node, 'no-debugger');
    if (
      ts.isVariableDeclarationList(node) &&
      !(node.flags & ts.NodeFlags.BlockScoped)
    )
      report(node, 'no-var');
    if (court && node.kind === ts.SyntaxKind.AnyKeyword)
      report(node, 'no-explicit-any in court code');
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
      ].includes(node.operatorToken.kind) &&
      node.left.kind !== ts.SyntaxKind.NullKeyword &&
      node.right.kind !== ts.SyntaxKind.NullKeyword
    )
      report(node, 'use strict equality');
    if (ts.isObjectLiteralExpression(node) || ts.isJsxAttributes(node)) {
      const names = new Set();
      for (const property of node.properties) {
        if (!property.name || ts.isComputedPropertyName(property.name))
          continue;
        const name = property.name.getText(source);
        if (names.has(name)) report(property, 'duplicate property');
        names.add(name);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(filename);
    else if (/\.tsx?$/.test(filename)) check(filename);
  }
}
walk('src');
if (errors) process.exitCode = 1;
else
  process.stdout.write(
    `Lint passed: ${files} TypeScript/TSX files (syntax, debugger, var, equality, duplicate properties, court any).\n`,
  );
