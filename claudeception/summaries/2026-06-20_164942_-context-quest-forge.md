Lint clean. Summary:

## What changed

**Research findings** (verified against Google AI docs + cookbook, June 2026):
- `text-embedding-004` retired 2026-01-14 ΓÇö confirmed gone from current docs.
- GA replacement: **`gemini-embedding-001`** (also: `gemini-embedding-2` exists but is only Public Preview ΓÇö went with GA).
- Endpoint unchanged: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent`.
- Request uses **snake_case** `output_dimensionality` (verified via official curl example). Default output is 3072-dim; recommended truncations are 768/1536/3072. 768 keeps existing IndexedDB shape.
- Response shape `data.embedding.values` is unchanged ΓÇö existing parsing still works.

**Code changes:**
- `src/llm/providers/gemini.js` ΓÇö Switched `GEMINI_EMBED_MODEL` from `text-embedding-004` to `gemini-embedding-001`; added `output_dimensionality: 768` to the request body; replaced silent `return null` failures with structured `console.error` logs including HTTP status, status text, response body snippet, and caught exceptions ΓÇö so future model deprecations surface in the console instead of dying quietly.
- `src/engine/vectorMemory.js` ΓÇö Bumped `EMBED_DB_VERSION` from 1 ΓåÆ 2 and added an `onupgradeneeded` step that drops & recreates the store. **Critical**: old cached `text-embedding-004` vectors live in a different semantic space than `gemini-embedding-001` vectors, so mixing them would silently degrade RAG retrieval quality. The bump auto-invalidates stale caches on first load after deploy. Header comment updated.
- `CLAUDE.md` + `AGENTS.md` (twins) ΓÇö Updated the RAG line to reflect new model + dim parameter + retirement date.

**Verification:** `npm run lint` passes clean.

Sources:
- [Gemini API embeddings docs](https://ai.google.dev/gemini-api/docs/embeddings)
- [gemini-embedding-001 model card](https://ai.google.dev/gemini-api/docs/models/gemini-embedding-001)
- [google-gemini/cookbook Embeddings_REST.ipynb](https://github.com/google-gemini/cookbook/blob/main/quickstarts/rest/Embeddings_REST.ipynb)
