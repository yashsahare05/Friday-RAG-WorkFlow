import os
import shutil
import datetime
import asyncio
import threading
import uuid
from contextlib import asynccontextmanager
from typing import Any, Optional

import uvicorn
from fastapi import FastAPI, UploadFile, File, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

import ocr
import chunker
import vectorstore
import qa
import config


@asynccontextmanager
async def lifespan(app: FastAPI):
    if config.GROQ_API_KEY:
        print("[STARTUP] Groq API key detected")
    else:
        print("[STARTUP] WARNING: GROQ_API_KEY is not set")

    if config.JINA_API_KEY:
        print("[STARTUP] Jina API key detected")
    else:
        print("[STARTUP] WARNING: JINA_API_KEY is not set")

    print("[STARTUP] Friday API ready at http://localhost:8000")
    yield


app = FastAPI(lifespan=lifespan)

index_jobs: dict[str, dict[str, Any]] = {}
index_lock = threading.Lock()


def _set_job(job_id: str, data: dict[str, Any]) -> None:
    with index_lock:
        index_jobs[job_id] = data


def _update_job(job_id: str, **updates: Any) -> None:
    with index_lock:
        job = index_jobs.get(job_id)
        if job is None:
            return
        job.update(updates)
        job["updated_at"] = datetime.datetime.utcnow().isoformat()


def _get_job(job_id: str) -> Optional[dict[str, Any]]:
    with index_lock:
        job = index_jobs.get(job_id)
        if job is None:
            return None
        return dict(job)


def _scale_progress(done: int, total: int, start: int, end: int) -> int:
    if total <= 0:
        return end
    ratio = max(0.0, min(float(done) / float(total), 1.0))
    return int(start + (end - start) * ratio)


def _process_upload(job_id: str, destination: str, safe_name: str) -> None:
    try:
        _update_job(job_id, status="processing", phase="ocr", progress=0)

        def ocr_progress(done: int, total: int, method: str) -> None:
            progress = _scale_progress(done, total, 0, 40)
            _update_job(
                job_id,
                phase=f"ocr ({method})",
                progress=progress,
                pages_total=total,
                pages_done=done,
            )

        pages = ocr.extract_text_from_pdf(destination, on_progress=ocr_progress)

        _update_job(job_id, phase="chunking", progress=40, pages=len(pages))

        def chunk_progress(done: int, total: int) -> None:
            progress = _scale_progress(done, total, 40, 60)
            _update_job(
                job_id,
                phase="chunking",
                progress=progress,
                pages_total=total,
                pages_done=done,
            )

        chunks = chunker.chunk_pages(pages, safe_name, on_progress=chunk_progress)

        _update_job(
            job_id,
            phase="embedding",
            progress=60,
            chunks_total=len(chunks),
            chunks_done=0,
        )

        def embed_progress(done: int, total: int) -> None:
            progress = _scale_progress(done, total, 60, 100)
            _update_job(
                job_id,
                phase="embedding",
                progress=progress,
                chunks_total=total,
                chunks_done=done,
            )

        vectorstore.store_chunks(chunks, on_progress=embed_progress)

        _update_job(
            job_id,
            status="done",
            phase="complete",
            progress=100,
            filename=safe_name,
            pages=len(pages),
            chunks=len(chunks),
            message=f"Successfully indexed {len(chunks)} chunks from {len(pages)} pages",
        )
    except Exception as exc:
        _update_job(
            job_id,
            status="error",
            phase="error",
            error=str(exc),
        )


