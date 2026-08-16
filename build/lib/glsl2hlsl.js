/**
 * GLSL ES 1.00 -> HLSL (vs_5_0) translator for vertexshaderart shaders.
 *
 * This is a source level port, not a recompile: the output keeps the original
 * names, structure, comments and whitespace, and only the things that actually
 * differ between the two languages are rewritten.
 *
 * The one thing that isn't a rename is matrices. GLSL is column vector
 * (`M * v`, `mat4(c0,c1,c2,c3)` takes columns, `m[i]` is a column); HLSL is
 * conventionally row vector (`mul(v, M)`, `float4x4(r0,r1,r2,r3)` takes rows,
 * `m[i]` is a row). Rather than sprinkle transpose() everywhere, every matrix
 * here holds the transpose of its GLSL counterpart. That makes the two places
 * these shaders touch matrices most often carry over untouched:
 *
 *   mat4(c0, c1, c2, c3)  ->  float4x4(c0, c1, c2, c3)   // cols become rows
 *   m[0] = vX             ->  m[0] = vX                  // col 0 is row 0
 *
 * and pushes the whole difference into the multiplies, where it's invisible:
 *
 *   M * v   ->  mul(v, M)
 *   v * M   ->  mul(M, v)
 *   A * B   ->  mul(B, A)      // (A*B)^T == B^T * A^T
 *   M *= A  ->  M = mul(A, M)
 *
 * Working out which `*` is a matrix multiply needs types, so this carries a
 * small type inferencer over the subset of GLSL these shaders use. Anything it
 * can't type or parse is reported rather than guessed at.
 */

const TYPE_MAP = {
  vec2: 'float2', vec3: 'float3', vec4: 'float4',
  ivec2: 'int2', ivec3: 'int3', ivec4: 'int4',
  bvec2: 'bool2', bvec3: 'bool3', bvec4: 'bool4',
  mat2: 'float2x2', mat3: 'float3x3', mat4: 'float4x4',
};

// same name, different spelling
const FUNC_MAP = {
  mix: 'lerp',
  fract: 'frac',
  inversesqrt: 'rsqrt',
  dFdx: 'ddx',
  dFdy: 'ddy',
};

// HLSL intrinsics a user function would collide with. 136 of these shaders
// define their own transpose(), 20 define noise().
const HLSL_INTRINSICS = new Set(`abs acos all any asfloat asin asint asuint atan atan2 ceil clamp clip cos
  cosh cross ddx ddy degrees determinant distance dot dst exp exp2 faceforward floor fmod frac frexp fwidth
  isfinite isinf isnan ldexp length lerp lit log log10 log2 mad max min modf mul noise normalize pow radians
  rcp reflect refract round rsqrt saturate sign sin sincos sinh smoothstep sqrt step tan tanh transpose
  trunc`.split(/\s+/));

const KEYWORDS = new Set(`attribute const uniform varying break continue do for while if else in out inout
  float int void bool true false discard return mat2 mat3 mat4 vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3
  bvec4 sampler2D samplerCube struct precision highp mediump lowp`.split(/\s+/));

const T = {
  float: {kind: 'scalar', base: 'float'},
  int: {kind: 'scalar', base: 'int'},
  bool: {kind: 'scalar', base: 'bool'},
  void: {kind: 'void'},
  unknown: {kind: 'unknown'},
  sampler: {kind: 'sampler'},
};
const vec = (base, n) => ({kind: 'vec', base, n});
const mat = n => ({kind: 'mat', n});
const isMat = t => t?.kind === 'mat';
const isVec = t => t?.kind === 'vec';

function typeFromName(name) {
  switch (name) {
    case 'float': case 'int': case 'bool': case 'void': return T[name];
    case 'sampler2D': case 'samplerCube': return T.sampler;
  }
  let m = /^([ib]?)vec([234])$/.exec(name);
  if (m) {
    return vec(m[1] === 'i' ? 'int' : m[1] === 'b' ? 'bool' : 'float', +m[2]);
  }
  m = /^mat([234])$/.exec(name);
  if (m) {
    return mat(+m[1]);
  }
  return null;
}

