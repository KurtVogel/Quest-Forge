/**
 * The post-build preload guard (2026-09-22 cloud-sync audit P2): the matcher
 * on synthetic entry HTML, and the real `dist/index.html` when a build is
 * present — nothing may preload or statically load `vendor-firebase`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ON_DEMAND_CHUNKS, findPreloadedChunks } from './check-dist-preload.mjs';

const distIndex = resolve(import.meta.dirname, '..', 'dist', 'index.html');

describe('findPreloadedChunks', () => {
    it('flags a modulepreload link or a module script that names an on-demand chunk', () => {
        const html = `
            <script type="module" crossorigin src="/assets/index-Ab12Cd34.js"></script>
            <link rel="modulepreload" crossorigin href="/assets/vendor-react-LpTQ6PvD.js">
            <link rel="modulepreload" crossorigin href="/assets/vendor-firebase-BPxbd1qn.js">
            <link rel="stylesheet" crossorigin href="/assets/index-Ef56Gh78.css">`;
        expect(findPreloadedChunks(html)).toEqual([{ chunk: 'vendor-firebase', ref: '/assets/vendor-firebase-BPxbd1qn.js' }]);
        expect(findPreloadedChunks('<script type="module" src="/assets/vendor-firebase-x.js"></script>')).toHaveLength(1);
    });

    it('passes an entry that preloads only React and the app chunk', () => {
        const html = `
            <script type="module" crossorigin src="/assets/index-Ab12Cd34.js"></script>
            <link rel="modulepreload" crossorigin href="/assets/vendor-react-LpTQ6PvD.js">`;
        expect(findPreloadedChunks(html)).toEqual([]);
        // A stylesheet or an unrelated tag naming the chunk is not a preload.
        expect(findPreloadedChunks('<link rel="stylesheet" href="/assets/vendor-firebase-x.css">')).toEqual([]);
        expect(findPreloadedChunks('')).toEqual([]);
    });

    it('guards the built dist/index.html when a build is present', () => {
        if (!existsSync(distIndex)) return; // no build in this checkout — the script guards `npm run build`
        const html = readFileSync(distIndex, 'utf8');
        expect(html).toContain('modulepreload'); // sanity: the entry does preload something (React)
        expect(findPreloadedChunks(html)).toEqual([]);
        for (const chunk of ON_DEMAND_CHUNKS) expect(html).not.toContain(`/${chunk}-`);
    });
});
