const { JSDOM } = require('jsdom');
const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
require('../converter.js');
const { htmlToPlain, textToPlain, latexToText } = globalThis.RichToPlain;

let fail = 0;
function eq(name, got, want) {
  if (got !== want) { fail++; console.log('FAIL', name, '\n  got: ', JSON.stringify(got), '\n  want:', JSON.stringify(want)); }
  else console.log('ok  ', name, '=>', JSON.stringify(got));
}

// HTML basics
eq('sup', htmlToPlain('2<sup>31</sup>'), '2^31');
eq('sup expr', htmlToPlain('2<sup>n+1</sup>'), '2^(n+1)');
eq('nested sup', htmlToPlain('2<sup>2<sup>n</sup></sup>'), '2^(2^n)');
eq('sub', htmlToPlain('H<sub>2</sub>O'), 'H_2O');
eq('ordinal', htmlToPlain('the 1<sup>st</sup> place'), 'the 1st place');
eq('footnote', htmlToPlain('fact<sup><a href="#c1">[1]</a></sup>.'), 'fact[1].');
eq('gdocs super', htmlToPlain('<span>x</span><span style="font-size:0.6em;vertical-align:super">2</span>'), 'x^2');
eq('paragraphs', htmlToPlain('<p>Hello <b>bold</b> <i>world</i></p><p>Second</p>'), 'Hello bold world\n\nSecond');
eq('list', htmlToPlain('<ul><li>a</li><li>b<ol><li>c</li><li>d</li></ol></li></ul>'), '- a\n- b\n  1. c\n  2. d');
eq('table', htmlToPlain('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'), 'A\tB\n1\t2');
eq('br', htmlToPlain('a<br>b'), 'a\nb');
eq('link', htmlToPlain('<a href="https://x.com">site</a>', { keepLinks: true }), 'site (https://x.com)');
eq('pre', htmlToPlain('<pre>  a\n    b</pre>'), '  a\n    b');

// MathML
eq('mathml sup', htmlToPlain('<math><msup><mn>2</mn><mn>31</mn></msup></math>'), '2^31');
eq('mathml frac', htmlToPlain('<math><mfrac><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mi>c</mi></mfrac></math>'), '(a+b)/c');
eq('mathml pythag', htmlToPlain('<math><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><msup><mi>y</mi><mn>2</mn></msup><mo>=</mo><msup><mi>z</mi><mn>2</mn></msup></math>'), 'x^2 + y^2 = z^2');
eq('mathml sqrt', htmlToPlain('<math><msqrt><mi>x</mi><mo>+</mo><mn>1</mn></msqrt></math>'), 'sqrt(x + 1)');
eq('mathml sum', htmlToPlain('<math><munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><msub><mi>x</mi><mi>i</mi></msub></math>'), '∑_(i=1)^n x_i');
eq('mathml sin', htmlToPlain('<math><mi>sin</mi><mo>⁡</mo><mi>x</mi></math>'), 'sin x');
eq('mathml frac neighbor', htmlToPlain('<math><mfrac><mn>1</mn><mn>2</mn></mfrac><mi>x</mi></math>'), '(1/2)x');
eq('mathml degree', htmlToPlain('<math><mn>90</mn><msup><mi></mi><mo>∘</mo></msup></math>'), '90°');

// KaTeX (as copied from ChatGPT etc.)
const katex = '<p>The value is <span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msup><mn>2</mn><mn>31</mn></msup></mrow><annotation encoding="application/x-tex">2^{31}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="base"><span class="mord">2</span><span class="msupsub">31</span></span></span></span>.</p>';
eq('katex', htmlToPlain(katex), 'The value is 2^31.');
const katexQuad = '<span class="katex-display"><span class="katex"><span class="katex-mathml"><math display="block"><semantics><mrow><mi>x</mi><mo>=</mo><mfrac><mrow><mo>−</mo><mi>b</mi><mo>±</mo><msqrt><mrow><msup><mi>b</mi><mn>2</mn></msup><mo>−</mo><mn>4</mn><mi>a</mi><mi>c</mi></mrow></msqrt></mrow><mrow><mn>2</mn><mi>a</mi></mrow></mfrac></mrow></semantics></math></span><span class="katex-html">junk</span></span></span>';
eq('katex quadratic', htmlToPlain('Formula:' + katexQuad + 'done'), 'Formula:\nx = (-b±sqrt(b^2-4ac))/(2a)\ndone');

