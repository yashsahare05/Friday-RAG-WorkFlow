from __future__ import annotations

from config import CHUNK_OVERLAP, CHUNK_SIZE


def _word_count(text: str) -> int:
    return len(text.split())


def _tail_words(text: str, count: int) -> list[str]:
    if count <= 0:
        return []
    words = text.split()
    if not words:
        return []
    return words[-count:]


def chunk_pages(pages: list[dict], source_name: str) -> list[dict]:
    chunks: list[dict] = []
    chunk_index = 0
    total_pages = len(pages)

    for page in pages:
        raw_page_num = page.get("page_num", 0) if isinstance(page, dict) else 0
        try:
            page_num = int(raw_page_num or 0)
        except (TypeError, ValueError):
            page_num = 0

        paragraphs = page.get("paragraphs", []) if isinstance(page, dict) else []

        current_parts: list[str] = []
        current_word_count = 0

        def finalize(allow_overlap: bool) -> None:
            nonlocal chunk_index, current_parts, current_word_count
            if not current_parts:
                current_parts = []
                current_word_count = 0
                return

            text = "\n\n".join(current_parts).strip()
            if not text:
                current_parts = []
                current_word_count = 0
                return

            if _word_count(text) >= 10:
                chunks.append(
                    {
                        "text": text,
                        "page_num": page_num,
                        "source": source_name,
                        "chunk_id": f"{source_name}_p{page_num}_c{chunk_index}",
                    }
                )
                chunk_index += 1

                if allow_overlap and CHUNK_OVERLAP > 0:
                    overlap_words = _tail_words(text, CHUNK_OVERLAP)
                    if overlap_words:
                        current_parts = [" ".join(overlap_words)]
                        current_word_count = len(overlap_words)
                        return

            current_parts = []
            current_word_count = 0

        def add_unit(unit_text: str) -> None:
            nonlocal current_parts, current_word_count
            if not unit_text:
                return
            unit_words = unit_text.split()
            if not unit_words:
                return
            current_parts.append(unit_text)
            current_word_count += len(unit_words)
            if current_word_count >= CHUNK_SIZE:
                finalize(allow_overlap=True)

        for paragraph in paragraphs:
            if not paragraph:
                continue
            paragraph_words = paragraph.split()
            if len(paragraph_words) > CHUNK_SIZE:
                for sentence in paragraph.split(". "):
                    sentence = sentence.strip()
                    if not sentence:
                        continue
                    add_unit(sentence)
            else:
                add_unit(paragraph)

        finalize(allow_overlap=False)

    print(
        f"[CHUNKER] {source_name} - {len(chunks)} chunks from {total_pages} pages"
    )
    return chunks
if __name__ == '__main__':
    import sys
    sys.path.insert(0, '.')
    from ocr import extract_text_from_pdf

    pdf_path = '../data/uploads/test.pdf'
    print(f'Testing chunker with: {pdf_path}')

    pages = extract_text_from_pdf(pdf_path)
    print(f'Pages extracted: {len(pages)}')

    chunks = chunk_pages(pages, 'test.pdf')
    print(f'Total chunks: {len(chunks)}')

    for chunk in chunks[:3]:
        print(f"\n--- Chunk: {chunk['chunk_id']} | Page {chunk['page_num']} ---")
        print(f"Text preview: {chunk['text'][:150]}")