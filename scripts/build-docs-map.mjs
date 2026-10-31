#!/usr/bin/env node
/**
 * Generates docs/map.html — the human-readable view of the architecture map — from the
 * Markdown sources, so the diagrams have ONE source of truth:
 *
 *   docs/ARCHITECTURE.md      → the bird's-eye bullets + the container diagram
 *   docs/flows/*.md           → every Mermaid block, under its heading, with the intro paragraph
 *
 * Usage: node scripts/build-docs-map.mjs    (re-run after editing any of those files)
 *
 * The page loads Mermaid from a CDN, follows the OS light/dark preference with a manual
 * toggle, and carries a table of contents. No other dependencies.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const FLOWS = join(DOCS, 'flows');
const OUT = join(DOCS, 'map.html');
const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const escapeHtml = (s) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Inline Markdown: bold, code spans, links, italics. Enough for intros and bullets. */
function inline(md) {
    let s = escapeHtml(md);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return s;
}

/** Split a Markdown file into an ordered list of { kind, heading?, text } segments. */
function segments(md) {
    const out = [];
    const lines = md.split('\n');
    let i = 0;
    let heading = '';
    while (i < lines.length) {
        const line = lines[i];
        if (line.startsWith('```mermaid')) {
            const start = i + 1;
            let j = start;
            while (j < lines.length && !lines[j].startsWith('```')) j += 1;
            out.push({ kind: 'mermaid', heading, text: lines.slice(start, j).join('\n') });
            i = j + 1;
            continue;
        }
        const h = /^(#{1,3})\s+(.*)$/.exec(line);
        if (h) {
            heading = h[2].trim();
            out.push({ kind: 'heading', level: h[1].length, text: heading });
            i += 1;
            continue;
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
            const items = [];
            while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* ') || /^\s{2,}\S/.test(lines[i]))) {
                if (/^\s{2,}\S/.test(lines[i])) items[items.length - 1] += ' ' + lines[i].trim();
                else items.push(lines[i].slice(2).trim());
                i += 1;
            }
            out.push({ kind: 'list', heading, items });
            continue;
        }
        if (line.startsWith('|')) {
            const rows = [];
            while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i]); i += 1; }
            out.push({ kind: 'table', heading, rows });
            continue;
        }
        if (line.trim() === '') { i += 1; continue; }
        const para = [];
        while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('#') && !lines[i].startsWith('```') && !lines[i].startsWith('- ') && !lines[i].startsWith('|')) {
            para.push(lines[i].trim());
            i += 1;
        }
        out.push({ kind: 'para', heading, text: para.join(' ') });
    }
    return out;
}

