import re

import fitz
from PIL import Image, ImageEnhance, ImageFilter
import pytesseract

import config

pytesseract.pytesseract.tesseract_cmd = config.TESSERACT_PATH


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


def extract_with_tesseract(pdf_path: str) -> list[dict]:
    results: list[dict] = []
    doc = fitz.open(pdf_path)

    for page_index in range(len(doc)):
        page_num = page_index + 1
        try:
            page = doc.load_page(page_index)
            matrix = fitz.Matrix(300 / 72, 300 / 72)
            pix = page.get_pixmap(matrix=matrix)

            mode = "RGB" if pix.alpha == 0 else "RGBA"
            img = Image.frombytes(mode, [pix.width, pix.height], pix.samples)

            img = img.convert("L")
            img = ImageEnhance.Contrast(img).enhance(2.0)
            img = img.filter(ImageFilter.SHARPEN)
            img = img.point(lambda x: 0 if x < 140 else 255, "1")

            text = pytesseract.image_to_string(
                img, lang="eng", config="--psm 6"
            )
            paragraphs = _clean_paragraphs(text)
            cleaned_text = "\n\n".join(paragraphs).strip()

            results.append(
                {
                    "page_num": page_num,
                    "text": cleaned_text,
                    "paragraphs": paragraphs,
                    "method": "tesseract",
                }
            )
        except Exception as exc:
            print(f"[OCR] Warning: Tesseract failed on page {page_num}: {exc}")
            results.append(
                {
                    "page_num": page_num,
                    "text": "",
                    "paragraphs": [],
                    "method": "tesseract",
                }
            )

    return results


def extract_with_pymupdf(pdf_path: str) -> list[dict]:
    results: list[dict] = []
    doc = fitz.open(pdf_path)

    for page_index in range(len(doc)):
        page_num = page_index + 1
        page = doc.load_page(page_index)
        text = page.get_text()

        paragraphs = _clean_paragraphs(text)
        cleaned_text = "\n\n".join(paragraphs).strip()

        results.append(
            {
                "page_num": page_num,
                "text": cleaned_text,
                "paragraphs": paragraphs,
                "method": "pymupdf",
            }
        )

    return results


def extract_text_from_pdf(pdf_path: str) -> list[dict]:
    pymupdf_results = extract_with_pymupdf(pdf_path)
    pymupdf_chars = sum(len(item.get("text", "")) for item in pymupdf_results)

    if pymupdf_chars > 100:
        print("[OCR] Digital PDF detected, using PyMuPDF")
        final_results = pymupdf_results
    else:
        print("[OCR] Scanned PDF detected, using Tesseract")
        try:
            final_results = extract_with_tesseract(pdf_path)
        except Exception as exc:
            print(f"[OCR] Tesseract failed: {exc}, using PyMuPDF fallback")
            final_results = pymupdf_results

    pages = len(final_results)
    chars = sum(len(item.get("text", "")) for item in final_results)
    method = final_results[0]["method"] if final_results else "unknown"
    print(f"[OCR] Done — {pages} pages, {chars} characters, method: {method}")
    return final_results