// LaTeX
eq('latex pow', latexToText('2^{31}'), '2^31');
eq('latex quad', latexToText('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'), 'x = (-b±sqrt(b^2-4ac))/(2a)');
eq('latex sum', latexToText('\\sum_{i=1}^{n} i^2 = \\frac{n(n+1)(2n+1)}{6}'), '∑_(i=1)^n i^2 = (n(n+1)(2n+1))/6');
eq('latex int', latexToText('\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}'), '∫_0^∞ e^(-x^2) dx = sqrt(π)/2');
eq('latex lim', latexToText('\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1'), 'lim_(x→0) (sin x)/x = 1');
eq('latex root', latexToText('\\sqrt[3]{x+1}'), '(x + 1)^(1/3)');
eq('latex left right', latexToText('\\left( \\frac{a}{b} \\right)^2'), '(a/b)^2');
eq('latex matrix', latexToText('\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}'), '[[1, 2], [3, 4]]');
eq('latex cases', latexToText('|x| = \\begin{cases} x & \\text{if } x \\ge 0 \\\\ -x & \\text{otherwise} \\end{cases}'), '|x| = { x, if x ≥ 0; -x, otherwise }');
eq('latex aligned', latexToText('\\begin{aligned} a &= b + c \\\\ &= d \\end{aligned}'), 'a = b + c\n= d');
eq('latex vec', latexToText('\\vec{v} \\cdot \\hat{n}'), 'v⃗ · n̂');
eq('latex text', latexToText('\\text{Area} = \\pi r^2'), 'Area = πr^2');
eq('latex deg', latexToText('90^\\circ'), '90°');
eq('latex prime', latexToText("f'(x) = 2x"), "f'(x) = 2x");
eq('latex neq', latexToText('a \\not= b'), 'a ≠ b');
eq('latex mod', latexToText('a \\equiv b \\pmod{n}'), 'a ≡ b (mod n)');
eq('latex binom', latexToText('\\binom{n}{k}'), 'C(n, k)');
eq('latex e^{i pi}', latexToText('e^{i\\pi} + 1 = 0'), 'e^(iπ) + 1 = 0');
eq('latex mathbb', latexToText('x \\in \\mathbb{R}'), 'x ∈ ℝ');
eq('latex neg exp', latexToText('10^{-3}'), '10^-3');

// Text with LaTeX delimiters / unicode
eq('text $..$', textToPlain('Area is $\\pi r^2$ and costs $5 or $6.'), 'Area is πr^2 and costs $5 or $6.');
eq('text \\(..\\)', textToPlain('So \\(2^{31}\\) is big'), 'So 2^31 is big');
eq('unicode sup', textToPlain('x² + y³ = 10⁻³'), 'x^2 + y^3 = 10^-3');
eq('unicode sub', textToPlain('H₂O, xₙ₊₁'), 'H_2O, x_(n+1)');
eq('math italic', textToPlain('𝑥² + 𝑦'), 'x^2 + y');
eq('ascii', textToPlain('2πr × 3 ≤ ∞, α ∈ ℝ', { ascii: true }), '2*pi*r * 3 <= inf, alpha in R');
eq('ascii latex', htmlToPlain('<math><mi>x</mi><mo>≤</mo><mn>2</mn><mi>π</mi></math>', { ascii: true }), 'x <= 2*pi');