function renderTable(rows) {
    const cells = (r) => r.slice(1, -1).split('|').map(c => inline(c.trim()));
    const head = cells(rows[0]);
    const body = rows.slice(2).map(cells);
    return `<table><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${
        body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function renderList(items) {
    return `<ul>${items.map(it => `<li>${inline(it)}</li>`).join('')}</ul>`;
}

function slug(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function mermaidBlock(code) {
    return `<figure class="fig"><pre class="mermaid-src" hidden>${escapeHtml(code)}</pre><div class="diagram fit"></div>`
        + `<button class="fit-toggle" type="button" aria-pressed="false">Actual size</button></figure>`;
}

// ---- ARCHITECTURE.md: bird's-eye + container diagram -----------------------------------
const arch = segments(read(join(DOCS, 'ARCHITECTURE.md')));
const birdsEye = arch.find(s => s.kind === 'list' && s.heading === "Bird's-eye view");
const container = arch.find(s => s.kind === 'mermaid' && s.heading === 'Container diagram');
const invariants = arch.find(s => s.kind === 'list' && s.heading === 'Architectural invariants');
if (!birdsEye || !container) throw new Error('ARCHITECTURE.md: bird\'s-eye list or container diagram not found');

// ---- flows/*.md ----------------------------------------------------------------------
const flowFiles = readdirSync(FLOWS).filter(f => f.endsWith('.md')).sort((a, b) => {
    const order = ['player-turn.md', 'combat-round.md', 'memory-system.md', 'hidden-fronts.md', 'session-lifecycle.md'];
    return order.indexOf(a) - order.indexOf(b);
});
const flows = flowFiles.map(f => {
    const segs = segments(read(join(FLOWS, f)));
    const title = segs.find(s => s.kind === 'heading' && s.level === 1)?.text ?? basename(f, '.md');
    const intro = segs.find(s => s.kind === 'para' && s.heading === title)?.text ?? '';
    const shortTitle = title.replace(/^Flow:\s*/, '');
    return { file: f, id: slug(basename(f, '.md')), h1: title, title: shortTitle.charAt(0).toUpperCase() + shortTitle.slice(1), intro, segs };
});

// ---- page ----------------------------------------------------------------------------
const toc = [
    { id: 'birds-eye', label: "Bird's-eye view" },
    { id: 'container', label: 'Container diagram' },
    { id: 'invariants', label: 'Invariants' },
    ...flows.map(f => ({ id: f.id, label: f.title })),
];

function renderFlow(f) {
    const parts = [];
    parts.push(`<section id="${f.id}"><h2>${inline(f.title)}</h2>`);
    if (f.intro) parts.push(`<p class="intro">${inline(f.intro)}</p>`);
    let lastHeading = null;
    for (const s of f.segs) {
        if (s.kind === 'mermaid') {
            if (s.heading && s.heading !== lastHeading && s.heading !== f.h1) {
                parts.push(`<h3>${inline(s.heading)}</h3>`);
                lastHeading = s.heading;
            }
            parts.push(mermaidBlock(s.text));
        } else if (s.kind === 'table') {
            if (s.heading && s.heading !== lastHeading) { parts.push(`<h3>${inline(s.heading)}</h3>`); lastHeading = s.heading; }
            parts.push(renderTable(s.rows));
        }
    }
    parts.push(`<p class="more">Step-by-step notes and invariants: <code>docs/flows/${f.file}</code></p></section>`);
    return parts.join('\n');
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quest Forge — Architecture Map</title>
<meta name="description" content="The human-readable view of docs/ARCHITECTURE.md and docs/flows/: the bird's-eye view, the container diagram and every flow diagram, rendered with Mermaid.">
<style>
  :root {
    --bg: #f7f5f0; --fg: #1d1c1a; --muted: #5d5a55; --card: #ffffff; --line: #d9d4ca;
    --accent: #7a3e1d; --code-bg: #efebe3; --link: #1f4e79;
  }
  :root:not([data-theme="light"]) { color-scheme: light dark; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #17171f; --fg: #e8e4dc; --muted: #a9a49b; --card: #21212b; --line: #343442;
      --accent: #e0a070; --code-bg: #2a2a36; --link: #8db4e2;
    }
  }
  :root[data-theme="dark"] {
    --bg: #17171f; --fg: #e8e4dc; --muted: #a9a49b; --card: #21212b; --line: #343442;
    --accent: #e0a070; --code-bg: #2a2a36; --link: #8db4e2;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  a { color: var(--link); }
  code { background: var(--code-bg); padding: 0.05em 0.35em; border-radius: 4px; font-size: 0.92em; }
  header { padding: 28px 16px 12px; max-width: 1180px; margin: 0 auto; display: flex; flex-wrap: wrap; gap: 12px; align-items: baseline; justify-content: space-between; }
  header h1 { margin: 0; font-size: 1.6rem; }
  header p { margin: 0; color: var(--muted); }
  .toggle { border: 1px solid var(--line); background: var(--card); color: var(--fg); border-radius: 999px; padding: 6px 14px; cursor: pointer; font: inherit; }
  .layout { max-width: 1180px; margin: 0 auto; padding: 0 16px 48px; display: grid; grid-template-columns: 220px 1fr; gap: 28px; }
  nav { position: sticky; top: 16px; align-self: start; border-right: 1px solid var(--line); padding-right: 12px; }
  nav h2 { font-size: 0.8rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 8px 0; }
  nav ol { list-style: none; padding: 0; margin: 0; }
  nav li { margin: 6px 0; } nav a { text-decoration: none; }
  section { margin: 0 0 40px; }
  h2 { margin: 0 0 8px; font-size: 1.35rem; color: var(--accent); }
  h3 { margin: 24px 0 8px; font-size: 1.05rem; }
  .intro, .more { color: var(--muted); }
  .diagram { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; overflow-x: auto; margin: 8px 0 16px; }
  .fig { margin: 0; }
  .diagram svg { height: auto; }
  .diagram.fit svg { max-width: 100%; }
  .fit-toggle { border: 1px solid var(--line); background: var(--card); color: var(--muted); border-radius: 999px; padding: 3px 10px; font: inherit; font-size: 0.8em; cursor: pointer; margin: -8px 0 16px; }
  .diagram.error { color: #b00020; white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 0.85em; }
  table { border-collapse: collapse; width: 100%; font-size: 0.92em; margin: 8px 0 16px; display: block; overflow-x: auto; }
  th, td { border: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: var(--code-bg); }
  ul.birds li { margin: 8px 0; }
  @media (max-width: 820px) {
    .layout { grid-template-columns: 1fr; }
    nav { position: static; border-right: 0; border-bottom: 1px solid var(--line); padding: 0 0 12px; }
    nav ol { display: flex; flex-wrap: wrap; gap: 4px 14px; }
  }
</style>
</head>
<body>
<header>
  <div>
    <h1>Quest Forge — Architecture Map</h1>
    <p>Generated from <code>docs/ARCHITECTURE.md</code> and <code>docs/flows/</code> by <code>scripts/build-docs-map.mjs</code>. Edit the Markdown, not this page.</p>
  </div>
  <button class="toggle" id="theme" type="button" aria-label="Toggle light or dark theme">Theme: auto</button>
</header>
<div class="layout">
<nav aria-label="Contents">
  <h2>Contents</h2>
  <ol>${toc.map(t => `<li><a href="#${t.id}">${escapeHtml(t.label)}</a></li>`).join('')}</ol>
</nav>
<main>
<section id="birds-eye">
  <h2>Bird's-eye view</h2>
  <ul class="birds">${birdsEye.items.map(it => `<li>${inline(it)}</li>`).join('')}</ul>
</section>
<section id="container">
  <h2>Container diagram</h2>
  <p class="intro">What runs where. Everything inside the browser box ships as static files; the player's own keys reach the providers directly.</p>
  ${mermaidBlock(container.text)}
</section>
<section id="invariants">
  <h2>Invariants</h2>
  ${invariants ? renderList(invariants.items) : ''}
  <p class="more">Deliberate absences, layer boundaries and cross-cutting concerns: <code>docs/ARCHITECTURE.md</code></p>
</section>
${flows.map(renderFlow).join('\n')}
</main>
</div>
<script type="module">
  import mermaid from '${MERMAID_URL}';
  const root = document.documentElement;
  const button = document.getElementById('theme');
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const stored = (() => { try { return localStorage.getItem('qf-map-theme'); } catch { return null; } })();
  let mode = stored === 'light' || stored === 'dark' ? stored : 'auto';

  const isDark = () => mode === 'dark' || (mode === 'auto' && media.matches);

  async function render() {
    if (mode === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', mode);
    button.textContent = 'Theme: ' + mode;
    mermaid.initialize({ startOnLoad: false, theme: isDark() ? 'dark' : 'default', securityLevel: 'loose', flowchart: { htmlLabels: true, useMaxWidth: false }, sequence: { useMaxWidth: false }, state: { useMaxWidth: false } });
    const sources = Array.from(document.querySelectorAll('.mermaid-src'));
    for (const [index, src] of sources.entries()) {
      const target = src.nextElementSibling;
      target.classList.remove('error');
      try {
        const { svg, bindFunctions } = await mermaid.render('d' + index + '-' + Date.now(), src.textContent);
        target.innerHTML = svg;
        bindFunctions?.(target);
      } catch (err) {
        target.classList.add('error');
        target.textContent = 'Mermaid could not render this diagram: ' + (err?.message || err);
        console.error('map.html diagram', index, err);
      }
    }
  }

  button.addEventListener('click', () => {
    mode = mode === 'auto' ? 'dark' : mode === 'dark' ? 'light' : 'auto';
    try { if (mode === 'auto') localStorage.removeItem('qf-map-theme'); else localStorage.setItem('qf-map-theme', mode); } catch { /* private window */ }
    render();
  });
  media.addEventListener('change', () => { if (mode === 'auto') render(); });
  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('.fit-toggle');
    if (!toggle) return;
    const diagram = toggle.previousElementSibling;
    const fit = diagram.classList.toggle('fit');
    toggle.textContent = fit ? 'Actual size' : 'Fit to width';
    toggle.setAttribute('aria-pressed', String(!fit));
  });
  render();
</script>
</body>
</html>
`;

writeFileSync(OUT, html, 'utf8');
console.log(`wrote ${OUT} — ${flows.length} flows, ${1 + flows.reduce((n, f) => n + f.segs.filter(s => s.kind === 'mermaid').length, 0)} diagrams`);
