import sys

from ocr import extract_text_from_pdf


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python test_ocr.py <path-to-pdf>")
        return 1

    pdf_path = sys.argv[1]
    results = extract_text_from_pdf(pdf_path)

    for item in results:
        page_num = item.get("page_num")
        method = item.get("method")
        text = item.get("text", "")
        print(f"Page {page_num} | method={method}")
        print(text[:300])
        print("-" * 40)

    total_pages = len(results)
    total_chars = sum(len(item.get("text", "")) for item in results)
    method = results[0]["method"] if results else "unknown"
    print(f"Total pages: {total_pages}")
    print(f"Total characters: {total_chars}")
    print(f"OCR method: {method}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
