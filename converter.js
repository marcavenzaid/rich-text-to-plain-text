/*
 * Rich text -> plain text converter.
 *
 * Turns formatted content (HTML from the clipboard, MathML, KaTeX/MathJax,
 * Word equations (OMML), LaTeX, Unicode super/subscripts) into readable
 * plain text, e.g. 2<sup>31</sup> -> 2^31, a fraction -> (a+b)/c, a root -> sqrt(x).
 *
 * Works in any modern browser (relies on DOMParser). Exposes window.RichToPlain.
 */
(function (global) {
  'use strict';

  const BLOCK = '\u0001'; // "start a new line here"
  const PARA = '\u0002';  // "leave a blank line here"
  const NBSP = ' ';  // protected space (survives whitespace collapsing)

  const DEFAULTS = {
    ascii: false,          // replace symbols with ASCII (× -> *, ≤ -> <=, π -> pi)
    unicodeScripts: true,  // x² -> x^2, H₂O -> H_2O
    latexInText: true,     // $x^2$, \(..\), \[..\], $$..$$ -> x^2
    keepLinks: false,      // "text (https://...)"
  };

  // ------------------------------------------------------------------
  // Symbol tables
  // ------------------------------------------------------------------

  const GREEK = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ',
    eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν',
    xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς',
    tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ',
    Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  };

  // LaTeX command -> [text, kind]
  const SYM = {
    // relations
    le: ['≤', 'rel'], leq: ['≤', 'rel'], leqslant: ['≤', 'rel'], ge: ['≥', 'rel'], geq: ['≥', 'rel'],
    geqslant: ['≥', 'rel'], ne: ['≠', 'rel'], neq: ['≠', 'rel'], approx: ['≈', 'rel'],
    equiv: ['≡', 'rel'], sim: ['∼', 'rel'], simeq: ['≃', 'rel'], cong: ['≅', 'rel'],
    propto: ['∝', 'rel'], ll: ['≪', 'rel'], gg: ['≫', 'rel'], prec: ['≺', 'rel'], succ: ['≻', 'rel'],
    to: ['→', 'rel'], rightarrow: ['→', 'rel'], gets: ['←', 'rel'], leftarrow: ['←', 'rel'],
    leftrightarrow: ['↔', 'rel'], Rightarrow: ['⇒', 'rel'], Leftarrow: ['⇐', 'rel'],
    Leftrightarrow: ['⇔', 'rel'], implies: ['⟹', 'rel'], impliedby: ['⟸', 'rel'], iff: ['⟺', 'rel'],
    longrightarrow: ['⟶', 'rel'], Longrightarrow: ['⟹', 'rel'], longleftarrow: ['⟵', 'rel'],
    Longleftarrow: ['⟸', 'rel'], Longleftrightarrow: ['⟺', 'rel'], mapsto: ['↦', 'rel'],
    longmapsto: ['⟼', 'rel'], uparrow: ['↑', 'rel'], downarrow: ['↓', 'rel'],
    in: ['∈', 'rel'], notin: ['∉', 'rel'], ni: ['∋', 'rel'], subset: ['⊂', 'rel'],
    supset: ['⊃', 'rel'], subseteq: ['⊆', 'rel'], supseteq: ['⊇', 'rel'], subsetneq: ['⊊', 'rel'],
    supsetneq: ['⊋', 'rel'], mid: ['∣', 'rel'], nmid: ['∤', 'rel'], parallel: ['∥', 'rel'],
    perp: ['⊥', 'rel'], models: ['⊨', 'rel'], vdash: ['⊢', 'rel'], coloneqq: ['≔', 'rel'],
    doteq: ['≐', 'rel'], asymp: ['≍', 'rel'],
    // binary operators
    pm: ['±', 'bin'], mp: ['∓', 'bin'], times: ['×', 'bin'], div: ['÷', 'bin'], cdot: ['·', 'bin'],
    ast: ['*', 'bin'], star: ['⋆', 'bin'], circ: ['∘', 'bin'], bullet: ['∙', 'bin'],
    cup: ['∪', 'bin'], cap: ['∩', 'bin'], setminus: ['∖', 'bin'], wedge: ['∧', 'bin'],
    land: ['∧', 'bin'], vee: ['∨', 'bin'], lor: ['∨', 'bin'], oplus: ['⊕', 'bin'],
    ominus: ['⊖', 'bin'], otimes: ['⊗', 'bin'], odot: ['⊙', 'bin'],
    // ordinary symbols
    infty: ['∞', 'ord'], partial: ['∂', 'ord'], nabla: ['∇', 'ord'], forall: ['∀', 'ord'],
    exists: ['∃', 'ord'], nexists: ['∄', 'ord'], emptyset: ['∅', 'ord'], varnothing: ['∅', 'ord'],
    neg: ['¬', 'ord'], lnot: ['¬', 'ord'], angle: ['∠', 'ord'], triangle: ['△', 'ord'],
    hbar: ['ℏ', 'ord'], ell: ['ℓ', 'ord'], Re: ['ℜ', 'ord'], Im: ['ℑ', 'ord'], aleph: ['ℵ', 'ord'],
    prime: ['′', 'ord'], degree: ['°', 'ord'], cdots: ['⋯', 'ord'], ldots: ['…', 'ord'],
    dots: ['…', 'ord'], dotsc: ['…', 'ord'], dotsb: ['⋯', 'ord'], vdots: ['⋮', 'ord'],
    ddots: ['⋱', 'ord'], top: ['⊤', 'ord'], bot: ['⊥', 'ord'], checkmark: ['✓', 'ord'],
    dagger: ['†', 'ord'], surd: ['√', 'ord'], therefore: ['∴', 'ord'], because: ['∵', 'ord'],
    // delimiters
    langle: ['⟨', 'open'], rangle: ['⟩', 'close'], lfloor: ['⌊', 'open'], rfloor: ['⌋', 'close'],
    lceil: ['⌈', 'open'], rceil: ['⌉', 'close'], lbrace: ['{', 'open'], rbrace: ['}', 'close'],
    '{': ['{', 'open'], '}': ['}', 'close'], lvert: ['|', 'open'], rvert: ['|', 'close'],
    lVert: ['‖', 'open'], rVert: ['‖', 'close'], vert: ['|', 'ord'], Vert: ['‖', 'ord'],
    '|': ['‖', 'ord'], lbrack: ['[', 'open'], rbrack: [']', 'close'], backslash: ['\\', 'ord'],
    // escaped characters
    '%': ['%', 'ord'], '$': ['$', 'ord'], '&': ['&', 'ord'], '#': ['#', 'ord'], '_': ['_', 'ord'],
    // spacing
    ',': [' ', 'space'], ':': [' ', 'space'], ';': [' ', 'space'], ' ': [' ', 'space'],
    '>': [' ', 'space'], quad: [' ', 'space'], qquad: [' ', 'space'], enspace: [' ', 'space'],
    thinspace: [' ', 'space'], medspace: [' ', 'space'], thickspace: [' ', 'space'],
    '!': ['', 'skip'], negthinspace: ['', 'skip'], negmedspace: ['', 'skip'],
    // ignored
    displaystyle: ['', 'skip'], textstyle: ['', 'skip'], scriptstyle: ['', 'skip'],
    scriptscriptstyle: ['', 'skip'], limits: ['', 'skip'], nolimits: ['', 'skip'],
    nonumber: ['', 'skip'], notag: ['', 'skip'], hline: ['', 'skip'], centering: ['', 'skip'],
    mathstrut: ['', 'skip'], strut: ['', 'skip'], allowbreak: ['', 'skip'], nobreak: ['', 'skip'],
    relax: ['', 'skip'], displaybreak: ['', 'skip'], protect: ['', 'skip'],
  };

  const BIGOPS = {
    sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮',
    bigcup: '⋃', bigcap: '⋂', bigvee: '⋁', bigwedge: '⋀', bigoplus: '⨁', bigotimes: '⨂',
    bigodot: '⨀', biguplus: '⨄',
  };
  const LIMOPS = {
    lim: 'lim', limsup: 'lim sup', liminf: 'lim inf', max: 'max', min: 'min', sup: 'sup',
    inf: 'inf', det: 'det', gcd: 'gcd', Pr: 'Pr', argmax: 'argmax', argmin: 'argmin',
  };
  const FUNCS = new Set([
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh',
    'tanh', 'coth', 'log', 'ln', 'lg', 'exp', 'arg', 'deg', 'dim', 'hom', 'ker', 'sgn',
  ]);

  const REL_CH = new Set('=<>≤≥≠≈≡∼≃≅∝≪≫≺≻→←↔⇒⇐⇔⟹⟸⟺⟶⟵↦⟼∈∉∋⊂⊃⊆⊇⊊⊋∣∤∥⊥⊨⊢≔≐≍≮≯≰≱⊄⊈≢≁≉∦');
  const BIN_CH = new Set('+-−±∓×÷·⋅*∗⋆∘∙∪∩∖∧∨⊕⊖⊗⊙');
  const OPEN_CH = new Set('([{⟨⌊⌈');
  const CLOSE_CH = new Set(')]}⟩⌋⌉');
  const PUNCT_CH = new Set(',;:');
  const BIGOP_CH = new Set('∑∏∐∫∬∭∮⋃⋂⋁⋀⨁⨂⨀⨄');

  const DOUBLE_STRUCK = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', H: 'ℍ' };

  // accent name -> combining character (used for single-letter bases, e.g. x̄)
  const COMBINING = {
    bar: '̄', overline: '̅', hat: '̂', widehat: '̂', tilde: '̃',
    widetilde: '̃', dot: '̇', ddot: '̈', check: '̌', breve: '̆',
    acute: '́', grave: '̀', mathring: '̊', vec: '⃗',
  };
  const ACCENT_NAME = {
    overline: 'bar', widehat: 'hat', widetilde: 'tilde', overrightarrow: 'vec',
    overleftarrow: 'vec', overleftrightarrow: 'vec', widecheck: 'check',
  };
  // accent glyph as it appears in MathML <mover> / Word <m:acc> -> accent name
  const ACCENT_CHAR = {
    '¯': 'bar', '‾': 'bar', 'ˉ': 'bar', '̄': 'bar', '̅': 'overline', '^': 'hat',
    'ˆ': 'hat', '̂': 'hat', '~': 'tilde', '˜': 'tilde', '̃': 'tilde', '→': 'vec',
    '⃗': 'vec', '⃗': 'vec', '˙': 'dot', '̇': 'dot', '¨': 'ddot', '̈': 'ddot',
    'ˇ': 'check', '̌': 'check', '˘': 'breve', '̆': 'breve', '´': 'acute',
    '́': 'acute', '`': 'grave', '̀': 'grave', '˚': 'mathring', '̊': 'mathring',
  };
  const NEGATED = {
    '=': '≠', '∈': '∉', '<': '≮', '>': '≯', '≤': '≰', '≥': '≱', '⊂': '⊄', '⊆': '⊈',
    '≡': '≢', '∼': '≁', '≈': '≉', '∣': '∤', '∥': '∦',
  };

  const SUP_CHARS = {
    '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8',
    '⁹': '9', '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')', 'ⁿ': 'n', 'ⁱ': 'i',
  };
  const SUB_CHARS = {
    '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8',
    '₉': '9', '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')', 'ₐ': 'a', 'ₑ': 'e', 'ₒ': 'o',
    'ₓ': 'x', 'ₕ': 'h', 'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm', 'ₙ': 'n', 'ₚ': 'p', 'ₛ': 's', 'ₜ': 't',
    'ᵢ': 'i', 'ⱼ': 'j',
  };
  const SUP_RE = new RegExp('[' + Object.keys(SUP_CHARS).join('') + ']+', 'g');
  const SUB_RE = new RegExp('[' + Object.keys(SUB_CHARS).join('') + ']+', 'g');

  // ASCII mode. type: 'w' = word that acts like a variable (2πr -> 2*pi*r),
  // 'op' = word operator that needs spaces (a ∈ B -> a in B), 's' = plain substitution.
  const ASCII = {
    '×': ['*', 's'], '·': ['*', 's'], '⋅': ['*', 's'], '∗': ['*', 's'], '∙': ['*', 's'],
    '÷': ['/', 's'], '−': ['-', 's'], '±': ['+/-', 's'], '∓': ['-/+', 's'], '≤': ['<=', 's'],
    '≥': ['>=', 's'], '≠': ['!=', 's'], '≈': ['~=', 's'], '≃': ['~=', 's'], '≅': ['~=', 's'],
    '≡': ['==', 's'], '∼': ['~', 's'], '≪': ['<<', 's'], '≫': ['>>', 's'], '→': ['->', 's'],
    '⟶': ['->', 's'], '←': ['<-', 's'], '⟵': ['<-', 's'], '↔': ['<->', 's'], '⇒': ['=>', 's'],
    '⟹': ['=>', 's'], '⇐': ['<=', 's'], '⟸': ['<=', 's'], '⇔': ['<=>', 's'], '⟺': ['<=>', 's'],
    '↦': ['|->', 's'], '⟼': ['|->', 's'], '′': ["'", 's'], '″': ["''", 's'], '…': ['...', 's'],
    '⋯': ['...', 's'], '⋮': ['...', 's'], '⋱': ['...', 's'], '⟨': ['<', 's'], '⟩': ['>', 's'],
    '‖': ['||', 's'], '∣': ['|', 's'], '⌊': ['floor(', 's'], '⌋': [')', 's'],
    '⌈': ['ceil(', 's'], '⌉': [')', 's'], '½': ['1/2', 's'], '⅓': ['1/3', 's'], '⅔': ['2/3', 's'],
    '¼': ['1/4', 's'], '¾': ['3/4', 's'], '⅛': ['1/8', 's'], '°': [' deg', 's'],
    '∂': ['d', 's'], 'ℝ': ['R', 's'], 'ℕ': ['N', 's'], 'ℤ': ['Z', 's'], 'ℚ': ['Q', 's'],
    'ℂ': ['C', 's'], 'ℓ': ['l', 's'], '√': ['sqrt', 's'], '∛': ['cbrt', 's'],
    '∞': ['inf', 'w'], 'ℏ': ['hbar', 'w'], '∇': ['nabla', 'w'], '∅': ['{}', 's'],
    '∑': ['sum', 'w'], '∏': ['prod', 'w'], '∫': ['integral', 'w'], '∬': ['double integral', 'w'],
    '∮': ['contour integral', 'w'], '∝': ['proportional to', 'op'], '∈': ['in', 'op'],
    '∉': ['not in', 'op'], '∋': ['contains', 'op'], '⊂': ['subset of', 'op'],
    '⊆': ['subset of', 'op'], '⊃': ['superset of', 'op'], '⊇': ['superset of', 'op'],
    '∪': ['union', 'op'], '∩': ['intersect', 'op'], '∖': ['minus', 'op'], '∧': ['and', 'op'],
    '∨': ['or', 'op'], '¬': ['not ', 's'], '∀': ['for all', 'op'], '∃': ['exists', 'op'],
    '∠': ['angle', 'w'], '⊥': ['perp', 'op'], '∥': ['parallel', 'op'], '⊕': ['xor', 'op'],
    '⊗': ['tensor', 'op'], '∘': ['o', 'op'], '∴': ['therefore', 'op'], '∵': ['because', 'op'],
    '△': ['triangle', 'w'], '™': ['(TM)', 's'], '©': ['(c)', 's'], '®': ['(R)', 's'],
  };
  for (const [name, ch] of Object.entries(GREEK)) if (!ASCII[ch]) ASCII[ch] = [name, 'w'];
  ASCII['ε'] = ['epsilon', 'w'];
  ASCII['φ'] = ['phi', 'w'];

  // ------------------------------------------------------------------
  // Shared helpers for math: grouping and joining "items"
  // An item is { s: text, k: kind } where kind is one of
  // ord | rel | bin | open | close | punct | frac | func | bigop | apply | space | text | wordop
  // ------------------------------------------------------------------

  const OPEN_FOR = { ')': '(', ']': '[', '}': '{', '⟩': '⟨', '⌋': '⌊', '⌉': '⌈' };

  // does the whole string sit inside one matching pair of brackets?
  function isWrapped(s) {
    const first = s[0];
    if (!'([{⟨⌊⌈'.includes(first) || !s) return false;
    const stack = [];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if ('([{⟨⌊⌈'.includes(c)) stack.push(c);
      else if (OPEN_FOR[c]) {
        if (stack.pop() !== OPEN_FOR[c]) return false;
        if (stack.length === 0 && i !== s.length - 1) return false;
      }
    }
    return stack.length === 0 && OPEN_FOR[s[s.length - 1]] !== undefined;
  }

  function isCall(s) {
    const m = /^[\p{L}]+(\(.*\))$/u.exec(s);
    return !!m && isWrapped(m[1]);
  }

  // a single number or a single letter (2a and iπ are products, so they are not)
  const ATOM_RE = /^-?(\p{N}+([.,]\p{N}+)?|\p{L}['′]*)$/u;
  const BASE_RE = /^(\p{N}+([.,]\p{N}+)?|\p{L}['′]*)(_(\p{N}+|\p{L}|\(.*\)))?['′]*$/u;

  // safe to use without parentheses as an exponent / subscript / numerator?
  function isAtomic(s) {
    if (!s) return true;
    if ([...s].length === 1) return true;
    return ATOM_RE.test(s) || isWrapped(s) || isCall(s);
  }

  // safe to use without parentheses as the base of a power?
  function isAtomicBase(s) {
    if (!s) return true;
    if ([...s].length === 1) return true;
    return BASE_RE.test(s) || isWrapped(s) || isCall(s);
  }

  const grp = s => (isAtomic(s) ? s : '(' + s + ')');
  const grpBase = s => (isAtomicBase(s) ? s : '(' + s + ')');

  function attach(base, sub, sup) {
    let s = base;
    if (sub) s += '_' + grp(sub);
    if (sup) {
      if (/^['′″]+$/.test(sup)) s += sup;
      else if (sup === '∘' || sup === '°') s += '°';
      else s += '^' + grp(sup);
    }
    return s;
  }

  // d/dx, dy/dx, ∂^2f/∂x^2 read fine without parentheses
  const DIFF_RE = /^[d∂](\^\d+)?\p{L}?(\^\d+)?$/u;

  function fracStr(num, den) {
    if (DIFF_RE.test(num) && DIFF_RE.test(den)) return num + '/' + den;
    return grp(num) + '/' + grp(den);
  }

  function rootStr(body, index) {
    if (!index || index === '2') return 'sqrt(' + body + ')';
    return grpBase(body) + '^(1/' + index + ')';
  }

  function accentStr(name, base) {
    if (name === 'underline' || name === 'utilde') return base;
    const comb = COMBINING[name];
    if (comb && [...base].length === 1) return base + comb;
    return (ACCENT_NAME[name] || name) + '(' + base + ')';
  }

  function opKind(t) {
    if ([...t].length === 1) {
      if (REL_CH.has(t)) return 'rel';
      if (BIN_CH.has(t)) return 'bin';
      if (OPEN_CH.has(t)) return 'open';
      if (CLOSE_CH.has(t)) return 'close';
      if (PUNCT_CH.has(t)) return 'punct';
      if (BIGOP_CH.has(t)) return 'bigop';
      return 'ord';
    }
    if (/^[A-Za-z]+$/.test(t)) {
      if (LIMOPS[t]) return 'bigop';
      if (FUNCS.has(t)) return 'func';
      if (t === 'mod') return 'wordop';
      return 'ord';
    }
    if (/^(:=|!=|<=|>=|==|=>|->|<-)$/.test(t)) return 'rel';
    return 'ord';
  }

  const startsOpen = it => it && it.k !== 'frac' && isWrapped(it.s);
  const LEFT_OK = new Set(['rel', 'bin', 'open', 'punct', 'space', 'bigop', 'apply', 'wordop', 'text']);
  const RIGHT_OK = new Set(['rel', 'bin', 'close', 'punct', 'space', 'wordop', 'text']);
  const NO_SPACE_BEFORE = new Set(['close', 'punct', 'rel', 'bin', 'wordop']);

  // Join a row of items into text. depth 0 = top level (gets spaces around = + - etc.)
  function joinItems(list, depth) {
    const items = list.filter(it => it && it.k !== 'skip' && (it.s !== '' || it.k === 'apply'));
    let out = '';
    for (let i = 0; i < items.length; i++) {
      const it = items[i], prev = items[i - 1], next = items[i + 1];
      let s = it.s;
      switch (it.k) {
        case 'space':
          out += ' ';
          continue;
        case 'apply':
          if (next && !startsOpen(next)) out += ' ';
          continue;
        case 'rel':
          if (depth === 0) s = ' ' + s + ' ';
          break;
        case 'wordop':
          s = ' ' + s + ' ';
          break;
        case 'bin': {
          const unary = !prev || ['rel', 'bin', 'open', 'punct', 'bigop', 'apply', 'wordop'].includes(prev.k);
          if (!unary && depth === 0) s = ' ' + s + ' ';
          break;
        }
        case 'punct':
          if (depth === 0) s += ' ';
          break;
        case 'frac':
          if ((prev && !LEFT_OK.has(prev.k)) || (next && !RIGHT_OK.has(next.k))) s = '(' + s + ')';
          break;
        case 'func':
          if (next && next.k !== 'apply' && !startsOpen(next) && !NO_SPACE_BEFORE.has(next.k)) s += ' ';
          break;
        case 'bigop':
          if (next && !startsOpen(next) && !NO_SPACE_BEFORE.has(next.k)) s += ' ';
          break;
      }
      out += s;
    }
    return out.replace(/ {2,}/g, ' ').replace(/^ +| +$/gm, '');
  }

  function mathFinal(s) {
    return s
      .replace(/[⁡⁢⁣​]/g, '')
      .replace(/⁤/g, '+')
      .replace(/−/g, '-')
      .replace(/′/g, "'")
      .replace(/″/g, "''")
      .replace(/ /g, ' ')
      .replace(/ {2,}/g, ' ')
      .replace(/^ +| +$/gm, '')
      .trim();
  }

  // ------------------------------------------------------------------
  // LaTeX -> text
  // ------------------------------------------------------------------

  class LatexParser {
    constructor(src) {
      this.s = src;
      this.i = 0;
    }

    skipWs() {
      while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
    }

    next() {
      this.skipWs();
      const s = this.s;
      if (this.i >= s.length) return { t: 'eof' };
      const c = s[this.i];
      if (c === '\\') {
        const m = /^[a-zA-Z]+/.exec(s.slice(this.i + 1, this.i + 40));
        if (m) {
          this.i += 1 + m[0].length;
          return { t: 'cmd', v: m[0] };
        }
        if (this.i + 1 < s.length) {
          this.i += 2;
          return { t: 'cmd', v: s[this.i - 1] };
        }
        this.i++;
        return { t: 'char', v: '\\' };
      }
      const ch = String.fromCodePoint(s.codePointAt(this.i));
      this.i += ch.length;
      return { t: 'char', v: ch };
    }

    peek() {
      const save = this.i;
      const t = this.next();
      this.i = save;
      return t;
    }

    expect(ch) {
      this.skipWs();
      if (this.s[this.i] === ch) this.i++;
    }

    // raw text of the next {...} group (or the next single token)
    readRaw() {
      this.skipWs();
      if (this.s[this.i] !== '{') {
        const t = this.next();
        return t.t === 'eof' ? '' : t.t === 'cmd' ? '\\' + t.v : t.v;
      }
      let depth = 0;
      const start = this.i + 1;
      for (; this.i < this.s.length; this.i++) {
        const c = this.s[this.i];
        if (c === '\\') { this.i++; continue; }
        if (c === '{') depth++;
        else if (c === '}' && --depth === 0) {
          this.i++;
          return this.s.slice(start, this.i - 1);
        }
      }
      return this.s.slice(start);
    }

    optArg(depth) {
      this.skipWs();
      if (this.s[this.i] !== '[') return null;
      this.i++;
      const items = this.parseRow(depth, ']');
      this.expect(']');
      return joinItems(items, depth);
    }

    parseArgItem(depth) {
      this.skipWs();
      if (this.s[this.i] === '{') {
        this.i++;
        const items = this.parseRow(depth, '}');
        this.expect('}');
        return items.length === 1 ? items[0] : { s: joinItems(items, depth), k: 'ord' };
      }
      const tok = this.next();
      if (tok.t === 'eof') return { s: '', k: 'ord' };
      const atom = this.atom(tok, depth);
      if (!atom) return { s: '', k: 'ord' };
      if (Array.isArray(atom)) return { s: joinItems(atom, depth), k: 'ord' };
      return atom;
    }

    parseArg(depth) {
      return this.parseArgItem(depth).s;
    }

    parseRow(depth, stopChar, stopCmds) {
      const items = [];
      for (;;) {
        const tok = this.peek();
        if (tok.t === 'eof') break;
        if (tok.t === 'char' && tok.v === stopChar) break;
        if (tok.t === 'cmd' && stopCmds && stopCmds.includes(tok.v)) break;
        let atom;
        if (tok.t === 'char' && (tok.v === '^' || tok.v === '_' || tok.v === "'")) {
          atom = items.pop() || { s: '', k: 'ord' };
        } else {
          this.next();
          if (tok.t === 'char' && (tok.v === '}' || tok.v === '&')) {
            if (tok.v === '&') items.push({ s: ' ', k: 'space' });
            continue;
          }
          atom = this.atom(tok, depth);
        }
        if (!atom) continue;
        if (Array.isArray(atom)) {
          items.push(...atom);
          continue;
        }
        items.push(this.scripts(atom, depth));
      }
      return items;
    }

    scripts(atom, depth) {
      let sub = null, sup = null, primes = '';
      for (;;) {
        this.skipWs();
        const c = this.s[this.i];
        if (c === '^' && sup === null) { this.i++; sup = this.parseArg(depth + 1); }
        else if (c === '_' && sub === null) { this.i++; sub = this.parseArg(depth + 1); }
        else if (c === "'") { this.i++; primes += "'"; }
        else break;
      }
      if (sub === null && sup === null && !primes) return atom;
      const big = atom.k === 'bigop' || atom.k === 'func';
      const base = (big ? atom.s : grpBase(atom.s)) + primes;
      return { s: attach(base, sub, sup), k: big ? atom.k : 'ord' };
    }

    delim() {
      const t = this.next();
      if (t.t === 'eof') return '';
      if (t.t === 'char') return t.v === '.' ? '' : t.v;
      if (SYM[t.v]) return SYM[t.v][0].trim();
      return '';
    }

    textMode(raw) {
      return raw
        .replace(/\$([^$]+)\$/g, (m, x) => latexToText(x))
        .replace(/\\[a-zA-Z]+\s*\{([^{}]*)\}/g, '$1')
        .replace(/\\([{}%$&#_ ])/g, '$1')
        .replace(/~/g, ' ');
    }

    atom(tok, depth) {
      if (tok.t === 'char') {
        const c = tok.v;
        if (c === '{') {
          const items = this.parseRow(depth, '}');
          this.expect('}');
          if (items.length === 1) return items[0];
          return { s: joinItems(items, depth), k: 'ord' };
        }
        if (c === '~') return { s: ' ', k: 'space' };
        return { s: c, k: opKind(c) };
      }

      const v = tok.v;
      if (GREEK[v]) return { s: GREEK[v], k: 'ord' };
      if (BIGOPS[v]) return { s: BIGOPS[v], k: 'bigop' };
      if (LIMOPS[v]) return { s: LIMOPS[v], k: 'bigop' };
      if (FUNCS.has(v)) return { s: v, k: 'func' };
      if (SYM[v]) {
        const [s, k] = SYM[v];
        return k === 'skip' ? null : { s, k };
      }

      switch (v) {
        case 'frac': case 'dfrac': case 'tfrac': case 'cfrac': {
          const a = this.parseArg(depth + 1), b = this.parseArg(depth + 1);
          return { s: fracStr(a, b), k: 'frac' };
        }
        case 'binom': case 'dbinom': case 'tbinom': {
          const a = this.parseArg(depth + 1), b = this.parseArg(depth + 1);
          return { s: 'C(' + a + ', ' + b + ')', k: 'ord' };
        }
        case 'sqrt': {
          const idx = this.optArg(depth + 1);
          return { s: rootStr(this.parseArg(depth), idx), k: 'ord' };
        }
        case 'left': {
          const open = this.delim();
          const items = this.parseRow(depth, null, ['right']);
          let close = '';
          if (this.peek().t === 'cmd') { this.next(); close = this.delim(); }
          return { s: open + joinItems(items, depth) + close, k: 'ord' };
        }
        case 'right':
          this.delim();
          return null;
        case 'middle':
          return { s: this.delim(), k: 'ord' };
        case 'big': case 'Big': case 'bigg': case 'Bigg': case 'bigm': case 'Bigm':
        case 'bigl': case 'Bigl': case 'biggl': case 'Biggl':
        case 'bigr': case 'Bigr': case 'biggr': case 'Biggr': {
          const d = this.delim();
          const k = /l$/.test(v) ? 'open' : /r$/.test(v) ? 'close' : opKind(d);
          return { s: d, k };
        }
        case 'text': case 'textrm': case 'textit': case 'textbf': case 'textsf': case 'texttt':
        case 'textnormal': case 'textup': case 'textmd': case 'emph': case 'mbox': case 'hbox':
          return { s: this.textMode(this.readRaw()), k: 'text' };
        case 'mathrm': case 'mathit': case 'mathbf': case 'mathsf': case 'mathtt': case 'mathcal':
        case 'mathscr': case 'mathfrak': case 'boldsymbol': case 'bm': case 'mathnormal': case 'pmb':
        case 'mathbfit': case 'symbf': case 'symrm': case 'boxed': case 'fbox': case 'cancel':
        case 'bcancel': case 'xcancel': case 'sout': case 'mathclap': case 'mathllap': case 'mathrlap':
        case 'llap': case 'rlap': case 'clap': case 'smash': case 'mathord': case 'mathinner':
          return this.parseArgItem(depth);
        case 'mathbb': case 'Bbb': case 'mathds':
          return { s: [...this.parseArg(depth)].map(ch => DOUBLE_STRUCK[ch] || ch).join(''), k: 'ord' };
        case 'operatorname': {
          let star = false;
          if (this.s[this.i] === '*') { this.i++; star = true; }
          return { s: this.parseArg(depth), k: star ? 'bigop' : 'func' };
        }
        case 'mathop': return { s: this.parseArg(depth), k: 'bigop' };
        case 'mathrel': return { s: this.parseArg(depth), k: 'rel' };
        case 'mathbin': return { s: this.parseArg(depth), k: 'bin' };
        case 'mathpunct': return { s: this.parseArg(depth), k: 'punct' };
        case 'mathopen': return { s: this.parseArg(depth), k: 'open' };
        case 'mathclose': return { s: this.parseArg(depth), k: 'close' };
        case 'not': {
          const a = this.atom(this.next(), depth);
          if (!a) return null;
          return { s: NEGATED[a.s] || '¬' + a.s, k: NEGATED[a.s] ? 'rel' : 'ord' };
        }
        case 'pmod':
          return { s: ' (mod ' + this.parseArg(depth) + ')', k: 'ord' };
        case 'bmod': case 'mod':
          return { s: 'mod', k: 'wordop' };
        case 'overline': case 'bar': case 'hat': case 'widehat': case 'tilde': case 'widetilde':
        case 'vec': case 'overrightarrow': case 'overleftarrow': case 'overleftrightarrow':
        case 'dot': case 'ddot': case 'check': case 'widecheck': case 'breve': case 'acute':
        case 'grave': case 'mathring': case 'underline': case 'utilde':
          return { s: accentStr(v, this.parseArg(depth)), k: 'ord' };
        case 'overbrace': case 'underbrace': case 'overbracket': case 'underbracket': {
          const a = this.parseArg(depth);
          this.skipWs();
          while (this.s[this.i] === '^' || this.s[this.i] === '_') {
            this.i++;
            this.parseArg(depth + 1);
            this.skipWs();
          }
          return { s: a, k: 'ord' };
        }
        case 'overset': case 'underset': case 'stackrel':
          this.parseArg(depth + 1);
          return this.parseArgItem(depth);
        case 'xrightarrow': case 'xRightarrow': case 'xleftarrow': case 'xLeftarrow':
          this.optArg(depth + 1);
          this.parseArg(depth + 1);
          return { s: { xrightarrow: '→', xRightarrow: '⇒', xleftarrow: '←', xLeftarrow: '⇐' }[v], k: 'rel' };
        case 'phantom': case 'hphantom': case 'vphantom':
          this.parseArg(depth);
          return null;
        case 'color':
          this.readRaw();
          return null;
        case 'textcolor': case 'href':
          this.readRaw();
          return this.parseArgItem(depth);
        case 'colorbox':
          this.readRaw();
          return { s: this.textMode(this.readRaw()), k: 'text' };
        case 'fcolorbox':
          this.readRaw();
          this.readRaw();
          return { s: this.textMode(this.readRaw()), k: 'text' };
        case 'url':
          return { s: this.readRaw(), k: 'text' };
        case 'label': case 'tag': case 'eqref': case 'ref':
          if (this.s[this.i] === '*') this.i++;
          this.readRaw();
          return null;
        case 'hspace': case 'vspace':
          if (this.s[this.i] === '*') this.i++;
          this.readRaw();
          return { s: ' ', k: 'space' };
        case 'kern': case 'mkern': case 'mskip': case 'hskip': {
          const m = /^\s*(\{[^}]*\}|-?[\d.]+\s*[a-z]{2})/.exec(this.s.slice(this.i));
          if (m) this.i += m[0].length;
          return null;
        }
        case 'substack': {
          const rows = this.readRaw().split(/\\\\/).map(r => latexToText(r)).filter(Boolean);
          return { s: rows.join(', '), k: 'ord' };
        }
        case 'begin':
          return this.env(depth);
        case 'end':
          this.readRaw();
          return null;
        case '\\': case 'newline': case 'cr':
          this.optArg(depth);
          return { s: '\n', k: 'text' };
        default:
          return { s: v, k: 'ord' };
      }
    }

    env(depth) {
      const name = this.readRaw().trim();
      if (/^(array|darray|subarray|tabular|alignat\*?|alignedat)$/.test(name)) this.readRaw();
      const rows = [];
      let row = [];
      for (;;) {
        const items = this.parseRow(depth, '&', ['end', '\\', 'cr', 'newline']);
        row.push(joinItems(items, depth));
        const t = this.next();
        if (t.t === 'eof') { rows.push(row); break; }
        if (t.t === 'char' && t.v === '&') continue;
        if (t.t === 'cmd' && t.v === 'end') { this.readRaw(); rows.push(row); break; }
        this.optArg(depth); // \\[4pt]
        rows.push(row);
        row = [];
      }
      while (rows.length && rows[rows.length - 1].every(c => !c.trim())) rows.pop();
      return { s: formatTable(name.replace(/\*$/, ''), rows), k: 'ord' };
    }
  }

  function formatTable(env, rows) {
    const clean = r => r.map(c => c.trim());
    if (/matrix$/.test(env) || /array$/.test(env) || env === 'tabular') {
      const inner = rows.map(r => '[' + clean(r).join(', ') + ']').join(', ');
      const mat = rows.length === 1 ? inner : '[' + inner + ']';
      if (env === 'vmatrix') return 'det(' + mat + ')';
      if (env === 'Vmatrix') return '‖' + mat + '‖';
      return mat;
    }
    if (/cases$/.test(env)) {
      return '{ ' + rows.map(r => clean(r).filter(Boolean).join(', ')).join('; ') + ' }';
    }
    // align, aligned, gather, split, eqnarray, multline...
    return rows.map(r => clean(r).join(' ').replace(/ {2,}/g, ' ').trim()).join('\n');
  }

  function latexToText(src) {
    const p = new LatexParser(String(src));
    const items = p.parseRow(0, null, null);
    return mathFinal(joinItems(items, 0));
  }

  // ------------------------------------------------------------------
  // MathML -> text
  // ------------------------------------------------------------------

  const lname = el => (el.localName || '').toLowerCase().replace(/^(mml|m|math):/, '');
  const kids = el => Array.from(el.childNodes).filter(c => c.nodeType === 1);
  const textOf = el => (el ? el.textContent || '' : '');

  function findDesc(el, name) {
    for (const c of kids(el)) {
      if ((c.localName || '').toLowerCase() === name) return c;
      const d = findDesc(c, name);
      if (d) return d;
    }
    return null;
  }

  function mmlRowItems(els, depth) {
    const out = [];
    for (const c of els) out.push(...mmlItems(c, depth));
    return out;
  }
  const mmlStr = (el, depth) => (el ? joinItems(mmlItems(el, depth), depth) : '');
  function mmlItem(el, depth) {
    const items = mmlItems(el, depth).filter(it => it.k !== 'skip');
    if (items.length === 1) return items[0];
    return { s: joinItems(items, depth), k: 'ord' };
  }

  function mmlItems(el, depth) {
    if (!el) return [];
    const n = lname(el);
    const children = kids(el);
    switch (n) {
      case 'math': case 'mrow': case 'mstyle': case 'mpadded': case 'merror': case 'menclose':
        return mmlRowItems(children, depth);
      case 'maction':
        return children.length ? mmlItems(children[0], depth) : [];
      case 'semantics': {
        const main = children.find(c => !/^annotation/.test(lname(c)));
        const items = main ? mmlItems(main, depth) : [];
        if (items.length) return items;
        const tex = children.find(c => lname(c) === 'annotation' && /tex/i.test(c.getAttribute('encoding') || ''));
        return tex ? [{ s: latexToText(textOf(tex)), k: 'ord' }] : [];
      }
      case 'annotation': case 'annotation-xml': case 'mphantom': case 'none': case 'mprescripts':
        return [];
      case 'mi': {
        let t = textOf(el).trim();
        if (!t) return [];
        if (el.getAttribute('mathvariant') === 'double-struck') t = [...t].map(c => DOUBLE_STRUCK[c] || c).join('');
        if ([...t].length > 1 && /^[A-Za-z]+$/.test(t)) {
          if (LIMOPS[t]) return [{ s: LIMOPS[t], k: 'bigop' }];
          if (FUNCS.has(t)) return [{ s: t, k: 'func' }];
        }
        return [{ s: t, k: 'ord' }];
      }
      case 'mn':
        return [{ s: textOf(el).trim(), k: 'ord' }];
      case 'mo': {
        const t = textOf(el).replace(/^[ \t\n]+|[ \t\n]+$/g, '');
        if (!t) return [];
        if (t === '⁡') return [{ s: '', k: 'apply' }];
        if (t === '⁢') return [];
        if (t === '⁣') return [{ s: ',', k: 'punct' }];
        if (t === '⁤') return [{ s: '+', k: 'bin' }];
        if (/^[A-Za-z]+$/.test(t) && LIMOPS[t]) return [{ s: LIMOPS[t], k: 'bigop' }];
        return [{ s: t, k: opKind(t) }];
      }
      case 'mtext': {
        const t = textOf(el).replace(/ /g, ' ');
        if (!t.trim()) return t ? [{ s: ' ', k: 'space' }] : [];
        return [{ s: t, k: 'text' }];
      }
      case 'ms':
        return [{ s: '"' + textOf(el) + '"', k: 'ord' }];
      case 'mspace': {
        if (el.getAttribute('linebreak') === 'newline') return [{ s: '\n', k: 'text' }];
        const w = el.getAttribute('width') || '';
        const num = parseFloat(w);
        if (/mathspace$/.test(w) || (num > 0.15 && /em$/.test(w)) || (num > 2 && /(px|pt|mu)$/.test(w))) {
          return [{ s: ' ', k: 'space' }];
        }
        return [];
      }
      case 'msup': case 'msub': case 'msubsup': {
        const [b, x, y] = children;
        const base = mmlItem(b, depth);
        const sub = n === 'msup' ? null : mmlStr(x, depth + 1);
        const sup = n === 'msub' ? null : mmlStr(n === 'msup' ? x : y, depth + 1);
        const big = base.k === 'bigop' || base.k === 'func';
        return [{ s: attach(big ? base.s : grpBase(base.s), sub, sup), k: big ? base.k : 'ord' }];
      }
      case 'munder': case 'mover': case 'munderover': {
        const [b, x, y] = children;
        const base = mmlItem(b, depth);
        const xt = textOf(x).trim();
        if (n === 'mover' && (el.getAttribute('accent') === 'true' || ACCENT_CHAR[xt]) && ACCENT_CHAR[xt]) {
          return [{ s: accentStr(ACCENT_CHAR[xt], base.s), k: 'ord' }];
        }
        if (/^[⏞⏟︷︸⎴⎵]$/.test(xt) || (n === 'munder' && /^[_¯‾―̲]$/.test(xt))) return [base];
        const under = n === 'mover' ? null : mmlStr(x, depth + 1);
        const over = n === 'munder' ? null : mmlStr(n === 'mover' ? x : y, depth + 1);
        if (base.k === 'bigop' || BIGOP_CH.has(base.s)) return [{ s: attach(base.s, under, over), k: 'bigop' }];
        if (base.k === 'rel' || base.k === 'bin') return [base];
        return [{ s: attach(grpBase(base.s), under, over), k: 'ord' }];
      }
      case 'mfrac': {
        const [a, b] = children;
        const num = mmlStr(a, depth + 1), den = mmlStr(b, depth + 1);
        const lt = el.getAttribute('linethickness');
        if (lt !== null && parseFloat(lt) === 0) return [{ s: num + ' choose ' + den, k: 'ord' }];
        return [{ s: fracStr(num, den), k: 'frac' }];
      }
      case 'msqrt':
        return [{ s: 'sqrt(' + joinItems(mmlRowItems(children, depth), depth) + ')', k: 'ord' }];
      case 'mroot': {
        const [b, i] = children;
        return [{ s: rootStr(mmlStr(b, depth), mmlStr(i, depth + 1)), k: 'ord' }];
      }
      case 'mfenced': {
        const open = el.getAttribute('open') ?? '(';
        const close = el.getAttribute('close') ?? ')';
        const seps = (el.getAttribute('separators') ?? ',').replace(/\s/g, '');
        const parts = children.map(c => mmlStr(c, depth));
        let s = open;
        parts.forEach((p, i) => {
          if (i > 0) s += (seps[Math.min(i - 1, seps.length - 1)] || '') + ' ';
          s += p;
        });
        return [{ s: s + close, k: 'ord' }];
      }
      case 'mtable':
        return mmlTable(el, depth);
      case 'mmultiscripts': {
        const [b, ...rest] = children;
        const subs = [], sups = [];
        for (let i = 0; i + 1 < rest.length; i += 2) {
          if (lname(rest[i]) === 'mprescripts') break;
          const sb = mmlStr(rest[i], depth + 1), sp = mmlStr(rest[i + 1], depth + 1);
          if (sb) subs.push(sb);
          if (sp) sups.push(sp);
        }
        return [{ s: attach(grpBase(mmlStr(b, depth)), subs.join(','), sups.join(',')), k: 'ord' }];
      }
      default:
        if (children.length) return mmlRowItems(children, depth);
        return textOf(el).trim() ? [{ s: textOf(el).trim(), k: 'ord' }] : [];
    }
  }

  function mmlTable(el, depth) {
    const rows = kids(el)
      .filter(r => /^m(labeled)?tr$/.test(lname(r)))
      .map(r => {
        const cells = kids(r).filter(c => lname(c) === 'mtd');
        if (lname(r) === 'mlabeledtr') cells.shift();
        return cells.map(c => mmlStr(c, depth).trim());
      });
    const prev = el.previousElementSibling, next = el.nextElementSibling;
    const prevT = prev ? textOf(prev).trim() : '', nextT = next ? textOf(next).trim() : '';
    // cases: "{" before the table and nothing after it
    if (prevT === '{' && !next) {
      return [{ s: ' ' + rows.map(r => r.filter(Boolean).join(', ')).join('; ') + ' }', k: 'ord' }];
    }
    const align = (el.getAttribute('columnalign') || '').trim();
    const isAlign = align && !/^(center\s*)+$/.test(align) && rows.some(r => r.length > 1) && !OPEN_CH.has(prevT) && prevT !== '|';
    if (isAlign || rows.every(r => r.length === 1)) {
      if (rows.every(r => r.length === 1) && OPEN_CH.has(prevT)) {
        // column vector
        return [{ s: rows.map(r => '[' + r[0] + ']').join(', '), k: 'ord' }];
      }
      return [{ s: rows.map(r => r.join(' ').replace(/ {2,}/g, ' ').trim()).join('\n'), k: 'text' }];
    }
    const inner = rows.map(r => '[' + r.join(', ') + ']').join(', ');
    const fenced = prevT && (OPEN_CH.has(prevT) || prevT === '|' || prevT === '‖') && nextT;
    return [{ s: fenced || rows.length === 1 ? inner : '[' + inner + ']', k: 'ord' }];
  }

  function mathmlToText(mathEl) {
    return mathFinal(joinItems(mmlItems(mathEl, 0), 0));
  }

  // ------------------------------------------------------------------
  // Word equations (OMML, found inside <!--[if gte msEquation 12]> comments)
  // ------------------------------------------------------------------

  const mname = el => {
    const n = (el.localName || '').toLowerCase();
    return n.startsWith('m:') ? n.slice(2) : null;
  };

  // math children, looking through plain HTML wrappers like <i><span>
  function mkids(el) {
    const out = [];
    if (!el) return out;
    for (const c of kids(el)) {
      const n = (c.localName || '').toLowerCase();
      if (n.startsWith('m:')) out.push(c);
      else if (!n.includes(':')) out.push(...mkids(c));
    }
    return out;
  }
  const mkid = (el, name) => mkids(el).find(c => mname(c) === name) || null;

  function propVal(el, prName, name) {
    const pr = mkid(el, prName);
    if (!pr) return null;
    const x = findDesc(pr, 'm:' + name);
    if (!x) return null;
    const v = x.getAttribute('m:val');
    return v === null ? '' : v;
  }
  function propFlag(el, prName, name) {
    const v = propVal(el, prName, name);
    return v !== null && v !== '0' && v !== 'off' && v !== 'false';
  }

  function runText(el) {
    let t = '';
    for (const c of el.childNodes) {
      if (c.nodeType === 3) t += c.data;
      else if (c.nodeType === 1) {
        const n = (c.localName || '').toLowerCase();
        if (/:\w*pr$/.test(n)) continue;
        t += runText(c);
      }
    }
    return t;
  }

  function tokenItems(t) {
    const items = [];
    for (const ch of t) {
      if (/[\s &]/.test(ch)) continue;
      items.push({ s: ch, k: opKind(ch) });
    }
    return items;
  }

  function ommlRow(el, depth) {
    const out = [];
    for (const c of mkids(el)) out.push(...ommlItems(c, depth));
    return out;
  }
  const ommlStr = (el, depth) => (el ? joinItems(ommlRow(el, depth), depth) : '');

  function ommlItems(el, depth) {
    const n = mname(el);
    if (!n || /pr$/.test(n)) return [];
    const e = () => mkid(el, 'e');
    switch (n) {
      case 'r': {
        const t = runText(el);
        if (findDesc(el, 'm:nor')) return t ? [{ s: t, k: 'text' }] : [];
        return tokenItems(t);
      }
      case 't':
        return tokenItems(textOf(el));
      case 'ssup': case 'ssub': case 'ssubsup': {
        const baseItems = ommlRow(e(), depth);
        const base = baseItems.length === 1 ? baseItems[0] : { s: joinItems(baseItems, depth), k: 'ord' };
        const sub = n === 'ssup' ? null : ommlStr(mkid(el, 'sub'), depth + 1);
        const sup = n === 'ssub' ? null : ommlStr(mkid(el, 'sup'), depth + 1);
        const big = base.k === 'bigop' || base.k === 'func';
        return [{ s: attach(big ? base.s : grpBase(base.s), sub, sup), k: big ? base.k : 'ord' }];
      }
      case 'spre': {
        const sub = ommlStr(mkid(el, 'sub'), depth + 1), sup = ommlStr(mkid(el, 'sup'), depth + 1);
        return [{ s: attach('', sub, sup) + grpBase(ommlStr(e(), depth)), k: 'ord' }];
      }
      case 'f': {
        const num = ommlStr(mkid(el, 'num'), depth + 1), den = ommlStr(mkid(el, 'den'), depth + 1);
        if (propVal(el, 'fpr', 'type') === 'noBar') return [{ s: num + ' choose ' + den, k: 'ord' }];
        return [{ s: fracStr(num, den), k: 'frac' }];
      }
      case 'rad': {
        const hide = propFlag(el, 'radpr', 'deghide');
        const deg = hide ? '' : ommlStr(mkid(el, 'deg'), depth + 1);
        return [{ s: rootStr(ommlStr(e(), depth), deg || null), k: 'ord' }];
      }
      case 'd': {
        const beg = propVal(el, 'dpr', 'begchr'), end = propVal(el, 'dpr', 'endchr');
        const sep = propVal(el, 'dpr', 'sepchr');
        const parts = mkids(el).filter(c => mname(c) === 'e').map(c => ommlStr(c, depth));
        const sp = sep === null ? '|' : sep;
        return [{ s: (beg === null ? '(' : beg) + parts.join(sp === ',' ? ', ' : sp) + (end === null ? ')' : end), k: 'ord' }];
      }
      case 'nary': {
        const chr = propVal(el, 'narypr', 'chr');
        const op = chr ? chr : '∫';
        const sub = propFlag(el, 'narypr', 'subhide') ? '' : ommlStr(mkid(el, 'sub'), depth + 1);
        const sup = propFlag(el, 'narypr', 'suphide') ? '' : ommlStr(mkid(el, 'sup'), depth + 1);
        return [{ s: attach(op, sub, sup), k: 'bigop' }, ...ommlRow(e(), depth)];
      }
      case 'func': {
        const name = ommlStr(mkid(el, 'fname'), depth);
        const arg = ommlStr(e(), depth);
        if (isWrapped(arg)) return [{ s: name + arg, k: 'ord' }];
        if (/^(lim|max|min|sup|inf)/.test(name)) return [{ s: name, k: 'bigop' }, { s: arg, k: 'ord' }];
        return [{ s: name + '(' + arg + ')', k: 'ord' }];
      }
      case 'limlow':
        return [{ s: attach(ommlStr(e(), depth), ommlStr(mkid(el, 'lim'), depth + 1), null), k: 'bigop' }];
      case 'limupp':
        return [{ s: attach(ommlStr(e(), depth), null, ommlStr(mkid(el, 'lim'), depth + 1)), k: 'bigop' }];
      case 'acc': {
        const chr = propVal(el, 'accpr', 'chr');
        const name = ACCENT_CHAR[chr || '̂'] || 'hat';
        return [{ s: accentStr(name, ommlStr(e(), depth)), k: 'ord' }];
      }
      case 'bar':
        if (propVal(el, 'barpr', 'pos') === 'top') return [{ s: accentStr('overline', ommlStr(e(), depth)), k: 'ord' }];
        return ommlRow(e(), depth);
      case 'phant':
        if (['0', 'off', 'false'].includes(propVal(el, 'phantpr', 'show'))) return [];
        return ommlRow(e(), depth);
      case 'm': {
        const rows = mkids(el).filter(c => mname(c) === 'mr')
          .map(r => mkids(r).filter(c => mname(c) === 'e').map(c => ommlStr(c, depth)));
        const inner = rows.map(r => '[' + r.join(', ') + ']').join(', ');
        return [{ s: rows.length === 1 ? inner : '[' + inner + ']', k: 'ord' }];
      }
      case 'eqarr': {
        const rows = mkids(el).filter(c => mname(c) === 'e').map(c => ommlStr(c, depth));
        return [{ s: rows.join('; '), k: 'ord' }];
      }
      default:
        return ommlRow(el, depth);
    }
  }

  function ommlToText(root) {
    if (mname(root) === 'omathpara') {
      return mkids(root).filter(c => mname(c) === 'omath')
        .map(m => mathFinal(joinItems(ommlRow(m, 0), 0))).join('\n');
    }
    return mathFinal(joinItems(ommlRow(root, 0), 0));
  }

  function ommlFromComment(data) {
    const start = data.indexOf('>') + 1;
    let end = data.lastIndexOf('<![endif]');
    if (end < 0) end = data.length;
    const doc = new DOMParser().parseFromString('<body>' + data.slice(start, end) + '</body>', 'text/html');
    const results = [];
    (function find(el) {
      for (const c of kids(el)) {
        const n = mname(c);
        if (n === 'omathpara' || n === 'omath') results.push(ommlToText(c));
        else find(c);
      }
    })(doc.body);
    return results.join(' ');
  }

  // ------------------------------------------------------------------
  // HTML -> text
  // ------------------------------------------------------------------

  const SKIP_TAGS = new Set([
    'script', 'style', 'head', 'title', 'meta', 'link', 'noscript', 'template', 'iframe',
    'object', 'embed', 'svg', 'canvas', 'audio', 'video', 'select', 'button', 'rp', 'rt', 'xml',
  ]);
  const BLOCK_TAGS = new Set([
    'div', 'section', 'article', 'header', 'footer', 'nav', 'aside', 'main', 'blockquote',
    'figure', 'figcaption', 'dl', 'dt', 'dd', 'address', 'details', 'summary', 'center',
    'form', 'fieldset', 'legend', 'caption', 'table', 'tbody', 'thead', 'tfoot', 'ul', 'ol',
  ]);

  function wrapMath(text, display) {
    return display ? BLOCK + text + BLOCK : text;
  }

  function scriptText(inner, kind, before) {
    const t = inner.replace(/\s+/g, ' ').trim();
    if (!t) return '';
    if (kind === 'sup') {
      if (/^\[[^\]]*\]$/.test(t)) return t;                               // footnote [1]
      if (/^(st|nd|rd|th)$/i.test(t) && /\d$/.test(before)) return t;     // 1st, 2nd
      if (t === 'TM') return '™';
      if (t === 'SM') return '℠';
      if (/^[®©™*†‡]+$/.test(t)) return t;
      return '^' + grp(t);
    }
    return '_' + grp(t);
  }

  function listMarker(list) {
    const n = list.n++;
    if (!list.ordered) return '-';
    switch (list.type) {
      case 'a': return String.fromCharCode(96 + ((n - 1) % 26) + 1) + '.';
      case 'A': return String.fromCharCode(64 + ((n - 1) % 26) + 1) + '.';
      case 'i': case 'I': {
        const r = toRoman(n);
        return (list.type === 'i' ? r.toLowerCase() : r) + '.';
      }
      default: return n + '.';
    }
  }

  function toRoman(n) {
    const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
      [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let s = '';
    for (const [v, r] of map) while (n >= v) { s += r; n -= v; }
    return s;
  }

  function walkChildren(node, ctx) {
    let out = '';
    let mode = null;    // inside a Word conditional block: 'skip' | 'list'
    let listStart = 0;
    for (const c of Array.from(node.childNodes)) {
      if (c.nodeType === 8) {
        const d = c.data.trim();
        if (/^\[if gte msEquation/i.test(d)) {
          out += ommlFromComment(c.data);
          mode = 'skip';
        } else if (/^\[endif\]$/i.test(d)) {
          if (mode === 'list') {
            const marker = out.slice(listStart).replace(/[\s ]+/g, ' ').trim();
            const level = /level(\d+)/.exec(node.getAttribute && (node.getAttribute('style') || '') || '');
            const indent = NBSP.repeat(2 * ((level ? +level[1] : 1) - 1));
            const m = /^\(?[\w]{1,4}[.)]$/.test(marker) ? marker : '-';
            out = out.slice(0, listStart) + indent + m + ' ';
          }
          mode = null;
        } else if (/^\[if !supportLists\]$/i.test(d)) {
          mode = 'list';
          listStart = out.length;
        } else if (/^\[if !(msEquation|supportLineBreakNewLine|vml)\]$/i.test(d)) {
          mode = 'skip';
        }
        continue;
      }
      if (mode === 'skip') continue;
      out += walkNode(c, ctx, out);
    }
    return out;
  }

  function walkNode(node, ctx, before) {
    if (node.nodeType === 3) {
      if (ctx.pre) return node.data.replace(/ /g, NBSP);
      return node.data.replace(/[ \t\n\r\f]+/g, ' ');
    }
    if (node.nodeType !== 1) return '';

    const el = node;
    const tag = (el.localName || '').toLowerCase();
    const cls = el.getAttribute('class') || '';
    const style = el.getAttribute('style') || '';

    // ---- math ----
    if (tag === 'math') return wrapMath(mathmlToText(el), el.getAttribute('display') === 'block');
    if (tag === 'm:omath' || tag === 'm:omathpara') return ommlToText(el);
    if (tag === 'script') {
      const type = el.getAttribute('type') || '';
      if (/math\/tex/.test(type)) return wrapMath(latexToText(el.textContent), /mode=display/.test(type));
      return '';
    }
    if (/\bkatex-display\b/.test(cls)) return BLOCK + walkChildren(el, ctx) + BLOCK;
    if (/(^|\s)katex(\s|$)|\bkatex-mathml\b|\bMathJax\b|\bMJX|\bmwe-math-element\b/.test(cls) || tag.startsWith('mjx-')) {
      const math = tag === 'math' ? el : findDesc(el, 'math');
      if (math) {
        const display = math.getAttribute('display') === 'block' || el.getAttribute('display') === 'true';
        return wrapMath(mathmlToText(math), display);
      }
      if (/MathJax_Preview/.test(cls)) return '';
      if (/mwe-math-element/.test(cls)) {
        const img = findDesc(el, 'img');
        return img ? latexToText((img.getAttribute('alt') || '')) : '';
      }
      if (tag.startsWith('mjx-')) return '';
      if (/\bkatex\b/.test(cls)) {
        const html = Array.from(el.children || []).find(c => /katex-html/.test(c.getAttribute('class') || ''));
        if (html) return katexHtmlText(html);
      }
    }
    if (/\bkatex-html\b/.test(cls)) {
      const prev = el.previousElementSibling;
      if (prev && /katex-mathml/.test(prev.getAttribute('class') || '')) return '';
      return katexHtmlText(el);
    }

    if (SKIP_TAGS.has(tag)) return '';
    if (tag.includes(':') && /^(v|w|o):/.test(tag) && tag !== 'o:p') return '';
    if (/display\s*:\s*none|mso-hide\s*:\s*all|visibility\s*:\s*hidden/i.test(style) || el.hasAttribute('hidden')) {
      const math = findDesc(el, 'math');
      return math ? mathmlToText(math) : '';
    }

    // ---- superscript / subscript ----
    let script = tag === 'sup' ? 'sup' : tag === 'sub' ? 'sub' : null;
    const va = /vertical-align\s*:\s*(super|sub)/i.exec(style);
    if (va) script = va[1].toLowerCase() === 'super' ? 'sup' : 'sub';
    if (/MsoFootnoteReference|MsoEndnoteReference/.test(cls)) script = null;
    if (script) return scriptText(walkChildren(el, ctx), script, before.replace(/[\u0001\u0002\s]+$/, ''));

    switch (tag) {
      case 'br':
        return '\n';
      case 'hr':
        return BLOCK + '----------' + BLOCK;
      case 'img': {
        const alt = (el.getAttribute('alt') || '').trim();
        if (/mwe-math-fallback/.test(cls) || /\\[a-zA-Z]+|[\^_]\{/.test(alt)) return latexToText(alt);
        if (alt && ([...alt].length <= 2 || /emoji/i.test(cls))) return alt;
        return '';
      }
      case 'input': {
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (type === 'checkbox' || type === 'radio') return el.hasAttribute('checked') ? '[x] ' : '[ ] ';
        return el.getAttribute('value') || '';
      }
      case 'a': {
        const inner = walkChildren(el, ctx);
        const href = el.getAttribute('href') || '';
        if (ctx.opts.keepLinks && /^(https?:|mailto:)/i.test(href)) {
          const label = inner.replace(/\s+/g, ' ').trim();
          const bare = href.replace(/^mailto:/i, '');
          if (label && label !== href && label !== bare) return inner + ' (' + bare + ')';
          if (!label) return bare;
        }
        return inner;
      }
      case 'pre': {
        ctx.pre++;
        const inner = walkChildren(el, ctx);
        ctx.pre--;
        return PARA + inner + PARA;
      }
      case 'textarea':
        return BLOCK + el.textContent.replace(/ /g, NBSP) + BLOCK;
      case 'p': {
        const compact = /^Mso/.test(cls) || /margin-(top|bottom)\s*:\s*0/i.test(style) || ctx.inLi;
        const sep = compact ? BLOCK : PARA;
        return sep + walkChildren(el, ctx) + sep;
      }
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        return PARA + walkChildren(el, ctx) + PARA;
      case 'ul': case 'ol': case 'menu': {
        ctx.lists.push({
          ordered: tag === 'ol',
          n: parseInt(el.getAttribute('start') || '1', 10) || 1,
          type: el.getAttribute('type') || '1',
        });
        const inner = walkChildren(el, ctx);
        ctx.lists.pop();
        return (ctx.lists.length ? BLOCK : PARA) + inner + (ctx.lists.length ? BLOCK : PARA);
      }
      case 'li': {
        const list = ctx.lists[ctx.lists.length - 1] || { ordered: false, n: 1 };
        if (el.getAttribute('value')) list.n = parseInt(el.getAttribute('value'), 10) || list.n;
        const depth = Math.max(ctx.lists.length, 1);
        const marker = listMarker(list);
        const wasInLi = ctx.inLi;
        ctx.inLi = true;
        const inner = walkChildren(el, ctx).replace(/\u0002/g, BLOCK).replace(/^[ \t\n\u0001]+/, '');
        ctx.inLi = wasInLi;
        return BLOCK + NBSP.repeat(2 * (depth - 1)) + marker + ' ' + inner + BLOCK;
      }
      case 'tr': {
        const cells = Array.from(el.children || []).filter(c => /^(td|th)$/i.test(c.localName));
        const texts = cells.map(c => walkChildren(c, ctx).replace(/[\u0001\u0002\n]+/g, ' ').replace(/\s+/g, ' ').trim());
        return BLOCK + texts.join('\t') + BLOCK;
      }
      case 'td': case 'th':
        return walkChildren(el, ctx) + '\t';
      case 'q':
        return '"' + walkChildren(el, ctx) + '"';
    }

    if (BLOCK_TAGS.has(tag) || /^(Mso|MsoNormal)/.test(cls)) return BLOCK + walkChildren(el, ctx) + BLOCK;
    return walkChildren(el, ctx);
  }

  // Fallback for KaTeX HTML without its hidden MathML: best effort
  function katexHtmlText(el) {
    let out = '';
    for (const c of el.childNodes) {
      if (c.nodeType === 3) { out += c.data; continue; }
      if (c.nodeType !== 1) continue;
      const cls = c.getAttribute('class') || '';
      if (/\bmsupsub\b/.test(cls)) out += '^' + grp(c.textContent.replace(/[​\s]+/g, ''));
      else out += katexHtmlText(c);
    }
    return out.replace(/[​]/g, '');
  }

  // ------------------------------------------------------------------
  // Post-processing
  // ------------------------------------------------------------------

  function convertLatexInText(s) {
    const conv = x => latexToText(x);
    return s
      .replace(/\$\$([\s\S]+?)\$\$/g, (m, x) => conv(x))
      .replace(/\\\[([\s\S]+?)\\\]/g, (m, x) => conv(x))
      .replace(/\\\(([\s\S]+?)\\\)/g, (m, x) => conv(x))
      .replace(/(^|[^\\$\w])\$(?![\s$])([^$\n]*?[^\s\\$])\$(?![\w$])/g, (m, pre, x) => pre + conv(x))
      .replace(/(^|[^\\$\w])\$([^\s$\\])\$(?![\w$])/g, (m, pre, x) => pre + x);
  }

  function convertUnicodeScripts(s) {
    return s
      .replace(SUP_RE, m => '^' + grp([...m].map(c => SUP_CHARS[c]).join('')))
      .replace(SUB_RE, m => '_' + grp([...m].map(c => SUB_CHARS[c]).join('')));
  }

  // 𝑥 𝐀 𝟏 (Mathematical Alphanumeric Symbols) -> x A 1
  function normalizeMathLetters(s) {
    return s.replace(/[\u{1D400}-\u{1D7FF}ℎ]/gu, ch => ch.normalize('NFKC'));
  }

  const COMB_NAME = {};
  for (const [name, ch] of Object.entries(COMBINING)) if (!COMB_NAME[ch]) COMB_NAME[ch] = ACCENT_NAME[name] || name;

  function toAscii(s) {
    s = s.replace(/([^\s])([̀-ͯ⃐-⃿])/g, (m, c, mark) => (COMB_NAME[mark] ? COMB_NAME[mark] + '(' + c + ')' : c));
    const chars = [...s];
    let out = '';
    const alnum = c => /[\p{L}\p{N}]/u.test(c || '');
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      const entry = ASCII[c];
      if (!entry) { out += c; continue; }
      const [rep, type] = entry;
      const prev = out[out.length - 1], next = chars[i + 1];
      if (type === 'w') {
        out += (alnum(prev) ? '*' : '') + rep + (alnum(next) ? '*' : '');
      } else if (type === 'op') {
        out += (prev && prev !== ' ' && prev !== '\n' && prev !== '(' ? ' ' : '') + rep + (next && next !== ' ' && next !== '\n' && next !== ')' ? ' ' : '');
      } else {
        out += rep;
      }
    }
    return out.replace(/\*\*(?=\p{L})/gu, '*');
  }

  function finalize(raw, opts) {
    let s = raw
      .replace(/[ \t]*([\u0001\u0002][\u0001\u0002 \t\n]*)/g, (m, run) => (run.includes(PARA) ? '\n\n' : '\n'))
      .replace(/ {2,}/g, ' ')
      .replace(/^ +| +$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^[\n ]+|[\n \t]+$/g, '');
    return postText(s, opts);
  }

  function postText(s, opts) {
    if (opts.latexInText) s = convertLatexInText(s);
    s = normalizeMathLetters(s);
    if (opts.unicodeScripts) s = convertUnicodeScripts(s);
    s = s
      .replace(/ /g, ' ')
      .replace(/[​‌⁠⁡⁢⁣﻿]/g, '')
      .replace(/⁤/g, '+')
      .replace(/−/g, '-');
    if (opts.ascii) s = toAscii(s);
    return s.replace(/[ \t]+$/gm, '');
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  function htmlToPlain(html, options) {
    const opts = Object.assign({}, DEFAULTS, options);
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    const ctx = { opts, lists: [], pre: 0, inLi: false };
    return finalize(walkChildren(doc.body, ctx), opts);
  }

  function textToPlain(text, options) {
    const opts = Object.assign({}, DEFAULTS, options);
    return postText(String(text).replace(/\r\n?/g, '\n'), opts);
  }

  global.RichToPlain = {
    htmlToPlain,
    textToPlain,
    latexToText,
    mathmlToText,
    DEFAULTS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