async def _run_index_job(job_id: str, destination: str, safe_name: str) -> None:
    await asyncio.to_thread(_process_upload, job_id, destination, safe_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    filename = file.filename or ""
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    safe_name = os.path.basename(filename)
    if not safe_name:
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    destination = os.path.join(config.UPLOAD_DIR, safe_name)
    job_id = uuid.uuid4().hex
    _set_job(
        job_id,
        {
            "job_id": job_id,
            "status": "queued",
            "phase": "queued",
            "progress": 0,
            "filename": safe_name,
            "created_at": datetime.datetime.utcnow().isoformat(),
            "updated_at": datetime.datetime.utcnow().isoformat(),
        },
    )

    try:
        with open(destination, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as exc:
        _update_job(job_id, status="error", phase="error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))

    asyncio.create_task(_run_index_job(job_id, destination, safe_name))

    return {
        "status": "accepted",
        "job_id": job_id,
        "filename": safe_name,
    }


@app.get("/upload/status/{job_id}")
async def upload_status(job_id: str):
    job = _get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Upload job not found")
    return job


@app.post("/chat")
async def chat(payload: dict = Body(...)):
    try:
        question = (payload.get("question") or "").strip()
        history = payload.get("history") or []
        if not isinstance(history, list):
            history = []

        if not question:
            raise HTTPException(status_code=400, detail="Question cannot be empty")

        return qa.answer_question(question, history)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/chat/stream")
async def chat_stream(payload: dict = Body(...)):
    try:
        question = (payload.get("question") or "").strip()
        history = payload.get("history") or []
        if not isinstance(history, list):
            history = []

        if not question:
            raise HTTPException(status_code=400, detail="Question cannot be empty")

        return StreamingResponse(
            qa.stream_answer_question(question, history),
            media_type="text/event-stream",
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/files")
async def get_files():
    try:
        return vectorstore.get_all_sources()
    except Exception:
        return []


@app.delete("/reset")
async def reset_db():
    vectorstore.reset_db()
    qa.clear_session_log()
    return {"status": "success", "message": "Database and session log cleared"}


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "llm_provider": "groq",
        "llm_ready": bool(config.GROQ_API_KEY),
        "llm_model": config.GROQ_MODEL,
        "embed_provider": "jina",
        "embed_ready": bool(config.JINA_API_KEY),
        "embed_model": config.JINA_MODEL,
    }


def _wrap_lines(canvas_obj, text: str, font_name: str, font_size: int, max_width: float) -> list[str]:
    words = text.split()
    if not words:
        return [""]

    lines = []
    current = []
    for word in words:
        test_line = " ".join(current + [word])
        width = canvas_obj.stringWidth(test_line, font_name, font_size)
        if width <= max_width or not current:
            current.append(word)
        else:
            lines.append(" ".join(current))
            current = [word]

    if current:
        lines.append(" ".join(current))

    return lines


def _ensure_page(canvas_obj, y_pos: float, height: float, margin: float) -> float:
    if y_pos <= margin:
        canvas_obj.showPage()
        return height - margin
    return y_pos


@app.get("/report")
async def generate_report():
    session_log = qa.get_session_log()
    if not session_log:
        raise HTTPException(
            status_code=404,
            detail="No session data available. Ask some questions first.",
        )

    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"report_{timestamp}.pdf"
    output_path = os.path.join(config.REPORTS_DIR, filename)

    width, height = A4
    margin = 50
    y = height - margin

    pdf = canvas.Canvas(output_path, pagesize=A4)

    pdf.setFont("Helvetica-Bold", 24)
    pdf.drawString(margin, y, "Friday Session Report")
    y -= 30

    pdf.setFont("Helvetica", 12)
    pdf.drawString(
        margin,
        y,
        datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    )
    y -= 18

    pdf.drawString(margin, y, f"Total questions: {len(session_log)}")
    y -= 30

    max_width = width - (2 * margin)

    for entry in session_log:
        y = _ensure_page(pdf, y, height, margin)

        question = entry.get("question", "")
        answer = entry.get("answer", "")
        sources = entry.get("sources", []) or []
        confidence = entry.get("confidence", 0)

        pdf.setFillColor(colors.Color(0, 0, 0.8))
        pdf.setFont("Helvetica-Bold", 12)
        q_lines = _wrap_lines(pdf, f"Question: {question}", "Helvetica-Bold", 12, max_width)
        for line in q_lines:
            pdf.drawString(margin, y, line)
            y -= 16
            y = _ensure_page(pdf, y, height, margin)

        pdf.setFillColor(colors.black)
        pdf.setFont("Helvetica", 11)
        a_lines = _wrap_lines(pdf, f"Answer: {answer}", "Helvetica", 11, max_width)
        for line in a_lines:
            pdf.drawString(margin, y, line)
            y -= 14
            y = _ensure_page(pdf, y, height, margin)

        pdf.setFont("Helvetica", 10)
        pdf.setFillColor(colors.black)
        pdf.drawString(margin, y, "Sources:")
        y -= 14
        y = _ensure_page(pdf, y, height, margin)

        if sources:
            for source in sources:
                page_num = source.get("page_num")
                filename = source.get("source")
                bullet = f"- Page {page_num}, {filename}"
                s_lines = _wrap_lines(pdf, bullet, "Helvetica", 10, max_width)
                for line in s_lines:
                    pdf.drawString(margin + 12, y, line)
                    y -= 12
                    y = _ensure_page(pdf, y, height, margin)
        else:
            pdf.drawString(margin + 12, y, "- None")
            y -= 12
            y = _ensure_page(pdf, y, height, margin)

        pdf.setFillColor(colors.gray)
        pdf.setFont("Helvetica", 10)
        pdf.drawString(margin, y, f"Confidence: {confidence}%")
        y -= 16
        y = _ensure_page(pdf, y, height, margin)

        pdf.setStrokeColor(colors.lightgrey)
        pdf.line(margin, y, width - margin, y)
        y -= 20

    pdf.save()

    return FileResponse(
        output_path,
        media_type="application/pdf",
        filename="friday_report.pdf",
    )


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
