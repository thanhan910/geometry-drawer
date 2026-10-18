// Search everything: tools, menu actions, demos, templates and commands, from
// one box (Ctrl+K or the Search button). UI only: app.js supplies the entries.
//
//   const palette = createPalette({ entries: () => [...], guide: [...] });
//   palette.open(), palette.close(), palette.isOpen
//   entry: { kind, name, hint, words, kbd, run }   words = extra search terms

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const KIND_ORDER = { Tool: 3, Action: 2, Demo: 1, Template: 1, Command: 0 };

function score(e, words) {
  let s = 0;
  for (const w of words) {
    if (!e._hay.includes(w)) return -1;
    if (e._name.startsWith(w)) s += 8;
    else if (e._nameWords.some(x => x.startsWith(w))) s += 6;
    else if (e._name.includes(w)) s += 4;
    else if (e._words.includes(w)) s += 3;
    else s += 1;
  }
  return s * 10 + (KIND_ORDER[e.kind] || 0);
}

export function createPalette({ entries, guide = [] }) {
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const root = mk('div'); root.id = 'palette'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Search tools and actions');
  const box = mk('div', 'pbox');
  const input = mk('input'); input.id = 'pq'; input.type = 'search'; input.autocomplete = 'off'; input.spellcheck = false;
  input.placeholder = 'Search tools, actions, commands… e.g. circle, midpoint, eraser, export';
  input.setAttribute('aria-label', 'Search');
  const list = mk('div'); list.id = 'pres'; list.setAttribute('role', 'listbox');
  const foot = mk('div', 'pfoot2', '↑ ↓ to move · Enter to choose · Esc to close');
  box.append(input, list, foot);
  root.append(box);
  document.body.append(root);

  let all = [], shown = [], sel = 0;
  const prepare = es => es.map(e => {
    const name = norm(e.name);
    return { ...e, _name: name, _nameWords: name.split(/[^a-z0-9]+/).filter(Boolean), _words: norm(e.words), _hay: [name, norm(e.words), norm(e.hint), norm(e.kind)].join(' ') };
  });

  function render() {
    const q = norm(input.value).trim();
    list.textContent = '';
    if (!q) {
      if (guide.length) {
        const g = mk('div', 'pguide');
        g.append(mk('div', 'pgh', 'Getting started'));
        const ul = mk('ul');
        for (const line of guide) ul.append(mk('li', null, line));
        g.append(ul);
        list.append(g);
      }
      shown = all.filter(e => e.kind === 'Action');
      if (shown.length) list.append(mk('div', 'pgh', 'Actions'));
    } else {
      const words = q.split(/\s+/);
      shown = all.map(e => [score(e, words), e]).filter(([s]) => s >= 0).sort((a, b) => b[0] - a[0]).slice(0, 60).map(([, e]) => e);
      if (!shown.length) list.append(mk('div', 'pnone', `Nothing matches "${input.value.trim()}". Try a shorter word, or press ? for every shortcut and command.`));
    }
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    shown.forEach((e, i) => {
      const b = mk('button', 'pi' + (i === sel ? ' on' : ''));
      b.type = 'button'; b.setAttribute('role', 'option');
      const k = mk('span', 'pk ' + e.kind.toLowerCase(), e.kind);
      const t = mk('span', 'pt');
      t.append(mk('b', null, e.name));
      if (e.hint) t.append(mk('small', null, e.hint));
      b.append(k, t);
      if (e.kbd) b.append(mk('kbd', null, e.kbd));
      b.addEventListener('click', () => pick(e));
      b.addEventListener('mousemove', () => { if (sel !== i) { sel = i; mark(); } });
      list.append(b);
    });
  }
  const mark = () => list.querySelectorAll('.pi').forEach((b, i) => { b.classList.toggle('on', i === sel); if (i === sel) b.scrollIntoView({ block: 'nearest' }); });
  function pick(e) { close(); e.run(); }

  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); mark(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); if (shown[sel]) pick(shown[sel]); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); }
  });
  root.addEventListener('click', ev => { if (ev.target === root) close(); });

  function open(query = '') {
    all = prepare(entries());
    input.value = query; sel = 0;
    root.hidden = false;
    render();
    input.focus();
  }
  function close() { root.hidden = true; }
  return { open, close, get isOpen() { return !root.hidden; } };
}
