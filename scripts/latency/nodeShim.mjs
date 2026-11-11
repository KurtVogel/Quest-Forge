/**
 * Lets the app's own modules run under plain Node exactly as they run in a
 * production build.
 *
 * `src/llm/adapter.js` reads `import.meta.env.DEV` after a stream completes.
 * Vite defines that object in the browser; plain Node does not, so the app's
 * `streamMessage` would throw on its last line. This load hook gives the few
 * `src/` files that read `import.meta.env` the object a production build has
 * (DEV false). Nothing else in the source is touched, and nothing in `src/`
 * has to change for the harness to run.
 *
 * Call `installNodeShim()` BEFORE the first dynamic `import()` of anything
 * under `src/` — a static import would be loaded before the hook exists.
 */
import { registerHooks } from 'node:module';

const PRODUCTION_ENV = '({ DEV: false, PROD: true, MODE: "production", SSR: true })';

let installed = false;

export function installNodeShim() {
    if (installed) return;
    installed = true;
    registerHooks({
        load(url, context, nextLoad) {
            const result = nextLoad(url, context);
            if (!url.startsWith('file:') || !url.includes('/src/') || result.source == null) return result;
            const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
            if (!source.includes('import.meta.env')) return result;
            return { ...result, source: source.replaceAll('import.meta.env', PRODUCTION_ENV) };
        },
    });
}