// ---------------------------------------------------------------- lexer

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const push = (type, start) => tokens.push({type, value: src.slice(start, i), start, end: i});
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { ++i; }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { ++i; }
      i += 2;
      continue;
    }
    if (c === '#') {
      const start = i;
      while (i < src.length) {
        if (src[i] === '\\' && src[i + 1] === '\n') { i += 2; continue; }
        if (src[i] === '\n') { break; }
        ++i;
      }
      push('pp', start);
      continue;
    }
    if (/\s/.test(c)) { ++i; continue; }
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) { ++i; }
      push('ident', start);
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const start = i;
      while (i < src.length && /[0-9.eE]/.test(src[i])) {
        if (/[eE]/.test(src[i]) && /[-+]/.test(src[i + 1] || '')) { i += 2; continue; }
        ++i;
      }
      if (/[fF]/.test(src[i] || '')) { ++i; }
      push('number', start);
      continue;
    }
    const start = i;
    const three = src.substr(i, 3);
    const two = src.substr(i, 2);
    if (['<<=', '>>='].includes(three)) {
      i += 3;
    } else if (['++', '--', '&&', '||', '^^', '<=', '>=', '==', '!=', '+=', '-=', '*=', '/=', '%=', '<<', '>>', '&=', '|=', '^='].includes(two)) {
      i += 2;
    } else {
      i += 1;
    }
    push('punc', start);
  }
  tokens.push({type: 'eof', value: '', start: src.length, end: src.length});
  return tokens;
}

// ---------------------------------------------------------------- parser

/**
 * Ranges the preprocessor would drop.
 *
 * Exactly one branch of each conditional is live, which is what keeps the
 * token stream parseable: these shaders use `#if 0` to comment out blocks that
 * aren't brace balanced on their own (`#if 0 } else {`), and the dead side of
 * an `#if 1 ... #else` would otherwise be parsed as a second live copy.
 *
 * `#if 0` takes the else branch, everything else (`#if 1`, `#ifdef`, anything
 * this doesn't evaluate) takes the first branch.
 */
export function inactiveRanges(src) {
  const ranges = [];
  const stack = [];
  for (const m of src.matchAll(/^[ \t]*#[ \t]*(if|ifdef|ifndef|else|elif|endif)\b([^\n]*)/gm)) {
    const [text, directive, rest] = m;
    const lineEnd = m.index + text.length;
    const closeDead = frame => {
      if (frame?.deadStart !== null && frame?.deadStart !== undefined) {
        ranges.push([frame.deadStart, m.index]);
        frame.deadStart = null;
      }
    };
    if (['if', 'ifdef', 'ifndef'].includes(directive)) {
      const taken = !(directive === 'if' && rest.trim() === '0');
      stack.push({taken, deadStart: taken ? null : lineEnd});
    } else if (directive === 'else' || directive === 'elif') {
      const frame = stack.at(-1);
      if (!frame) { continue; }
      closeDead(frame);
      if (frame.taken) {
        frame.deadStart = lineEnd;
      } else {
        frame.taken = true;
      }
    } else if (directive === 'endif') {
      const frame = stack.pop();
      if (frame) { closeDead(frame); }
    }
  }
  for (const frame of stack) {
    if (frame?.deadStart !== null && frame?.deadStart !== undefined) {
      ranges.push([frame.deadStart, src.length]);
    }
  }
  // merge so nested dead regions don't produce overlapping edits
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    if (merged.length && r[0] <= merged.at(-1)[1]) {
      merged.at(-1)[1] = Math.max(merged.at(-1)[1], r[1]);
    } else {
      merged.push([...r]);
    }
  }
  return merged;
}

