import os
import shutil
import datetime
from contextlib import asynccontextmanager

import ollama
import uvicorn
from fastapi import FastAPI, UploadFile, File, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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
    try:
        ollama.list()
        print("[STARTUP] Ollama is running")
    except Exception:
        print("[STARTUP] WARNING: Ollama is not running. Start it with: ollama serve")
    print("[STARTUP] NoteMind API ready at http://localhost:8000")
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
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

    try:
        with open(destination, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        pages = ocr.extract_text_from_pdf(destination)
        chunks = chunker.chunk_pages(pages, safe_name)
        vectorstore.store_chunks(chunks)

        return {
            "status": "success",
            "filename": safe_name,
            "pages": len(pages),
            "chunks": len(chunks),
            "message": f"Successfully indexed {len(chunks)} chunks from {len(pages)} pages",
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


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
    ollama_running = False
    try:
        ollama.list()
        ollama_running = True
    except Exception:
        ollama_running = False

    return {
        "status": "ok",
        "ollama": ollama_running,
        "model": config.OLLAMA_MODEL,
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
    pdf.drawString(margin, y, "NoteMind Session Report")
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
        filename="notemind_report.pdf",
    )


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
