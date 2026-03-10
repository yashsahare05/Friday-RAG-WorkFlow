# Friday Frontend (Single‑Page Dashboard) — Implementation Plan

## Summary
Build a Vite + React + TypeScript single‑page frontend for the local **Friday** RAG system. The UI will cover PDF upload/indexing, chat Q&A, file sources, health, reset, and report download. It will follow the “bold Friday” visual direction: distinctive typography, warm gradient background, intentional layout, and subtle motion.

## Assumptions & Decisions
- **Stack:** Vite + React + TypeScript.
- **Layout:** Single‑page dashboard.
- **Style direction:** Bold Friday brand.
- **API base URL:** default `http://localhost:8000`, configurable via `VITE_API_URL`.

## Public API / Interface Changes
- Add frontend env var: `VITE_API_URL` (new).
- No backend API changes.

## Implementation Steps
1. **Scaffold frontend app**
   - In `frontend/`, initialize Vite React + TS.
   - Ensure `frontend` is the project root with `package.json`, `vite.config.ts`, `src/`.

2. **Environment config**
   - Add `frontend/.env` with `VITE_API_URL=http://localhost:8000`.
   - In code, read `import.meta.env.VITE_API_URL` with fallback to `http://localhost:8000`.

3. **API client layer**
   - Create `src/lib/api.ts` with typed functions:
     - `health(): Promise<{status: string; ollama: boolean; model: string}>`
     - `uploadPdf(file: File): Promise<{status: string; filename: string; pages: number; chunks: number; message: string}>`
     - `chat(question: string, history: {question: string; answer: string}[]): Promise<{answer: string; sources: {page_num: number; source: string; excerpt: string}[]; confidence: number}>`
     - `getFiles(): Promise<{source: string; chunk_count: number}[]>`
     - `reset(): Promise<{status: string; message: string}>`
     - `downloadReport(): Promise<Blob>` (GET `/report`)
   - Implement a shared `fetchJson` helper with good error messages.
   - For `/upload`, use `FormData` and do not set `Content-Type`.

4. **State model (App)**
   - `health` state: `{ollama: boolean; model: string; status: string}`.
   - `files` state: list of sources + chunk counts.
   - `upload` state: selected file, loading, error, success message.
   - `chat` state: messages array (user/assistant), `history` derived from last Q/A pairs, loading, error, confidence, sources.
   - `report` state: downloading, error.
   - `reset` state: loading, error.

5. **UI layout (single page)**
   - **Header:** Friday logo/wordmark, health indicator, model name.
   - **Left column (Operations):**
     - Upload card (file input + button + counts).
     - Files card (source list + chunk counts + refresh button).
     - Actions card (Reset DB + Download Report).
   - **Right column (Chat):**
     - Conversation panel with message bubbles.
     - Sources/Confidence panel for latest answer.
     - Input area with question textbox and send button.

6. **Chat flow**
   - On send:
     - Append user message.
     - Build `history` from existing Q/A pairs.
     - Call `/chat`.
     - Append assistant message and store `confidence` + `sources`.
   - If confidence low or answer is “I don’t have enough information…” show a neutral alert style.

7. **Upload flow**
   - Validate file extension before upload.
   - Call `/upload`.
   - On success, refresh `/files`.

8. **Report flow**
   - Call `/report` and stream to a downloadable blob.
   - Handle 404 by showing “No session data available.”

9. **Reset flow**
   - Confirm before reset.
   - Call `/reset`, clear chat + sources + files state.

10. **Styling**
    - Add `src/styles/theme.css` with CSS variables (brand colors, neutrals, spacing).
    - Typography: import a distinctive sans (e.g., `Space Grotesk`) and a mono (e.g., `IBM Plex Mono`) with system fallbacks.
    - Background: subtle gradient + soft shapes/pattern.
    - Cards: elevated with light shadow; avoid flat white/purple defaults.
    - Motion: small transitions for card load and chat message appearance.

11. **Wiring & integration**
    - Compose `App.tsx` to render layout and wire all handlers.
    - Ensure CORS hits `http://localhost:5173` from Vite.

## Testing & Acceptance Criteria
- **Local run:** `npm install` then `npm run dev` in `frontend`.
- **Health:** shows “Ollama running / not running” based on `/health`.
- **Upload:** PDF uploads, triggers OCR + chunking, shows chunk count.
- **Chat:** question returns answer, shows confidence + sources.
- **Files:** list updates after upload.
- **Reset:** clears DB and UI state.
- **Report:** downloads PDF or shows “No session data available.”
- **No console errors** in the browser.

## Edge Cases & Failure Handling
- Ollama down: health indicator shows warning; chat requests display readable error.
- Upload non‑PDF: client blocks with message; server also rejects.
- Empty question: client blocks with message.
- Report without session data: show friendly error.
- Network failure: show alert in status bar.

## Deliverables
- `frontend/` Vite React + TS project
- API client layer
- Single‑page dashboard UI with Friday branding
- Styling and lightweight motion
