export interface ComplexityContribution {
  line: number;
  column: number;
  contribution: number;
  description: string;
}

export function calculateCognitiveComplexity(code: string): number {
  return analyzeCognitiveComplexity(code).totalComplexity;
}

export function analyzeCognitiveComplexity(code: string, methodName?: string): {
  totalComplexity: number;
  contributions: ComplexityContribution[];
} {
  let complexity = 0;
  let nestingLevel = 0;
  const contributions: ComplexityContribution[] = [];
  
  const tokens = tokenizeWithPositions(code);
  
  for (let i = 0; i < tokens.length; i++) {
    const { token, line, column } = tokens[i];
    const prevToken = tokens[i - 1]?.token;
    const nextToken = tokens[i + 1]?.token;
    let contribution = 0;
    let description = '';
    let incrementsNesting = false;
    
    switch (token) {
      case 'if':
        contribution = 1 + nestingLevel;
        description = nestingLevel === 0 
          ? `+${contribution} if statement`
          : `+${contribution} nested if statement (nesting=${nestingLevel})`;
        complexity += contribution;
        incrementsNesting = true;
        break;
        
      case 'else':
        if (nextToken === 'if') {
          // else if - hybrid increment (no nesting penalty)
          contribution = 1;
          description = `+${contribution} else if statement`;
          complexity += contribution;
          incrementsNesting = true;
          i++; // Skip the 'if' token
        } else {
          // else - hybrid increment (no nesting penalty) 
          contribution = 1;
          description = `+${contribution} else statement`;
          complexity += contribution;
          incrementsNesting = true;
        }
        break;
        
      case 'while':
      case 'for':
      case 'do':
        contribution = 1 + nestingLevel;
        description = nestingLevel === 0 
          ? `+${contribution} ${token} loop`
          : `+${contribution} nested ${token} loop (nesting=${nestingLevel})`;
        complexity += contribution;
        incrementsNesting = true;
        break;
        
      case 'catch':
        contribution = 1 + nestingLevel;
        description = nestingLevel === 0 
          ? `+${contribution} catch block`
          : `+${contribution} nested catch block (nesting=${nestingLevel})`;
        complexity += contribution;
        incrementsNesting = true;
        break;
        
      case 'switch':
        contribution = 1 + nestingLevel;
        description = nestingLevel === 0 
          ? `+${contribution} switch statement`
          : `+${contribution} nested switch statement (nesting=${nestingLevel})`;
        complexity += contribution;
        incrementsNesting = true;
        break;
        
      case '?':
        contribution = 1 + nestingLevel;
        description = nestingLevel === 0 
          ? `+${contribution} ternary operator`
          : `+${contribution} nested ternary operator (nesting=${nestingLevel})`;
        complexity += contribution;
        incrementsNesting = true;
        break;
        
      case '&&':
      case '||':
        // Check if this starts a new sequence of logical operators
        if (prevToken !== '&&' && prevToken !== '||') {
          contribution = 1;
          description = `+${contribution} logical operator sequence`;
          complexity += contribution;
        }
        break;
        
      case '{':
        if (incrementsNesting || (prevToken && isNestingToken(prevToken))) {
          nestingLevel++;
        }
        break;
        
      case '}':
        if (nestingLevel > 0) nestingLevel--;
        break;
        
      case 'goto':
      case 'break':
      case 'continue':
        // Only increment for labeled jumps or multi-level jumps
        if (nextToken && (isLabel(nextToken) || isNumber(nextToken))) {
          contribution = 1;
          description = `+${contribution} jump to ${nextToken}`;
          complexity += contribution;
        }
        break;
    }
    
    if (contribution > 0) {
      contributions.push({ line, column, contribution, description });
    }
    
    // Reset incrementsNesting flag after processing braces
    if (token !== '{' && token !== '}') {
      incrementsNesting = false;
    }
  }
  
  for (const c of findCrypticIdentifierContributions(code)) {
    contributions.push(c);
    complexity += c.contribution;
  }

  for (const c of findRegexNamingContributions(code, methodName)) {
    contributions.push(c);
    complexity += c.contribution;
  }

  if (methodName && hasTrailingLogicAfterControlBlock(code)) {
    const contribution = 3;
    contributions.push({
      line: 1,
      column: 0,
      contribution,
      description: `+${contribution} method mixes a control-flow block with unrelated logic afterward — consider extracting a helper`
    });
    complexity += contribution;
  }

  return { totalComplexity: complexity, contributions };
}

