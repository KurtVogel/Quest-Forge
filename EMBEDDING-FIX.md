# Embedding Fix — June 20, 2026

## Problem
Quest Forge was calling `text-embedding-004`, which Google retired on **January 14, 2026**.
Embedding failures were silently swallowed, so semantic RAG was broken without any visible error.

## Current Model (verified against Google documentation, June 2026)
- **Model:** `gemini-embedding-2`
- Google schedules `gemini-embedding-001` to shut down on **July 14, 2026** and names
  `gemini-embedding-2` as its replacement.
- `text-embedding-004` is gone from current Google docs entirely.
- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent` (unchanged)
- Request uses snake_case `output_dimensionality` (verified via official curl example)
- Default output is 3072-dim; 768 is a supported truncation and keeps the existing IndexedDB shape
- Response shape `data.embedding.values` is unchanged — existing parsing still works
- Embeddings 2 retrieval is asymmetric: documents use `title: none | text: {content}` and
  queries use `task: search result | query: {content}`. It does not use the older `task_type` field.

Sources:
- https://ai.google.dev/gemini-api/docs/embeddings
- https://ai.google.dev/gemini-api/docs/deprecations
- https://github.com/google-gemini/cookbook/blob/main/quickstarts/rest/Embeddings_REST.ipynb

## Files Changed

### `src/llm/providers/gemini.js`
- Switched `GEMINI_EMBED_MODEL` to `gemini-embedding-2`
- Added `output_dimensionality: 768` to the request body
- Added explicit document/query input formatting and exact response-dimension validation
- Replaced silent `return null` failures with structured `console.error` logs including:
  HTTP status, status text, response body snippet, and caught exceptions
  → Future model deprecations will now surface in the console instead of dying quietly

### `src/engine/vectorMemory.js`
- Bumped `EMBED_DB_VERSION` to `3`
- Added `onupgradeneeded` step that drops and recreates the IndexedDB store
- **Critical:** vectors from different models or input formats live in different semantic spaces;
  mixing them silently degrades RAG retrieval quality.
  The version bump auto-invalidates stale caches on first load after deploy.
- New entries carry a full model/format/dimension schema, and cache loading rejects mismatches.
- Header comment updated

### `CLAUDE.md` + `AGENTS.md`
- Updated the RAG line to reflect new model, `output_dimensionality` param, and retirement date

## Test Results
- `npm test` — 238 passing
- `npm run lint` — passes clean
- `npm run build` — passes
- Focused tests verify the exact Embeddings 2 REST URL/body, 768-dimension enforcement, and
  document/query routing through VectorMemory.

## Follow-up Notes
- IndexedDB vector store will auto-clear/recreate on first load after deploy (version bump handles it)
- No manual cache clearing needed by the player
- Browser smoke testing should confirm that real play produces no Gemini/VectorMemory errors.