class Parser {
  constructor(src) {
    this.src = src;
    this.all = tokenize(src);
    this.inactive = inactiveRanges(src);
    const live = t => !this.inactive.some(([a, b]) => t.start >= a && t.end <= b);
    this.toks = this.all.filter(t => t.type !== 'pp' && (t.type === 'eof' || live(t)));
    this.pp = this.all.filter(t => t.type === 'pp');
    this.pos = 0;
    this.edits = [];
    this.warnings = [];
    // name -> return type, for user functions
    this.funcs = new Map();
    this.renames = new Map();
    this.scopes = [new Map()];
    this.used = {mod: false, texture: false};
    // function bodies that had to be handed to the rename-only path
    this.unparsed = [];
    // #define names, so referencing one isn't reported as an unknown identifier
    this.macros = new Set([...src.matchAll(/^[ \t]*#[ \t]*define[ \t]+(\w+)/gm)].map(m => m[1]));
  }

  peek(k = 0) { return this.toks[this.pos + k]; }
  get tok() { return this.toks[this.pos]; }
  next() { return this.toks[this.pos++]; }
  is(v, k = 0) { return this.peek(k).value === v; }
  eat(v) { if (this.is(v)) { return this.next(); } return null; }
  expect(v) {
    if (!this.is(v)) {
      throw new Error(`expected "${v}" but found "${this.tok.value}" at offset ${this.tok.start}`);
    }
    return this.next();
  }

  edit(start, end, text) { this.edits.push({start, end, kind: 'text', text}); }

  pushScope() { this.scopes.push(new Map()); }
  popScope() { this.scopes.pop(); }
  declare(name, type) { this.scopes.at(-1).set(name, type); }
  lookup(name) {
    for (let i = this.scopes.length - 1; i >= 0; --i) {
      if (this.scopes[i].has(name)) { return this.scopes[i].get(name); }
    }
    return null;
  }

  // ---- the environment vertexshaderart injects around every shader
  declareBuiltins() {
    const g = this.scopes[0];
    g.set('vertexId', T.float);
    g.set('time', T.float);
    g.set('vertexCount', T.float);
    g.set('mouse', vec('float', 2));
    g.set('resolution', vec('float', 2));
    g.set('soundRes', vec('float', 2));
    g.set('background', vec('float', 4));
    g.set('_dontUseDirectly_pointSize', T.float);
    g.set('gl_Position', vec('float', 4));
    g.set('gl_PointSize', T.float);
    g.set('v_color', vec('float', 4));
    for (const s of ['volume', 'sound', 'floatSound', 'touch']) { g.set(s, T.sampler); }
  }

  // ---- types

  typeName() {
    const t = this.tok;
    if (t.type !== 'ident') { return null; }
    if (typeFromName(t.value) || this.structs?.has(t.value)) { return t.value; }
    return null;
  }

  parseUnit() {
    this.structs = new Set();
    this.declareBuiltins();
    // hoist function signatures so calls before definitions still type
    this.hoistSignatures();
    while (this.tok.type !== 'eof') {
      this.parseTopLevel();
    }
  }

  hoistSignatures() {
    for (let i = 0; i < this.toks.length - 2; ++i) {
      const [a, b, c] = [this.toks[i], this.toks[i + 1], this.toks[i + 2]];
      if (a.type === 'ident' && b.type === 'ident' && c.value === '(') {
        const rt = typeFromName(a.value);
        if (rt && !this.funcs.has(b.value)) { this.funcs.set(b.value, rt); }
      }
      if (a.value === 'struct' && b.type === 'ident') { this.structs.add(b.value); }
    }
    for (const name of this.funcs.keys()) {
      if (HLSL_INTRINSICS.has(name)) { this.renames.set(name, `${name}_`); }
    }
  }

  parseTopLevel() {
    if (['const', 'uniform', 'attribute', 'varying', 'highp', 'mediump', 'lowp'].includes(this.tok.value) &&
        this.tok.value !== 'precision') {
      return this.parseDeclaration();
    }
    if (this.is('precision')) {
      const start = this.tok.start;
      while (!this.is(';') && this.tok.type !== 'eof') { this.next(); }
      const end = this.eat(';')?.end ?? this.tok.start;
      this.edit(start, end, '// (GLSL precision qualifier, not needed in HLSL)');
      return;
    }
    if (this.is('struct')) { return this.parseStruct(); }
    const save = this.pos;
    const tn = this.typeName();
    if (tn) {
      this.next();
      this.mapTypeToken(this.toks[this.pos - 1]);
      if (this.tok.type === 'ident' && this.is('(', 1)) { return this.parseFunction(tn); }
      this.pos = save;
      return this.parseDeclaration(true);
    }
    throw new Error(`unexpected "${this.tok.value}" at offset ${this.tok.start}`);
  }

  mapTypeToken(tok) {
    const mapped = TYPE_MAP[tok.value];
    if (mapped) { this.edit(tok.start, tok.end, mapped); }
  }

  parseStruct() {
    this.expect('struct');
    const name = this.next().value;
    this.structs.add(name);
    this.expect('{');
    const fields = new Map();
    while (!this.is('}')) {
      const tn = this.typeName();
      if (!tn) { throw new Error(`bad struct field at offset ${this.tok.start}`); }
      this.next();
      this.mapTypeToken(this.toks[this.pos - 1]);
      for (;;) {
        const fname = this.next().value;
        fields.set(fname, typeFromName(tn) ?? {kind: 'struct', name: tn});
        if (!this.eat(',')) { break; }
      }
      this.expect(';');
    }
    this.expect('}');
    this.expect(';');
    this.structFields = this.structFields || new Map();
    this.structFields.set(name, fields);
  }

  parseFunction(returnTypeName) {
    const name = this.next();
    if (this.renames.has(name.value)) {
      this.edit(name.start, name.end, this.renames.get(name.value));
    }
    this.expect('(');
    this.pushScope();
    while (!this.is(')')) {
      // in / out / inout / const carry over to HLSL as is
      while (['in', 'out', 'inout', 'const'].includes(this.tok.value)) { this.next(); }
      const tn = this.typeName();
      if (!tn) { throw new Error(`bad parameter at offset ${this.tok.start}`); }
      this.next();
      this.mapTypeToken(this.toks[this.pos - 1]);
      if (this.tok.type === 'ident') {
        const pname = this.next().value;
        this.declare(pname, typeFromName(tn) ?? {kind: 'struct', name: tn});
      }
      if (!this.eat(',')) { break; }
    }
    this.expect(')');
    this.funcs.set(name.value, typeFromName(returnTypeName) ?? {kind: 'struct', name: returnTypeName});
    if (this.eat(';')) { this.popScope(); return; }
    const bodyStart = this.tok.start;
    try {
      this.parseBlock(false);
    } catch (e) {
      // One shader builds its geometry out of macros that expand into control
      // flow (`#define Q(i) if(id<float(i)){`), so its body isn't parseable as
      // GLSL. Hand just that body to the rename-only path and carry on with
      // the rest of the file, where the matrix code lives.
      const end = this.skipOpaqueBody(bodyStart);
      this.unparsed.push([bodyStart, end]);
      this.warnings.push(`could not parse the body of ${name.value}() (${e.message}); ` +
                         'converted it with renames only');
    }
    this.popScope();
  }

  /** Finds the end of a body we can't parse and puts the cursor past it. */
  skipOpaqueBody(bodyStart) {
    const topLevel = /\n(?=(?:float|int|bool|void|vec[234]|mat[234]|struct|uniform|attribute|varying|const)\s+\w+)/g;
    topLevel.lastIndex = bodyStart + 1;
    const next = topLevel.exec(this.src);
    const limit = next ? next.index : this.src.length;
    const end = this.src.lastIndexOf('}', limit) + 1;
    if (end <= bodyStart) { throw new Error(`could not find the end of the body at offset ${bodyStart}`); }
    while (this.tok.type !== 'eof' && this.tok.start < end) { this.next(); }
    return end;
  }

  parseBlock(ownScope = true) {
    this.expect('{');
    if (ownScope) { this.pushScope(); }
    while (!this.is('}') && this.tok.type !== 'eof') { this.parseStatement(); }
    if (ownScope) { this.popScope(); }
    this.expect('}');
  }

  parseStatement() {
    if (this.is('{')) { return this.parseBlock(); }
    if (this.eat(';')) { return; }
    if (this.is('if')) {
      this.next(); this.expect('('); this.parseExpression(); this.expect(')');
      this.parseStatement();
      if (this.eat('else')) { this.parseStatement(); }
      return;
    }
    if (this.is('for')) {
      this.next(); this.expect('(');
      this.pushScope();
      if (!this.eat(';')) { this.parseSimpleStatement(); }
      if (!this.is(';')) { this.parseExpression(); }
      this.expect(';');
      if (!this.is(')')) { this.parseExpression(); }
      this.expect(')');
      this.parseStatement();
      this.popScope();
      return;
    }
    if (this.is('while')) {
      this.next(); this.expect('('); this.parseExpression(); this.expect(')');
      this.parseStatement();
      return;
    }
    if (this.is('do')) {
      this.next(); this.parseStatement(); this.expect('while');
      this.expect('('); this.parseExpression(); this.expect(')'); this.expect(';');
      return;
    }
    if (this.is('return')) {
      this.next();
      if (!this.is(';')) { this.parseExpression(); }
      this.expect(';');
      return;
    }
    if (this.is('break') || this.is('continue') || this.is('discard')) {
      this.next(); this.expect(';');
      return;
    }
    this.parseSimpleStatement();
  }

  parseSimpleStatement() {
    const save = this.pos;
    if (this.is('const')) { this.next(); }
    const tn = this.typeName();
    if (tn && (this.peek(1).type === 'ident')) {
      this.pos = save;
      return this.parseDeclaration(false);
    }
    this.pos = save;
    this.parseExpression();
    this.expect(';');
  }

  parseDeclaration() {
    if (this.is('const')) { this.next(); }
    while (['attribute', 'uniform', 'varying', 'highp', 'mediump', 'lowp'].includes(this.tok.value)) {
      this.next();
    }
    const tn = this.typeName();
    if (!tn) { throw new Error(`bad declaration at offset ${this.tok.start}`); }
    const typeTok = this.next();
    this.mapTypeToken(typeTok);
    const type = typeFromName(tn) ?? {kind: 'struct', name: tn};
    for (;;) {
      const nameTok = this.next();
      let declType = type;
      if (this.eat('[')) {
        while (!this.is(']')) { this.next(); }
        this.expect(']');
        declType = {kind: 'array', of: type};
      }
      this.declare(nameTok.value, declType);
      if (this.eat('=')) { this.parseAssignment(); }
      if (!this.eat(',')) { break; }
    }
    this.expect(';');
  }

  // ---- expressions. Each parse* returns {type, start, end}.

  parseExpression() {
    let node = this.parseAssignment();
    while (this.is(',')) {
      this.next();
      node = this.parseAssignment();
    }
    return node;
  }

  parseAssignment() {
    const start = this.pos;
    const left = this.parseConditional();
    const op = this.tok.value;
    if (['=', '+=', '-=', '*=', '/=', '%='].includes(op)) {
      const opTok = this.next();
      const right = this.parseAssignment();
      if (op === '*=' && (isMat(left.type) || isMat(right.type))) {
        // GLSL `M *= A` is M = M * A, which transposed is M = A^T * M^T
        const lhs = this.slice(left);
        this.edits.push({
          start: left.start, end: right.end, kind: 'mulAssign',
          left: {start: left.start, end: left.end},
          right: {start: right.start, end: right.end},
          lhsText: lhs,
        });
      }
      void opTok;
      return {type: left.type, start: left.start, end: right.end, pos: start};
    }
    return left;
  }

  parseConditional() {
    const cond = this.parseBinary(0);
    if (this.eat('?')) {
      const a = this.parseExpression();
      this.expect(':');
      const b = this.parseAssignment();
      return {type: a.type ?? b.type, start: cond.start, end: b.end};
    }
    return cond;
  }

  binaryLevels() {
    return [['||'], ['&&'], ['^^'], ['|'], ['^'], ['&'], ['==', '!='],
      ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
  }

  parseBinary(level) {
    const levels = this.binaryLevels();
    if (level >= levels.length) { return this.parseUnary(); }
    let left = this.parseBinary(level + 1);
    while (levels[level].includes(this.tok.value)) {
      const op = this.next().value;
      const right = this.parseBinary(level + 1);
      if (op === '*' && (isMat(left.type) || isMat(right.type))) {
        left = this.matrixMultiply(left, right);
      } else {
        left = {type: this.binaryType(left.type, right.type), start: left.start, end: right.end};
      }
    }
    return left;
  }

  matrixMultiply(left, right) {
    const lm = isMat(left.type);
    const rm = isMat(right.type);
    let type;
    let swap;
    if (lm && rm) {
      // (A*B)^T == B^T * A^T
      type = left.type; swap = true;
    } else if (lm && isVec(right.type)) {
      // M * v  ->  mul(v, M)
      type = right.type; swap = true;
    } else if (rm && isVec(left.type)) {
      // v * M  ->  mul(M, v)
      type = left.type; swap = true;
    } else {
      // matrix * scalar is component wise in both languages, leave it alone
      return {type: lm ? left.type : right.type, start: left.start, end: right.end};
    }
    this.edits.push({
      start: left.start, end: right.end, kind: 'mul', swap,
      left: {start: left.start, end: left.end},
      right: {start: right.start, end: right.end},
    });
    return {type, start: left.start, end: right.end};
  }

  binaryType(a, b) {
    if (isMat(a) || isMat(b)) { return isMat(a) ? a : b; }
    if (isVec(a)) { return a; }
    if (isVec(b)) { return b; }
    return a ?? b ?? T.unknown;
  }

  parseUnary() {
    if (['-', '+', '!', '~', '++', '--'].includes(this.tok.value)) {
      const start = this.tok.start;
      this.next();
      const operand = this.parseUnary();
      return {type: operand.type, start, end: operand.end};
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let node = this.parsePrimary();
    for (;;) {
      if (this.is('[')) {
        this.next();
        this.parseExpression();
        const close = this.expect(']');
        let type = T.unknown;
        // GLSL m[i] is a column, and our matrices are transposed, so HLSL's
        // row indexing lands on the same values with no rewrite
        if (isMat(node.type)) { type = vec('float', node.type.n); }
        else if (isVec(node.type)) { type = T[node.type.base]; }
        else if (node.type?.kind === 'array') { type = node.type.of; }
        node = {type, start: node.start, end: close.end};
        continue;
      }
      if (this.is('.')) {
        this.next();
        const field = this.next();
        node = {type: this.memberType(node.type, field.value), start: node.start, end: field.end};
        continue;
      }
      if (this.is('++') || this.is('--')) {
        const t = this.next();
        node = {type: node.type, start: node.start, end: t.end};
        continue;
      }
      return node;
    }
  }

  memberType(base, field) {
    if (isVec(base) || base?.kind === 'scalar') {
      if (/^[xyzwrgbastpq]+$/.test(field)) {
        return field.length === 1 ? T[base.base ?? 'float'] : vec(base.base ?? 'float', field.length);
      }
    }
    if (base?.kind === 'struct') {
      return this.structFields?.get(base.name)?.get(field) ?? T.unknown;
    }
    return T.unknown;
  }

  parsePrimary() {
    const t = this.tok;
    if (t.type === 'number') {
      this.next();
      return {type: /[.eE]/.test(t.value) ? T.float : T.int, start: t.start, end: t.end};
    }
    if (t.value === '(') {
      this.next();
      const inner = this.parseExpression();
      const close = this.expect(')');
      return {type: inner.type, start: t.start, end: close.end};
    }
    if (t.value === 'true' || t.value === 'false') {
      this.next();
      return {type: T.bool, start: t.start, end: t.end};
    }
    if (t.type === 'ident') {
      this.next();
      if (this.is('(')) { return this.parseCall(t); }
      const type = this.lookup(t.value) ?? T.unknown;
      if (type === T.unknown && !KEYWORDS.has(t.value) && !this.macros.has(t.value)) {
        this.warnings.push(`unknown identifier "${t.value}" at offset ${t.start}`);
      }
      return {type, start: t.start, end: t.end};
    }
    throw new Error(`unexpected "${t.value}" at offset ${t.start}`);
  }

  parseCall(nameTok) {
    const name = nameTok.value;
    this.expect('(');
    const args = [];
    if (!this.is(')')) {
      for (;;) {
        args.push(this.parseAssignment());
        if (!this.eat(',')) { break; }
      }
    }
    const close = this.expect(')');
    const node = {start: nameTok.start, end: close.end};

    const ctor = typeFromName(name);
    if (ctor) {
      // mat4(c0,c1,c2,c3) columns == float4x4(r0,r1,r2,r3) rows of the
      // transpose, and mat4(f0..f15) fills columns == rows of the transpose,
      // so the arguments carry over in order
      this.mapTypeToken(nameTok);
      node.type = ctor;
      return node;
    }
    if (this.renames.has(name)) {
      this.edit(nameTok.start, nameTok.end, this.renames.get(name));
      node.type = this.funcs.get(name) ?? T.unknown;
      return node;
    }
    if (name === 'texture2D' || name === 'texture2DLod') {
      const tex = this.slice(args[0]);
      const uv = this.slice(args[1]);
      const lod = name === 'texture2DLod' ? this.slice(args[2]) : '0.0';
      this.edits.push({
        start: nameTok.start, end: close.end, kind: 'texture',
        tex: {start: args[0].start, end: args[0].end},
        uv: {start: args[1].start, end: args[1].end},
        lod: name === 'texture2DLod' ? {start: args[2].start, end: args[2].end} : null,
        lodText: lod,
      });
      void tex; void uv;
      this.used.texture = true;
      node.type = vec('float', 4);
      return node;
    }
    if (name === 'mod') {
      this.edit(nameTok.start, nameTok.end, 'glslMod');
      this.used.mod = true;
      node.type = args[0]?.type ?? T.unknown;
      return node;
    }
    if (name === 'atan' && args.length === 2) {
      this.edit(nameTok.start, nameTok.end, 'atan2');
      node.type = args[0]?.type ?? T.unknown;
      return node;
    }
    if (FUNC_MAP[name]) {
      this.edit(nameTok.start, nameTok.end, FUNC_MAP[name]);
      node.type = args[0]?.type ?? T.unknown;
      return node;
    }
    if (this.funcs.has(name)) { node.type = this.funcs.get(name); return node; }
    node.type = this.builtinType(name, args);
    return node;
  }

  builtinType(name, args) {
    switch (name) {
      case 'length': case 'dot': case 'distance': case 'determinant': return T.float;
      case 'cross': return vec('float', 3);
      case 'transpose': return args[0]?.type ?? T.unknown;
      case 'lessThan': case 'greaterThan': case 'equal': case 'notEqual':
        return vec('bool', args[0]?.type?.n ?? 2);
      case 'any': case 'all': return T.bool;
      case 'radians': case 'degrees': case 'sin': case 'cos': case 'tan': case 'asin':
      case 'acos': case 'atan': case 'pow': case 'exp': case 'log': case 'exp2':
      case 'log2': case 'sqrt': case 'abs': case 'sign': case 'floor': case 'ceil':
      case 'min': case 'max': case 'clamp': case 'step': case 'smoothstep':
      case 'normalize': case 'reflect': case 'refract': case 'faceforward':
        return args.find(a => isVec(a.type))?.type ?? args[0]?.type ?? T.float;
      default:
        if (!this.funcs.has(name)) {
          this.warnings.push(`unrecognized function "${name}"`);
        }
        return T.unknown;
    }
  }

  slice(node) { return this.src.slice(node.start, node.end); }
}

// ---------------------------------------------------------------- emit

function applyEdits(src, edits, from, to) {
  const inRange = edits
    .filter(e => e.start >= from && e.end <= to)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  // keep only the outermost edits, each renders its own children
  const top = [];
  for (const e of inRange) {
    if (!top.length || e.start >= top.at(-1).end) { top.push(e); }
  }
  let out = '';
  let at = from;
  for (const e of top) {
    out += src.slice(at, e.start);
    out += renderEdit(src, edits, e);
    at = e.end;
  }
  return out + src.slice(at, to);
}

function renderEdit(src, edits, e) {
  const inner = edits.filter(x => x !== e);
  const sub = r => applyEdits(src, inner, r.start, r.end);
  switch (e.kind) {
    case 'text': return e.text;
    case 'mul': {
      const l = sub(e.left);
      const r = sub(e.right);
      return e.swap ? `mul(${r}, ${l})` : `mul(${l}, ${r})`;
    }
    case 'mulAssign': {
      const l = sub(e.left);
      const r = sub(e.right);
      return `${l} = mul(${r}, ${l})`;
    }
    case 'texture': {
      const tex = sub(e.tex);
      const uv = sub(e.uv);
      const lod = e.lod ? sub(e.lod) : e.lodText;
      return `${tex}.SampleLevel(vsaSampler, ${uv}, ${lod})`;
    }
    default: throw new Error(`unknown edit kind ${e.kind}`);
  }
}

// Preprocessor lines and `#if 0` blocks never reach the parser, so they only
// get the plain token level renames. Nothing in them is live code, so a
// matrix multiply hiding in a macro body would go unrewritten; renameOnly()
// reports that rather than letting it through silently.
/** Rewrites `texture2D(a, b)` in text the parser never saw. */
function rewriteTextureCalls(text) {
  for (;;) {
    const m = /\btexture2D(Lod)?\s*\(/.exec(text);
    if (!m) { return text; }
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const argStart = i + 1;
    const commas = [];
    for (; i < text.length; ++i) {
      const c = text[i];
      if (c === '(') { ++depth; }
      else if (c === ')') { if (--depth === 0) { break; } }
      else if (c === ',' && depth === 1) { commas.push(i); }
    }
    if (depth !== 0) { return text; }
    const args = [];
    let at = argStart;
    for (const comma of commas) { args.push(text.slice(at, comma)); at = comma + 1; }
    args.push(text.slice(at, i));
    const lod = m[1] ? args[2] : ' 0.0';
    const replacement = `${args[0].trim()}.SampleLevel(vsaSampler,${args[1]},${lod})`;
    text = text.slice(0, m.index) + replacement + text.slice(i + 1);
  }
}

/**
 * Converts a stretch of text the parser deliberately skipped: preprocessor
 * lines and preprocessor-dead blocks. Only the renames apply here, since
 * there are no types to reason with, so a matrix multiply hiding in a macro
 * body would go unrewritten. That gets reported rather than passed over.
 */
function convertUnparsed(src, edits, renames, ranges) {
  const risky = [];
  for (const [start, end] of ranges) {
    const original = src.slice(start, end);
    let out = '';
    let at = 0;
    for (const t of tokenize(original).filter(t => t.type === 'ident')) {
      const mapped = TYPE_MAP[t.value] || FUNC_MAP[t.value] ||
        (t.value === 'mod' ? 'glslMod' : null) || renames.get(t.value);
      if (mapped) {
        out += original.slice(at, t.start) + mapped;
        at = t.end;
      }
    }
    out = rewriteTextureCalls(out + original.slice(at));
    if (out !== original) {
      edits.push({start, end, kind: 'text', text: out});
    }
    if (/\bmat[234]\b/.test(original) && /\*/.test(original)) {
      risky.push(`possible matrix multiply in a macro or preprocessor-dead block at offset ${start}`);
    }
  }
  return risky;
}

function preprocessorRanges(src, skip = []) {
  return [...src.matchAll(/^[ \t]*#[^\n\\]*(?:\\\n[^\n\\]*)*/gm)]
    .map(m => [m.index, m.index + m[0].length])
    .filter(([a, b]) => !skip.some(([s, e]) => a >= s && b <= e));
}

const HEADER_UNIFORMS = `cbuffer VSAUniforms : register(b0) {
  float2 mouse;
  float2 resolution;
  float4 background;
  float  time;
  float  vertexCount;
  float2 soundRes;
  float  _dontUseDirectly_pointSize;
};`;

const HEADER_TEXTURES = `Texture2D<float4> volume     : register(t0);
Texture2D<float4> sound      : register(t1);
Texture2D<float4> floatSound : register(t2);
Texture2D<float4> touch      : register(t3);
SamplerState      vsaSampler : register(s0);`;

const HEADER_MOD = `// GLSL mod() floors, HLSL fmod() truncates, so they disagree on negatives
float  glslMod(float  x, float  y) { return x - y * floor(x / y); }
float2 glslMod(float2 x, float2 y) { return x - y * floor(x / y); }
float3 glslMod(float3 x, float3 y) { return x - y * floor(x / y); }
float4 glslMod(float4 x, float4 y) { return x - y * floor(x / y); }
float2 glslMod(float2 x, float  y) { return x - y * floor(x / y); }
float3 glslMod(float3 x, float  y) { return x - y * floor(x / y); }
float4 glslMod(float4 x, float  y) { return x - y * floor(x / y); }`;

const HEADER_GLOBALS = `// gl_Position / gl_PointSize / v_color are globals here for the same reason
// they're globals in GLSL: helper functions in these shaders write to them.
static float  vertexId;
static float4 gl_Position;
static float  gl_PointSize = 1.0;
static float4 v_color;`;

const ENTRY = `struct VSOutput {
  float4 position  : SV_Position;
  float4 color     : COLOR0;
  float  pointSize : PSIZE;
};

VSOutput vsMain(uint vertexIndex : SV_VertexID) {
  vertexId = (float)vertexIndex;
  main();

  VSOutput output;
  output.position  = gl_Position;
  output.color     = v_color;
  output.pointSize = gl_PointSize;
  return output;
}`;

/**
 * @param {string} glsl the shader out of art.json
 * @param {{name: string, id: string, username: string}} info
 * @returns {{hlsl: string, warnings: string[], renames: Map<string,string>}}
 */
export function convert(glsl, info = {}) {
  const p = new Parser(glsl);
  p.parseUnit();
  const skip = [...p.inactive, ...p.unparsed];
  p.warnings.push(...convertUnparsed(glsl, p.edits, p.renames, p.unparsed));
  p.warnings.push(...convertUnparsed(glsl, p.edits, p.renames, p.inactive));
  p.warnings.push(...convertUnparsed(glsl, p.edits, p.renames, preprocessorRanges(glsl, skip)));
  const body = applyEdits(glsl, p.edits, 0, glsl.length);
  // dead code and macro bodies get rewritten too, so decide what the header
  // needs from the finished text rather than from what the parser saw
  p.used.texture = /\.SampleLevel\s*\(/.test(body);
  p.used.mod = /\bglslMod\s*\(/.test(body);

  const notes = [];
  if (p.renames.size) {
    notes.push(`// ${[...p.renames].map(([a, b]) => `${a}() -> ${b}()`).join(', ')}, ` +
               `renamed to keep clear of the HLSL intrinsic${p.renames.size > 1 ? 's' : ''} of the same name.`);
  }
  // anything the translator wasn't sure about travels with the file
  for (const w of p.warnings) {
    notes.push(`// CAVEAT: ${w}`);
  }

  const parts = [
    `// ${info.name ?? 'untitled'} by ${info.username ?? 'unknown'}`,
    `// https://www.vertexshaderart.com/art/${info.id ?? ''}`,
    '//',
    '// HLSL (vs_5_0) port of the GLSL ES 1.00 vertex shader in art.json,',
    '// generated by build/gen-hlsl.js.',
    '//',
    '// Matrices hold the transpose of their GLSL counterparts so that column',
    '// constructors and m[i] column indexing carry over unchanged; the',
    "// difference lives in the multiplies, as HLSL's usual row vector",
    '// convention (GLSL `M * v` is `mul(v, M)` here).',
    ...notes,
    '',
    HEADER_UNIFORMS,
    '',
    ...(p.used.texture ? [HEADER_TEXTURES, ''] : []),
    HEADER_GLOBALS,
    '',
    ...(p.used.mod ? [HEADER_MOD, ''] : []),
    '// ---------------------------------------------------------------------',
    '',
    body.trim(),
    '',
    '// ---------------------------------------------------------------------',
    '',
    ENTRY,
    '',
  ];
  return {hlsl: parts.join('\n'), warnings: p.warnings, renames: p.renames};
}
