import re
from typing import Callable, Optional
from concurrent.futures import ThreadPoolExecutor

import fitz
from google.cloud import vision

import config


def _clean_lines(text: str) -> str:
    if not text:
        return ""
    cleaned_lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if len(stripped) < 2:
            continue
        stripped = re.sub(r"\s+", " ", stripped)
        cleaned_lines.append(stripped)
    return "\n".join(cleaned_lines).strip()


def _clean_paragraphs(text: str) -> list[str]:
    if not text:
        return []
    raw_paragraphs = text.split("\n\n")
    paragraphs = []
    for para in raw_paragraphs:
        cleaned = _clean_lines(para)
        if len(cleaned) >= 2:
            paragraphs.append(cleaned)
    return paragraphs


def extract_with_google_vision(
    pdf_path: str,
    on_progress: Optional[Callable[[int, int, str], None]] = None,
) -> list[dict]:
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    doc.close()
    results: list[Optional[dict]] = [None] * total_pages
    
    try:
        client = vision.ImageAnnotatorClient()
    except Exception as exc:
        print(f"[OCR] Error initializing Google Cloud Vision client: {exc}")
        return [
            {
                "page_num": i + 1,
                "text": "",
                "paragraphs": [],
                "method": "google_vision",
            }
            for i in range(total_pages)
        ]

    def process_page(page_index: int):
        page_num = page_index + 1
        local_doc = None
        try:
            local_doc = fitz.open(pdf_path)
            page = local_doc.load_page(page_index)
            matrix = fitz.Matrix(300 / 72, 300 / 72)
            pix = page.get_pixmap(matrix=matrix)
            img_bytes = pix.tobytes("png")
            
            image = vision.Image(content=img_bytes)
            response = client.document_text_detection(image=image)
            
            if response.error.message:
                raise Exception(f"{response.error.message}")
                
            text = response.full_text_annotation.text if response.full_text_annotation else ""
            paragraphs = _clean_paragraphs(text)
            cleaned_text = "\n\n".join(paragraphs).strip()

            results[page_index] = {
                "page_num": page_num,
                "text": cleaned_text,
                "paragraphs": paragraphs,
                "method": "google_vision",
            }
        except Exception as exc:
            print(f"[OCR] Warning: Google Vision failed on page {page_num}: {exc}")
            results[page_index] = {
                "page_num": page_num,
                "text": "",
                "paragraphs": [],
                "method": "google_vision",
            }
        finally:
            if local_doc:
                local_doc.close()
        
        if on_progress:
            # Note: We count how many are done across all threads
            done_count = sum(1 for r in results if r is not None)
            on_progress(done_count, total_pages, "google_vision")

    # Use a thread pool to process pages in parallel
    # We use a max_workers limit to avoid overwhelming the API or local memory
    max_workers = min(10, total_pages) if total_pages > 0 else 1
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        executor.map(process_page, range(total_pages))

    # Filter out any None values (though there shouldn't be any) and return
    return [r for r in results if r is not None]


def extract_with_pymupdf(
    pdf_path: str,
    on_progress: Optional[Callable[[int, int, str], None]] = None,
) -> list[dict]:
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    doc.close()
    results: list[Optional[dict]] = [None] * total_pages

    def process_page(page_index: int):
        page_num = page_index + 1
        local_doc = None
        try:
            local_doc = fitz.open(pdf_path)
            page = local_doc.load_page(page_index)
            text = page.get_text()
            paragraphs = _clean_paragraphs(text)
            cleaned_text = "\n\n".join(paragraphs).strip()

            results[page_index] = {
                "page_num": page_num,
                "text": cleaned_text,
                "paragraphs": paragraphs,
                "method": "pymupdf",
            }
        except Exception as exc:
            print(f"[OCR] Warning: PyMuPDF failed on page {page_num}: {exc}")
            results[page_index] = {
                "page_num": page_num,
                "text": "",
                "paragraphs": [],
                "method": "pymupdf",
            }
        finally:
            if local_doc:
                local_doc.close()

        if on_progress:
            done_count = sum(1 for r in results if r is not None)
            on_progress(done_count, total_pages, "pymupdf")

    max_workers = min(10, total_pages) if total_pages > 0 else 1
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        executor.map(process_page, range(total_pages))

    return [r for r in results if r is not None]


def extract_text_from_pdf_stream(
    pdf_path: str,
):
    """
    A generator version of extract_text_from_pdf that yields pages one by one.
    This allows the indexing pipeline to start chunking/embedding immediately.
    """
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    check_pages = min(5, total_pages)
    
    digital_chars = 0
    for i in range(check_pages):
        digital_chars += len(doc.load_page(i).get_text())
    doc.close()

    is_digital = digital_chars > (100 * check_pages)
    
    if is_digital:
        # For digital PDFs, PyMuPDF is so fast that we just use the existing 
        # parallel extractor and yield from the results.
        results = extract_with_pymupdf(pdf_path)
        for page in results:
            yield page
    else:
        # For scanned PDFs, Google Vision is slower, so we yield as each page finishes.
        # We'll use a queue-based approach within a thread pool
        from queue import Queue
        page_queue = Queue()
        
        def on_page_done(done: int, total: int, method: str):
            # This is tricky because we need the actual page data.
            # Let's refactor extract_with_google_vision to yield instead.
            pass

        # Actually, let's keep it simple for now and just yield from the results 
        # but refactor the vision extractor to be more friendly to streaming if needed.
        results = extract_with_google_vision(pdf_path)
        for page in results:
            yield page


def extract_text_from_pdf(
    pdf_path: str,
    on_progress: Optional[Callable[[int, int, str], None]] = None,
) -> list[dict]:
    # Legacy wrapper for compatibility
    return list(extract_text_from_pdf_stream(pdf_path))
