(function () {
  const input = document.getElementById('input');
  const output = document.getElementById('output');
  const status = document.getElementById('status');
  const opt = {
    unicode: document.getElementById('symUnicode'),
    ascii: document.getElementById('symAscii'),
    scripts: document.getElementById('optScripts'),
    latex: document.getElementById('optLatex'),
    links: document.getElementById('optLinks'),
    autoCopy: document.getElementById('optAutoCopy'),
  };

  // The raw clipboard HTML is kept so that things the preview cannot show
  // (e.g. Word equations hidden in conditional comments) still convert.
  let source = { type: 'html', html: '' };
  let statusTimer;

  function options() {
    return {
      ascii: opt.ascii.getAttribute('aria-pressed') === 'true',
      unicodeScripts: opt.scripts.checked,
      latexInText: opt.latex.checked,
      keepLinks: opt.links.checked,
    };
  }

  function convert() {
    const o = options();
    output.value = source.type === 'html'
      ? RichToPlain.htmlToPlain(source.html, o)
      : RichToPlain.textToPlain(source.text, o);
    const lines = output.value ? output.value.split('\n').length : 0;
    setStatus(output.value.length + ' chars · ' + lines + ' lines');
  }

  function setStatus(text, ok) {
    clearTimeout(statusTimer);
    status.textContent = text;
    status.classList.toggle('ok', !!ok);
    if (ok) statusTimer = setTimeout(convertStatus, 1800);
  }
  function convertStatus() {
    const lines = output.value ? output.value.split('\n').length : 0;
    setStatus(output.value.length + ' chars · ' + lines + ' lines');
  }

  // Show pasted HTML safely: no scripts, styles, event handlers or frames.
  function sanitize(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, link, meta, iframe, object, embed, form, base, title').forEach(n => n.remove());
    doc.body.querySelectorAll('*').forEach(el => {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || name === 'contenteditable' ||
            ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*javascript:/i.test(attr.value))) {
          el.removeAttribute(attr.name);
        }
      }
    });
    return doc.body.innerHTML;
  }

  function show(html, text) {
    if (html) {
      source = { type: 'html', html };
      input.innerHTML = sanitize(html);
    } else {
      source = { type: 'text', text: text || '' };
      input.textContent = text || '';
    }
    convert();
  }

  function load(html, text) {
    show(html, text);
    if (opt.autoCopy.checked && output.value) copy();
  }

  input.addEventListener('paste', e => {
    e.preventDefault();
    const dt = e.clipboardData;
    load(dt.getData('text/html'), dt.getData('text/plain'));
  });
  input.addEventListener('drop', e => {
    e.preventDefault();
    const dt = e.dataTransfer;
    load(dt.getData('text/html'), dt.getData('text/plain'));
  });
  // Typing / editing in the box: convert what is shown.
  input.addEventListener('input', () => {
    source = { type: 'html', html: input.innerHTML };
    convert();
  });

  document.getElementById('pasteBtn').addEventListener('click', async () => {
    try {
      let items;
      try {
        items = await navigator.clipboard.read({ unsanitized: ['text/html'] });
      } catch (_) {
        items = await navigator.clipboard.read();
      }
      let html = '', text = '';
      for (const item of items) {
        if (!html && item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
        if (!text && item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
      }
      load(html, text);
    } catch (err) {
      try {
        load('', await navigator.clipboard.readText());
      } catch (_) {
        setStatus('Clipboard blocked: click the box and press Ctrl+V');
      }
    }
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    load('', '');
    input.innerHTML = '';
    input.focus();
  });

  const EXAMPLE_HTML =
    '<h3>Example</h3>' +
    '<p>A 32-bit int holds 2<sup>31</sup> − 1 values; water is H<sub>2</sub>O.</p>' +
    '<p>Quadratic formula: <math><mi>x</mi><mo>=</mo><mfrac><mrow><mo>−</mo><mi>b</mi><mo>±</mo>' +
    '<msqrt><msup><mi>b</mi><mn>2</mn></msup><mo>−</mo><mn>4</mn><mi>a</mi><mi>c</mi></msqrt></mrow>' +
    '<mrow><mn>2</mn><mi>a</mi></mrow></mfrac></math></p>' +
    '<p>Sum: <math><munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover>' +
    '<mi>i</mi><mo>=</mo><mfrac><mrow><mi>n</mi><mo>(</mo><mi>n</mi><mo>+</mo><mn>1</mn><mo>)</mo></mrow><mn>2</mn></mfrac></math></p>' +
    '<ul><li><b>Bold</b> and <i>italic</i> become plain</li><li>Unicode: x² + y³, area = πr²</li>' +
    '<li>LaTeX in text: $e^{i\\pi} + 1 = 0$</li></ul>';

  document.getElementById('exampleBtn').addEventListener('click', () => load(EXAMPLE_HTML));

  async function copy() {
    try {
      await navigator.clipboard.writeText(output.value);
    } catch (_) {
      output.select();
      document.execCommand('copy');
    }
    setStatus('Copied ✓', true);
  }
  document.getElementById('copyBtn').addEventListener('click', copy);

  document.getElementById('downloadBtn').addEventListener('click', () => {
    const blob = new Blob([output.value], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'plain-text.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  function setSymbols(ascii) {
    opt.ascii.setAttribute('aria-pressed', String(ascii));
    opt.unicode.setAttribute('aria-pressed', String(!ascii));
    convert();
  }
  opt.unicode.addEventListener('click', () => setSymbols(false));
  opt.ascii.addEventListener('click', () => setSymbols(true));
  [opt.scripts, opt.latex, opt.links].forEach(c => c.addEventListener('change', convert));

  // remember option choices
  const KEY = 'rich-to-plain-options';
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) {
      opt.scripts.checked = saved.scripts;
      opt.latex.checked = saved.latex;
      opt.links.checked = saved.links;
      opt.autoCopy.checked = saved.autoCopy;
      setSymbols(saved.ascii);
    }
  } catch (_) {}
  document.querySelector('.options').addEventListener('change', save);
  document.querySelector('.options').addEventListener('click', save);
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        ascii: options().ascii, scripts: opt.scripts.checked, latex: opt.latex.checked,
        links: opt.links.checked, autoCopy: opt.autoCopy.checked,
      }));
    } catch (_) {}
  }

  // Light/dark theme: light by default, then whatever the user last picked.
  const THEME_KEY = 'rich-to-plain-theme';
  const themeToggle = document.getElementById('themeToggle');

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const label = 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' theme';
    themeToggle.setAttribute('aria-label', label);
    themeToggle.title = label;
  }

  setTheme(document.documentElement.dataset.theme);
  themeToggle.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
  });

  // Start with the example showing; show() so opening the page never auto-copies.
  show(EXAMPLE_HTML);
  input.focus();
})();
