#!/usr/bin/env node
/**
 * Post-build guard (2026-09-22 cloud-sync audit P2): the Firebase SDK is
 * bring-your-own and opt-in, so its vendor chunk must load ON DEMAND, never
 * ride every player's boot. `dist/index.html` used to `modulepreload` the
 * 330 KB / 102.5 KB-gzip `vendor-firebase` chunk beside React (23 % of all
 * shipped JS) because three modules imported the SDK statically. This script
 * fails the build if the entry HTML ever preloads or statically loads that
 * chunk again. Runs from `npm run build` and `npm run check:dist`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Chunk names (vite.config.js manualChunks) that must never be preloaded by the entry. */
export const ON_DEMAND_CHUNKS = ['vendor-firebase'];

/**
 * Every `<link rel="modulepreload">` href and `<script type="module" src>`
 * the entry HTML carries that names one of the on-demand chunks.
 */
export function findPreloadedChunks(html, chunkNames = ON_DEMAND_CHUNKS) {
    const hits = [];
    const tagPattern = /<(?:link|script)\b[^>]*>/gi;
    for (const tag of String(html).match(tagPattern) || []) {
        const isPreload = /\brel\s*=\s*["']?modulepreload["']?/i.test(tag);
        const isModuleScript = /<script\b/i.test(tag) && /\btype\s*=\s*["']?module["']?/i.test(tag);
        if (!isPreload && !isModuleScript) continue;
        const ref = tag.match(/\b(?:href|src)\s*=\s*["']([^"']+)["']/i)?.[1];
        if (!ref) continue;
        for (const name of chunkNames) {
            if (ref.includes(`/${name}-`) || ref.includes(`/${name}.`)) hits.push({ chunk: name, ref });
        }
    }
    return hits;
}

export function checkDistPreload(distIndexPath = resolve('dist', 'index.html')) {
    const html = readFileSync(distIndexPath, 'utf8');
    return findPreloadedChunks(html);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
    const hits = checkDistPreload();
    if (hits.length > 0) {
        console.error('check-dist-preload: dist/index.html preloads an on-demand chunk:');
        for (const { chunk, ref } of hits) console.error(`  ${chunk}: ${ref}`);
        console.error('The Firebase SDK must be reached only through a dynamic import() (see src/config/firebase.js).');
        process.exit(1);
    }
    console.log(`check-dist-preload: OK — no ${ON_DEMAND_CHUNKS.join(', ')} preload in dist/index.html`);
}
