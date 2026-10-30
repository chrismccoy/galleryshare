import * as acorn from 'acorn';

export const EXCLUDED = ['public/vendor/', 'public/screenshots/', 'node_modules/'];

export const BROWSER_DIRS = ['public/js/'];

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function isFunction(node) {
  return Boolean(node) && FUNCTION_TYPES.has(node.type);
}

function returnsValue(fn) {
  if (fn.type === 'ArrowFunctionExpression' && fn.body.type !== 'BlockStatement') return true;
  let found = false;
  const visit = (node) => {
    if (found || !node || typeof node.type !== 'string') return;
    if (node !== fn && isFunction(node)) return;
    if (node.type === 'ReturnStatement' && node.argument) {
      found = true;
      return;
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(fn.body);
  return found;
}

function paramNames(text) {
  const names = [];
  for (const match of text.matchAll(/@param\s+(?:\{(?:[^{}]|\{[^{}]*\})*\}\s*)?(\[?[\w$.]+)/g)) {
    if (!match[1].includes('.')) names.push(match[1].replace(/^\[/, ''));
  }
  return names;
}

function declaredName(param) {
  const node = param.type === 'AssignmentPattern' ? param.left : param.type === 'RestElement' ? param.argument : param;
  return node.type === 'Identifier' ? node.name : null;
}

function headerProblems(file, ast, comments, sourceType) {
  const firstBlock = comments.find((comment) => comment.type === 'Block');
  if (!firstBlock || !firstBlock.value.startsWith('*') || !firstBlock.value.includes('@file')) {
    return [`${file}:1 (file) — missing @file header`];
  }
  if (ast.body.length > 0 && firstBlock.end > ast.body[0].start) {
    return [`${file}:1 (file) — @file header must come before any code`];
  }
  if (sourceType === 'module' && !/@module\s+\S/.test(firstBlock.value)) {
    return [`${file}:1 (file) — missing @module in header`];
  }
  return [];
}

function docAbove(code, comments, start) {
  const candidates = comments.filter((comment) => comment.end <= start);
  const comment = candidates[candidates.length - 1];
  if (!comment || comment.type !== 'Block' || !comment.value.startsWith('*')) return null;
  if (comment.value.includes('@file')) return null;
  if (comment.value.includes('@typedef') && !/@(?:param|returns?)\b/.test(comment.value)) return null;
  return code.slice(comment.end, start).trim() === '' ? comment.value : null;
}

function functionProblems(fn, doc, where, isConstructor) {
  if (doc === null) return [`${where} — missing JSDoc block`];
  const problems = [];
  const documented = paramNames(doc);
  if (documented.length !== fn.params.length) {
    problems.push(`${where} — missing @param (${documented.length} documented, ${fn.params.length} declared)`);
  } else {
    fn.params.forEach((param, i) => {
      const name = declaredName(param);
      if (name !== null && name !== documented[i]) {
        problems.push(`${where} — @param ${i + 1} is named ${documented[i]}, the code calls it ${name}`);
      }
    });
  }
  if (!isConstructor && returnsValue(fn) && !/@returns?\b/.test(doc)) problems.push(`${where} — missing @returns`);
  return problems;
}

function keyName(node) {
  return node.key?.name ?? node.key?.value ?? '(computed)';
}

function namedFunctionAt(node, parent, grand, code) {
  if (node.type === 'FunctionDeclaration' && node.id) {
    const exported = parent && parent.type.startsWith('Export');
    return { fn: node, name: node.id.name, anchor: exported ? parent.start : node.start };
  }
  if (
    node.type === 'ExportDefaultDeclaration' &&
    isFunction(node.declaration) &&
    !(node.declaration.type === 'FunctionDeclaration' && node.declaration.id)
  ) {
    return { fn: node.declaration, name: node.declaration.id?.name ?? 'default', anchor: node.start };
  }
  if (node.type === 'AssignmentExpression' && isFunction(node.right) && parent?.type === 'ExpressionStatement') {
    return { fn: node.right, name: code.slice(node.left.start, node.left.end), anchor: parent.start };
  }
  if (node.type === 'VariableDeclarator' && isFunction(node.init) && node.id.type === 'Identifier') {
    const exported = grand && grand.type.startsWith('Export');
    return { fn: node.init, name: node.id.name, anchor: exported ? grand.start : parent.start };
  }
  if (node.type === 'MethodDefinition') {
    return { fn: node.value, name: keyName(node), anchor: node.start, isConstructor: node.kind === 'constructor' };
  }
  if (node.type === 'PropertyDefinition' && isFunction(node.value)) {
    return { fn: node.value, name: keyName(node), anchor: node.start };
  }
  if (node.type === 'Property' && parent?.type === 'ObjectExpression' && isFunction(node.value)) {
    return { fn: node.value, name: keyName(node), anchor: node.start };
  }
  return null;
}

function namedFunctions(ast, code) {
  const found = [];
  const visit = (node, parent, grand) => {
    if (!node || typeof node.type !== 'string') return;
    const named = namedFunctionAt(node, parent, grand, code);
    if (named) found.push(named);
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach((item) => visit(item, node, parent));
      else if (child && typeof child === 'object') visit(child, node, parent);
    }
  };
  visit(ast, null, null);
  return found;
}

export function checkSource(code, file, sourceType = 'module') {
  const comments = [];
  const ast = acorn.parse(code, {
    ecmaVersion: 'latest',
    sourceType,
    allowHashBang: true,
    locations: true,
    onComment: comments,
  });
  const problems = headerProblems(file, ast, comments, sourceType);
  for (const { fn, name, anchor, isConstructor = false } of namedFunctions(ast, code)) {
    const where = `${file}:${fn.loc.start.line} ${name}`;
    problems.push(...functionProblems(fn, docAbove(code, comments, anchor), where, isConstructor));
  }
  return problems;
}

export function selectEnforced(paths) {
  return paths.filter((file) => /\.m?js$/.test(file) && !EXCLUDED.some((prefix) => file.startsWith(prefix))).sort();
}

export function sourceTypeFor(file) {
  return BROWSER_DIRS.some((dir) => file.startsWith(dir)) ? 'script' : 'module';
}