// Single-letter identifiers (d, m, i...) read poorly at a glance. Flags
// declaration sites only, except i/j/k in a plain for-loop header, which is
// too idiomatic to penalize.
const LOOP_COUNTER_NAMES = new Set(['i', 'j', 'k']);
const FOR_HEADER_LOOKBEHIND_REGEX = /for\s*\(\s*$/;
const DECLARATION_REGEXES = [
  /\b(?:let|const|var)\s+([A-Za-z_$][\w$]*)\b/g,
  /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g,
  // ponytail: known-type allowlist for Apex/Java-style typed declarations; extend if a new type shows up.
  /\b(?:String|Integer|Boolean|Double|Long|Object|Decimal|Id|Date|DateTime|Blob|List<[^;=()]*>|Map<[^;=()]*>|Set<[^;=()]*>)\s+([A-Za-z_$][\w$]*)\s*[=;]/g
];

function findCrypticIdentifierContributions(code: string): ComplexityContribution[] {
  const clean = stripForStructure(code);
  const lineStarts = computeLineStarts(code);
  const contributions: ComplexityContribution[] = [];
  const seen = new Set<number>();

  for (const regex of DECLARATION_REGEXES) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(clean)) !== null) {
      const name = match[1];
      if (name.length !== 1) continue;

      if (LOOP_COUNTER_NAMES.has(name)) {
        const before = clean.slice(Math.max(0, match.index - 30), match.index);
        if (FOR_HEADER_LOOKBEHIND_REGEX.test(before)) continue;
      }

      const nameIndex = match.index + match[0].lastIndexOf(name);
      if (seen.has(nameIndex)) continue;
      seen.add(nameIndex);

      const line = lineForIndex(lineStarts, nameIndex);
      contributions.push({
        line: line + 1,
        column: nameIndex - lineStarts[line],
        contribution: 1,
        description: `+1 cryptic identifier name '${name}' (consider a descriptive name)`
      });
    }
  }

  return contributions;
}

