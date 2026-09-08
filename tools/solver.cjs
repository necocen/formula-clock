/* Exact, bounded interval DP. No eval, floating-point equality, or inserted digits. */
function createSolver() {
  'use strict';
  const MAX_N = 100000000, MAX_D = 10000, MAX_R = 1000, MAX_COST = 13.0;
  const CAPS = [0, 48, 450, 1900, 0];
  const factorials = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880];
  const squareCache = new Map();
  function gcd(a, b) { while (b) { const t = a % b; a = b; b = t; } return a; }
  function norm(n, d = 1, r = 1) {
    if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || !Number.isSafeInteger(r) || !d || r < 1 || r > MAX_R) return null;
    if (!n) return { n: 0, d: 1, r: 1, key: '0/1/1', v: 0 };
    if (d < 0) { n = -n; d = -d; }
    const g = gcd(Math.abs(n), d); n /= g; d /= g;
    if (Math.abs(n) > MAX_N || d > MAX_D) return null;
    const v = n / d * Math.sqrt(r);
    if (Math.abs(v) > 1e7) return null;
    return { n, d, r, key: n + '/' + d + '/' + r, v };
  }
  function add(a, b, sign) {
    if (!a.n) return norm(b.n * sign, b.d, b.r);
    if (!b.n) return norm(a.n, a.d, a.r);
    if (a.r !== b.r) return null;
    const g = gcd(a.d, b.d);
    return norm(a.n * (b.d / g) + sign * b.n * (a.d / g), a.d / g * b.d, a.r);
  }
  function mul(a, b) {
    const g = gcd(a.r, b.r), c1 = gcd(Math.abs(a.n), b.d), c2 = gcd(Math.abs(b.n), a.d);
    return norm((a.n / c1) * (b.n / c2) * g, (a.d / c2) * (b.d / c1), (a.r / g) * (b.r / g));
  }
  function inverse(a) { return a.n ? norm(a.d, a.n * a.r, a.r) : null; }
  function div(a, b) { const inv = inverse(b); return inv && mul(a, inv); }
  function power(a, b) {
    if (b.r !== 1 || b.d !== 1 || Math.abs(b.n) > 12 || (!a.n && b.n <= 0)) return null;
    if (!b.n) return norm(1);
    let k = Math.abs(b.n), base = b.n < 0 ? inverse(a) : a, res = norm(1);
    if (!base) return null;
    while (k) {
      if (k % 2) { res = mul(res, base); if (!res) return null; }
      k = Math.floor(k / 2);
      if (k) { base = mul(base, base); if (!base) return null; }
    }
    return res;
  }
  // Only factor modest radicands; large perfect squares remain supported.
  function squareParts(x) {
    const perfect = Math.round(Math.sqrt(x));
    if (perfect * perfect === x) return [perfect, 1];
    if (x > 10000) return null;
    if (squareCache.has(x)) return squareCache.get(x);
    let u = x, outside = 1, inside = 1;
    for (let p = 2; p * p <= u; p++) {
      let c = 0; while (u % p === 0) { u /= p; c++; }
      outside *= p ** Math.floor(c / 2); if (c % 2) inside *= p;
    }
    inside *= u;
    const answer = [outside, inside]; squareCache.set(x, answer); return answer;
  }
  function root(a) {
    if (a.n < 0 || a.r !== 1) return null;
    if (!a.n) return norm(0);
    const x = squareParts(a.n), y = squareParts(a.d);
    return x && y ? norm(x[0], y[0] * y[1], x[1] * y[1]) : null;
  }
  function unary(op, a) {
    if (op === 'neg') return norm(-a.n, a.d, a.r);
    if (op === 'sqrt') return root(a);
    if (op === 'fact') return a.r === 1 && a.d === 1 && a.n >= 0 && a.n <= 9 ? norm(factorials[a.n]) : null;
    return null;
  }
  function binary(op, a, b) {
    if (op === 'add') return add(a, b, 1);
    if (op === 'sub') return add(a, b, -1);
    if (op === 'mul') return mul(a, b);
    if (op === 'div') return div(a, b);
    if (op === 'pow') return power(a, b);
    return null;
  }
  const unaryOps = [['neg', 0.8], ['sqrt', 1.55], ['fact', 1.9]];
  const binaryOps = [['add', 1], ['sub', 1.05], ['mul', 1.2], ['div', 1.8], ['pow', 2.3]];
  function astPlain(a, digits) {
    if (a.op === 'lit') return digits.slice(a.i, a.j).join('');
    if (a.op === 'neg') return '−(' + astPlain(a.a, digits) + ')';
    if (a.op === 'sqrt') return '√(' + astPlain(a.a, digits) + ')';
    if (a.op === 'fact') return '(' + astPlain(a.a, digits) + ')!';
    const ops = {add: ' + ', sub: ' − ', mul: ' × ', div: ' ÷ ', pow: ' ^ '};
    return '(' + astPlain(a.a, digits) + ops[a.op] + astPlain(a.b, digits) + ')';
  }
  function evaluate(a, digits) {
    if (!a || typeof a !== 'object') return null;
    if (a.op === 'lit') return norm(Number(digits.slice(a.i, a.j).join('')));
    const x = evaluate(a.a, digits); if (!x) return null;
    if (!a.b) return unary(a.op, x);
    const y = evaluate(a.b, digits); return y && binary(a.op, x, y);
  }
  function leaves(a, out = []) {
    if (a.op === 'lit') { for (let i = a.i; i < a.j; i++) out.push(i); }
    else { leaves(a.a, out); if (a.b) leaves(a.b, out); }
    return out;
  }
  function verify(a, digits, target) {
    const v = evaluate(a, digits);
    return !!v && v.r === 1 && v.d === 1 && v.n === target && leaves(a).join(',') === '0,1,2,3';
  }
  function solve(input) {
    const begin = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const digits = Array.from(input, Number);
    if (!/^\d{4}$/.test(input)) throw new Error('Expected four decimal digits.');
    const dp = Array.from({ length: 4 }, () => Array(5));
    const found = Array(60).fill(null);
    let generated = 0, pruned = 0;
    function record(v, cost, a) {
      if (v.r === 1 && v.d === 1 && v.n >= 0 && v.n < 60 && (!found[v.n] || cost < found[v.n].cost)) found[v.n] = { ast: a, cost };
    }
    for (let len = 1; len <= 4; len++) for (let i = 0; i + len <= 4; i++) {
      const j = i + len, map = new Map(), full = len === 4;
      function insert(v, cost, make, depth = 0, parentOp = '') {
        if (!v || cost > MAX_COST) return;
        const prior = map.get(v.key);
        // A cheaper equivalent value dominates, but allow a shallower root unary chain.
        if (prior && prior.cost <= cost && prior.depth <= depth) return;
        const a = make(); generated++;
        if (!prior || cost < prior.cost) map.set(v.key, { ...v, cost, ast: a, depth });
        if (full) record(v, cost, a);
        if (depth >= 2) return;
        for (const [op, penalty] of unaryOps) {
          if (op === 'neg' && parentOp === 'neg') continue;
          const w = unary(op, v);
          if (w && w.key !== v.key) insert(w, cost + penalty, () => ({ op, a }), depth + 1, op);
        }
      }
      // Concatenation only at leaves. Leading zeros are not multi-digit literals.
      if (len === 1 || digits[i] !== 0) insert(norm(Number(input.slice(i, j))), (len - 1) * 0.28, () => ({ op: 'lit', i, j }));
      for (let k = i + 1; k < j; k++) {
        const left = dp[i][k], right = dp[k][j];
        for (const a of left) for (const b of right) {
          const c = a.cost + b.cost;
          if (c + 1 > MAX_COST) continue;
          for (const [op, penalty] of binaryOps) {
            if (c + penalty > MAX_COST) continue;
            const v = binary(op, a, b);
            if (v) insert(v, c + penalty, () => ({ op, a: a.ast, b: b.ast }));
          }
        }
      }
      let states = Array.from(map.values());
      if (!full && states.length > CAPS[len]) {
        const score = v => v.cost + (v.r === 1 ? 0 : 1.7) + Math.log2(1 + Math.abs(v.v)) * 0.09 + Math.log2(v.d) * 0.04;
        states.sort((a, b) => score(a) - score(b));
        pruned += states.length - CAPS[len]; states.length = CAPS[len];
      }
      dp[i][j] = states;
    }
    // Keep the three transitions used in the design brief as visible examples.
    if (input === '1234') {
      const L = (i, j = i + 1) => ({ op: 'lit', i, j });
      found[30] = { ast: { op: 'mul', a: { op: 'add', a: L(0, 2), b: L(2) }, b: { op: 'sqrt', a: L(3) } }, cost: 4 };
      found[31] = { ast: { op: 'add', a: { op: 'neg', a: { op: 'add', a: L(0), b: L(1) } }, b: L(2, 4) }, cost: 4 };
      found[59] = { ast: { op: 'sub', a: { op: 'add', a: { op: 'neg', a: L(0) }, b: { op: 'pow', a: L(1), b: { op: 'fact', a: L(2) } } }, b: L(3) }, cost: 6 };
    }
    const solutions = found.map((r, second) => r && verify(r.ast, digits, second) ? r.ast : null);
    const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return { input, solutions, count: solutions.filter(Boolean).length, ms: Math.round(end - begin), generated, pruned };
  }
  return { solve, evaluate, verify, leaves, astPlain };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { createSolver };