// Word equation (OMML in conditional comments) with fallback image
const word = `<html xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"><body><!--StartFragment--><p class=MsoNormal>Result: <!--[if gte msEquation 12]><m:oMath><m:sSup><m:sSupPr><span style='font-family:"Cambria Math"'><m:ctrlPr></m:ctrlPr></span></m:sSupPr><m:e><i><span style='font-family:"Cambria Math"'><m:r>2</m:r></span></i></m:e><m:sup><i><span style='font-family:"Cambria Math"'><m:r>31</m:r></span></i></m:sup></m:sSup></m:oMath><![endif]--><![if !msEquation]><span><img width=27 height=20 src="file:///C:/x/clip_image001.png"></span><![endif]> ok<o:p></o:p></p>
<p class=MsoNormal><!--[if gte msEquation 12]><m:oMath><m:f><m:fPr><m:ctrlPr></m:ctrlPr></m:fPr><m:num><m:r>a+b</m:r></m:num><m:den><m:r>c</m:r></m:den></m:f><m:r>=</m:r><m:rad><m:radPr><m:degHide m:val="1"/><m:ctrlPr></m:ctrlPr></m:radPr><m:deg></m:deg><m:e><m:r>x</m:r></m:e></m:rad></m:oMath><![endif]--><![if !msEquation]><img src="file:///x.png"><![endif]></p>
<p class=MsoListParagraphCxSpFirst style='mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span><![endif]>First item</p>
<p class=MsoListParagraphCxSpLast style='mso-list:l1 level1 lfo2'><![if !supportLists]><span>1.<span>&nbsp;&nbsp;&nbsp;</span></span><![endif]>Numbered</p>
<!--EndFragment--></body></html>`;
eq('word', htmlToPlain(word), 'Result: 2^31 ok\n(a+b)/c = sqrt(x)\n- First item\n1. Numbered');

// Word nary / delimiter / func
const word2 = `<p class=MsoNormal><!--[if gte msEquation 12]><m:oMath><m:nary><m:naryPr><m:chr m:val="∑"/><m:ctrlPr></m:ctrlPr></m:naryPr><m:sub><m:r>i=1</m:r></m:sub><m:sup><m:r>n</m:r></m:sup><m:e><m:sSub><m:e><m:r>x</m:r></m:e><m:sub><m:r>i</m:r></m:sub></m:sSub></m:e></m:nary><m:r>+</m:r><m:func><m:funcPr></m:funcPr><m:fName><m:r>sin</m:r></m:fName><m:e><m:r>θ</m:r></m:e></m:func><m:r>+</m:r><m:sSup><m:e><m:d><m:dPr><m:ctrlPr></m:ctrlPr></m:dPr><m:e><m:r>a+b</m:r></m:e></m:d></m:e><m:sup><m:r>2</m:r></m:sup></m:sSup></m:oMath><![endif]--></p>`;
eq('word2', htmlToPlain(word2), '∑_(i=1)^n x_i + sin(θ) + (a + b)^2');

// MathJax v3 with assistive MathML
const mj = '<mjx-container class="MathJax" jax="CHTML"><mjx-math class="MJX-TEX"><mjx-msup></mjx-msup></mjx-math><mjx-assistive-mml><math><msup><mi>e</mi><mrow><mi>i</mi><mi>π</mi></mrow></msup></math></mjx-assistive-mml></mjx-container>';
eq('mathjax', htmlToPlain('Euler: ' + mj), 'Euler: e^(iπ)');

// Wikipedia
const wiki = '<span class="mwe-math-element"><span class="mwe-math-mathml-inline mwe-math-mathml-a11y" style="display: none;"><math alttext="{\\displaystyle 2^{31}}"><semantics><mrow class="MJX-TeXAtom-ORD"><mstyle displaystyle="true" scriptlevel="0"><msup><mn>2</mn><mrow class="MJX-TeXAtom-ORD"><mn>31</mn></mrow></msup></mstyle></mrow><annotation encoding="application/x-tex">{\\displaystyle 2^{31}}</annotation></semantics></math></span><img src="x.svg" class="mwe-math-fallback-image-inline" alt="{\\displaystyle 2^{31}}"></span>';
eq('wikipedia', htmlToPlain('It is ' + wiki + ' total'), 'It is 2^31 total');
eq('wiki img only', htmlToPlain('<img class="mwe-math-fallback-image-inline" alt="{\\displaystyle \\frac{1}{2}}">'), '1/2');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exitCode = fail ? 1 : 0;
