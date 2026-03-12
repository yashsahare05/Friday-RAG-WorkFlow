# Friday � Local RAG Cockpit

Friday is a local-first RAG dashboard for indexing PDF notes, grounding answers in your own documents, and exporting a session report. It includes:
- PDF ingestion with OCR fallback (PyMuPDF for digital PDFs, Tesseract for scanned pages).
- Chunking and vector search with ChromaDB.
- Groq chat completions for question answering.
- Jina embeddings for vector search.
- A Vite + React + Tailwind UI with upload progress, sources panel, and report export.

## Project Structure
- `backend/` FastAPI service for OCR, chunking, embeddings, and chat.
- `frontend/` Vite + React UI.
- `data/` Persistent data directories (ChromaDB, uploads, reports, logs).

## Prerequisites
- Python 3.10+ recommended.
- Node.js 18+ recommended.
- Tesseract OCR installed (only needed for scanned PDFs).

## Environment Setup

### Backend `.env`
Create or edit `backend/.env` with your keys and settings:

```env
CHROMA_PATH=../data/chroma_db
UPLOAD_DIR=../data/uploads
REPORTS_DIR=../data/reports
LOGS_DIR=../data/logs
FASTAPI_URL=http://localhost:8000

# Groq LLM
GROQ_API_KEY=your_groq_key_here
GROQ_MODEL=openai/gpt-oss-120b
GROQ_BASE_URL=https://api.groq.com/openai/v1

# Jina embeddings
JINA_API_KEY=your_jina_key_here
JINA_MODEL=jina-embeddings-v2-base-en
JINA_API_URL=https://api.jina.ai/v1/embeddings
JINA_TASK=
JINA_USE_PREFIXES=true

CHUNK_SIZE=300
CHUNK_OVERLAP=50
TOP_K=5
SIMILARITY_THRESHOLD=0.35
REINDEX_INTERVAL_MINUTES=30
USE_CLOUD_OCR=false
TESSERACT_PATH=C:\\Program Files\\Tesseract-OCR\\tesseract.exe
```

### Frontend `.env`
Edit `frontend/.env`:

```env
VITE_API_URL=http://localhost:8000
```

## Install and Run

### Backend
If you are on Windows and the repo already contains a venv, you can use the helper:

```powershell
backend\activate.bat
python backend\main.py
```

Or manually:

```powershell
cd backend
.\venv\Scripts\activate
python main.py
```

The API will start on port 8000.

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

The UI runs on port 5173.

## API Overview
- `POST /upload` Upload a PDF for indexing (async job).
- `GET /upload/status/{job_id}` Indexing progress updates.
- `POST /chat` Ask a question grounded in your notes.
- `GET /files` List indexed sources.
- `DELETE /reset` Clear the database and session log.
- `GET /report` Download a session report PDF.
- `GET /health` Service health and model status.

## Notes and Tips
- If you change embedding models, ChromaDB may require a reset if the embedding dimension changes. Use the UI �Reset Database� button or call `DELETE /reset`.
- For scanned PDFs, ensure Tesseract is installed and `TESSERACT_PATH` is valid.
- If you see `Failed to fetch` in the UI, make sure the backend is running and `VITE_API_URL` is correct.

## Tech Stack
- Backend: FastAPI, ChromaDB, PyMuPDF, Tesseract OCR, ReportLab, Requests.
- Frontend: React, Vite, Tailwind CSS.

## License
Internal / hackathon use.