// An inline regex literal buried in a method with a vague name is bad
// practice — the caller can't tell what it extracts without reading the
// pattern. Only checked per-method (methodName provided), since a whole-file
// score has no single name to judge against.
const DESCRIPTIVE_NAME_REGEX = /extract|parse|match|regex|pattern|valid|test|find|replace|sanitize|normalize/i;
const REGEX_LITERAL_REGEX = /(^|[=([{,:!&|;]\s*|\breturn\s+)\/(?:[^\/\\\r\n]|\\.)+\/[a-z]*/g;

function findRegexNamingContributions(code: string, methodName?: string): ComplexityContribution[] {
  if (!methodName || DESCRIPTIVE_NAME_REGEX.test(methodName)) return [];

  const clean = stripForStructure(code);
  const lineStarts = computeLineStarts(code);
  const contributions: ComplexityContribution[] = [];

  REGEX_LITERAL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REGEX_LITERAL_REGEX.exec(clean)) !== null) {
    const slashIndex = match.index + match[1].length;
    const line = lineForIndex(lineStarts, slashIndex);
    contributions.push({
      line: line + 1,
      column: slashIndex - lineStarts[line],
      contribution: 2,
      description: `+2 inline regex in '${methodName}' — extract to a well-named function (e.g. extractX)`
    });
  }

  return contributions;
}

// A method that runs a control-flow block and then keeps going with unrelated
// logic is doing more than one thing, even without extra nesting. Detects
// only the first top-level block, once per method (not per occurrence).
function hasTrailingLogicAfterControlBlock(body: string): boolean {
  const clean = stripForStructure(body);
  const openBrace = clean.indexOf('{');
  if (openBrace === -1) return false;
  const closeBrace = findMatchingBrace(clean, openBrace);
  if (closeBrace === -1) return false;

  const controlRegex = /\b(?:if|for|while|switch|do)\b/g;
  controlRegex.lastIndex = openBrace;
  const match = controlRegex.exec(clean);
  if (!match || match.index >= closeBrace) return false;

  const blockBraceOpen = clean.indexOf('{', match.index);
  if (blockBraceOpen === -1 || blockBraceOpen >= closeBrace) return false;
  const blockBraceClose = findMatchingBrace(clean, blockBraceOpen);
  if (blockBraceClose === -1) return false;

  return clean.slice(blockBraceClose + 1, closeBrace).trim().length > 0;
}

export interface MethodComplexity {
  name: string;
  line: number; // 0-based
  complexity: number;
}

export interface MethodBoundary {
  name: string;
  line: number; // 0-based
  body: string;
}

const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch']);

// Note: Heuristic regex-based function detection, not a real parser.
// Misses decorated methods and object-literal arrow properties.
// Upgrade path: swap in a real per-language parser if that becomes a problem.
export function findMethodBoundaries(code: string): MethodBoundary[] {
  const clean = stripForStructure(code);
  const lineStarts = computeLineStarts(code);
  const byBrace = new Map<number, { index: number; name: string }>();

  const functionRegex = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = functionRegex.exec(clean)) !== null) {
    const parenOpen = m.index + m[0].length - 1;
    const parenClose = findMatchingParen(clean, parenOpen);
    if (parenClose === -1) continue;
    const braceIndex = findBodyBrace(clean, parenClose + 1);
    if (braceIndex === -1) continue;
    byBrace.set(braceIndex, { index: m.index, name: m[1] });
  }

  const methodRegex = /\b([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*(?::\s*[\w<>[\],\s]+)?\s*\{/g;
  while ((m = methodRegex.exec(clean)) !== null) {
    const name = m[1];
    if (CONTROL_KEYWORDS.has(name)) continue;
    const braceIndex = m.index + m[0].length - 1;
    if (!byBrace.has(braceIndex)) byBrace.set(braceIndex, { index: m.index, name });
  }

  const arrowRegex = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^;{}]*\)\s*(?::[^=]+)?=>\s*\{/g;
  while ((m = arrowRegex.exec(clean)) !== null) {
    const braceIndex = m.index + m[0].length - 1;
    if (!byBrace.has(braceIndex)) byBrace.set(braceIndex, { index: m.index, name: m[1] });
  }

  const boundaries: MethodBoundary[] = [];
  for (const [braceIndex, { index, name }] of byBrace) {
    const endIndex = findMatchingBrace(clean, braceIndex);
    if (endIndex === -1) continue;
    boundaries.push({ name, line: lineForIndex(lineStarts, index), body: code.slice(index, endIndex + 1) });
  }

  return boundaries.sort((a, b) => a.line - b.line);
}

// Convenience wrapper that also scores each method. Prefer findMethodBoundaries()
// when the caller wants to defer/stagger the (cheap but non-zero) scoring pass,
// e.g. a CodeLens provider resolving lenses lazily per-method.
export function findMethodComplexities(code: string): MethodComplexity[] {
  return findMethodBoundaries(code).map(({ name, line, body }) => ({
    name,
    line,
    complexity: analyzeCognitiveComplexity(body, name).totalComplexity
  }));
}

function findBodyBrace(clean: string, from: number): number {
  const rest = clean.slice(from);
  const match = rest.match(/^[^{;=]*\{/);
  return match ? from + match[0].length - 1 : -1;
}

function findMatchingParen(clean: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < clean.length; i++) {
    if (clean[i] === '(') depth++;
    else if (clean[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findMatchingBrace(clean: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < clean.length; i++) {
    if (clean[i] === '{') depth++;
    else if (clean[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Same comment/string stripping as tokenizeWithPositions, but preserves length
// and newlines so indices/line numbers still map back to the original source.
function stripForStructure(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (s) => ' '.repeat(s.length))
    .replace(/"(?:[^"\\]|\\.)*"/g, (s) => ' '.repeat(s.length))
    .replace(/'(?:[^'\\]|\\.)*'/g, (s) => ' '.repeat(s.length))
    .replace(/`(?:[^`\\]|\\.)*`/g, (s) => ' '.repeat(s.length));
}

function computeLineStarts(code: string): number[] {
  const starts = [0];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineForIndex(lineStarts: number[], index: number): number {
  let lo = 0, hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

interface TokenWithPosition {
  token: string;
  line: number;
  column: number;
}

function tokenizeWithPositions(code: string): TokenWithPosition[] {
  const tokens: TokenWithPosition[] = [];
  
  // Remove comments and strings 
  let cleanCode = code
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multiline comments
    .replace(/\/\/.*$/gm, '') // Remove single-line comments
    .replace(/"(?:[^"\\]|\\.)*"/g, '') // Remove double-quoted strings
    .replace(/'(?:[^'\\]|\\.)*'/g, '') // Remove single-quoted strings
    .replace(/`(?:[^`\\]|\\.)*`/g, ''); // Remove template literals
  
  const lines = cleanCode.split('\n');
  
  // Updated regex to capture all required tokens
  const regex = /\b(?:if|else|while|for|do|switch|case|catch|try|finally|goto|break|continue|function)\b|[{}]|&&|\|\||(?<!\?)(\?)(?!\?|\.)|:/g;
  
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    
    let match;
    while ((match = regex.exec(line)) !== null) {
      // Skip 'case' and 'try'/'finally' as they don't increment complexity
      if (match[0] === 'case' || match[0] === 'try' || match[0] === 'finally') {
        continue;
      }
      
      tokens.push({
        token: match[0],
        line: lineIndex + 1, // 1-based line numbers
        column: match.index
      });
    }
    regex.lastIndex = 0; // Reset for next line
  }
  
  return tokens;
}

function isNestingToken(token: string): boolean {
  return ['if', 'else', 'while', 'for', 'do', 'switch', 'catch'].includes(token);
}

function isLabel(token: string): boolean {
  // Simple heuristic: labels are typically alphanumeric identifiers
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(token);
}

function isNumber(token: string): boolean {
  return /^\d+$/.test(token);
}

if (require.main === module) {
  const assert = require('assert');

  const sample = `
function plain(a) {
  if (a) {
    return 1;
  }
}

class Foo {
  method(b) {
    if (b) {
      if (b > 1) {
        return 2;
      }
    }
  }
}

const arrow = (c) => {
  for (let i = 0; i < c; i++) {
    console.log(i);
  }
};
`;

  const methods = findMethodComplexities(sample);
  assert.strictEqual(methods.length, 3, `expected 3 methods, got ${methods.length}`);
  assert.deepStrictEqual(methods.map(m => m.name), ['plain', 'method', 'arrow']);
  assert.strictEqual(methods.find(m => m.name === 'plain')!.complexity, 1);
  assert.strictEqual(methods.find(m => m.name === 'method')!.complexity, 3);
  assert.strictEqual(methods.find(m => m.name === 'arrow')!.complexity, 1);

  // Cryptic identifiers: flagged unless it's i/j/k in a for-loop header.
  const crypticSample = `
function useCryptic(a) {
  let d = a;
  return d;
}

function loopOk(n) {
  for (let i = 0; i < n; i++) {
    console.log(i);
  }
}

function loopBad(n) {
  for (let q = 0; q < n; q++) {
    console.log(q);
  }
}
`;
  const crypticMethods = findMethodComplexities(crypticSample);
  assert.strictEqual(crypticMethods.find(m => m.name === 'useCryptic')!.complexity, 1);
  assert.strictEqual(crypticMethods.find(m => m.name === 'loopOk')!.complexity, 1);
  assert.strictEqual(crypticMethods.find(m => m.name === 'loopBad')!.complexity, 2);

  // Inline regex without a descriptive method name.
  const regexSample = `
function handleInput(s) {
  return /^[a-z]+$/.test(s);
}

function extractDigits(s) {
  return /^[0-9]+$/.test(s);
}
`;
  const regexMethods = findMethodComplexities(regexSample);
  assert.strictEqual(regexMethods.find(m => m.name === 'handleInput')!.complexity, 2);
  assert.strictEqual(regexMethods.find(m => m.name === 'extractDigits')!.complexity, 0);

  // A method mixing a loop with unrelated trailing logic scores higher.
  const mixedSample = `
function mixedResponsibility(items) {
  for (const item of items) {
    console.log(item);
  }
  return items.length;
}

function loopOnly(items) {
  for (const item of items) {
    console.log(item);
  }
}
`;
  const mixedMethods = findMethodComplexities(mixedSample);
  assert.strictEqual(mixedMethods.find(m => m.name === 'loopOnly')!.complexity, 1);
  assert.strictEqual(mixedMethods.find(m => m.name === 'mixedResponsibility')!.complexity, 4);

  console.log('complexity.ts self-check passed');
}