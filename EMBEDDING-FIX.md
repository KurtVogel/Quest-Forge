# Embedding Fix — June 20, 2026

## Problem
Quest Forge was calling `text-embedding-004`, which Google retired on **January 14, 2026**.
Embedding failures were silently swallowed, so semantic RAG was broken without any visible error.

## Verified Model (GA, June 2026)
- **Model:** `gemini-embedding-001`
- `gemini-embedding-2` also exists but is Public Preview only — went with GA.
- `text-embedding-004` is gone from current Google docs entirely.
- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent` (unchanged)
- Request uses snake_case `output_dimensionality` (verified via official curl example)
- Default output is 3072-dim; 768 is a supported truncation and keeps the existing IndexedDB shape
- Response shape `data.embedding.values` is unchanged — existing parsing still works

Sources:
- https://ai.google.dev/gemini-api/docs/embeddings
- https://ai.google.dev/gemini-api/docs/models/gemini-embedding-001
- https://github.com/google-gemini/cookbook/blob/main/quickstarts/rest/Embeddings_REST.ipynb

## Files Changed

### `src/llm/providers/gemini.js`
- Switched `GEMINI_EMBED_MODEL` from `text-embedding-004` → `gemini-embedding-001`
- Added `output_dimensionality: 768` to the request body
- Replaced silent `return null` failures with structured `console.error` logs including:
  HTTP status, status text, response body snippet, and caught exceptions
  → Future model deprecations will now surface in the console instead of dying quietly

### `src/engine/vectorMemory.js`
- Bumped `EMBED_DB_VERSION` from `1` → `2`
- Added `onupgradeneeded` step that drops and recreates the IndexedDB store
- **Critical:** old `text-embedding-004` vectors live in a different semantic space than
  `gemini-embedding-001` vectors — mixing them silently degrades RAG retrieval quality.
  The version bump auto-invalidates stale caches on first load after deploy.
- Header comment updated

### `CLAUDE.md` + `AGENTS.md`
- Updated the RAG line to reflect new model, `output_dimensionality` param, and retirement date

## Test Results
- `npm run lint` — ✅ passes clean
- Real API test not run in this session (key not available to CLI process)

## Follow-up Notes
- IndexedDB vector store will auto-clear/recreate on first load after deploy (version bump handles it)
- No manual cache clearing needed by the player
- Verify with a live session that embeddings now succeed and RAG retrieval resumes
