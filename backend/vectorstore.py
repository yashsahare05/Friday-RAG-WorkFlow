# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any, Callable, Optional

import requests
import chromadb

from config import (
    CHROMA_PATH,
    JINA_API_KEY,
    JINA_API_URL,
    JINA_MODEL,
    JINA_TASK,
    JINA_USE_PREFIXES,
    TOP_K,
)


client: chromadb.PersistentClient | None = None
collection = None


def _maybe_prefix(text: str, purpose: str) -> str:
    if not JINA_USE_PREFIXES:
        return text

    if not JINA_MODEL.startswith("jina-embeddings-v5-text"):
        return text

    prefix = "Query:" if purpose == "query" else "Document:"
    return f"{prefix} {text}"


def get_embedding(text: str, *, purpose: str) -> list[float]:
    if not JINA_API_KEY:
        raise RuntimeError("JINA_API_KEY is not set")

    try:
        payload: dict[str, object] = {
            "model": JINA_MODEL,
            "input": [_maybe_prefix(text, purpose)],
        }
        if JINA_TASK:
            payload["task"] = JINA_TASK

        response = requests.post(
            JINA_API_URL,
            headers={
                "Authorization": f"Bearer {JINA_API_KEY}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            json=payload,
            timeout=30,
        )

        if not response.ok:
            message = response.text.strip()
            if len(message) > 500:
                message = message[:500] + "..."
            raise RuntimeError(
                f"Jina API error ({response.status_code}): {message}"
            )

        payload = response.json()
        data = payload.get("data") or []
        if not data:
            raise ValueError(f"No embeddings returned: {payload}")
        embedding = data[0].get("embedding")

        if not isinstance(embedding, list):
            raise ValueError("Invalid embedding payload")
        return embedding
    except Exception as exc:
        raise RuntimeError(
            f"Jina embedding failed: {exc}"
        ) from exc


def init_db():
    global client
    client = chromadb.PersistentClient(path=CHROMA_PATH)
    db_collection = client.get_or_create_collection(
        name="notes", metadata={"hnsw:space": "cosine"}
    )
    print(f"[VECTORSTORE] Database initialized at {CHROMA_PATH}")
    return db_collection


def store_chunks(
    chunks: list[dict],
    on_progress: Optional[Callable[[int, int], None]] = None,
) -> None:
    global collection
    if collection is None:
        collection = init_db()

    total = len(chunks)
    source = chunks[0].get("source", "unknown") if chunks else "unknown"

    for index, chunk in enumerate(chunks, start=1):
        embedding = get_embedding(chunk["text"], purpose="document")
        collection.upsert(
            ids=[chunk["chunk_id"]],
            embeddings=[embedding],
            documents=[chunk["text"]],
            metadatas=[
                {
                    "page_num": chunk["page_num"],
                    "source": chunk["source"],
                    "chunk_id": chunk["chunk_id"],
                }
            ],
        )

        if index % 10 == 0:
            print(f"[VECTORSTORE] Stored {index}/{total} chunks...")
        if on_progress:
            on_progress(index, total)

    print(f"[VECTORSTORE] Done — {total} chunks stored from {source}")


def search(query: str) -> list[dict]:
    global collection
    if collection is None:
        collection = init_db()

    embedding = get_embedding(query, purpose="query")
    results = collection.query(
        query_embeddings=[embedding],
        n_results=TOP_K,
        include=["documents", "metadatas", "distances"],
    )

    documents = results.get("documents", [[]])
    metadatas = results.get("metadatas", [[]])
    distances = results.get("distances", [[]])

    docs_list = documents[0] if documents else []
    metas_list = metadatas[0] if metadatas else []
    dist_list = distances[0] if distances else []

    output: list[dict[str, Any]] = []
    for doc, meta, distance in zip(docs_list, metas_list, dist_list):
        if distance is None:
            similarity = 0.0
        else:
            similarity = 1 / (1 + float(distance))

        output.append(
            {
                "text": doc,
                "page_num": meta.get("page_num") if meta else None,
                "source": meta.get("source") if meta else None,
                "similarity": similarity,
                "chunk_id": meta.get("chunk_id") if meta else None,
            }
        )

    output.sort(key=lambda item: item["similarity"], reverse=True)
    return output


def get_all_sources() -> list[dict]:
    global collection
    if collection is None:
        collection = init_db()

    results = collection.get(include=["metadatas"])
    metadatas = results.get("metadatas", []) if results else []

    if not metadatas:
        return []

    counts: dict[str, int] = {}
    for meta in metadatas:
        if not meta:
            continue
        source = meta.get("source")
        if not source:
            continue
        counts[source] = counts.get(source, 0) + 1

    return [
        {"source": source, "chunk_count": count}
        for source, count in counts.items()
    ]


def reset_db() -> None:
    global client, collection
    if client is None:
        client = chromadb.PersistentClient(path=CHROMA_PATH)

    client.delete_collection(name="notes")
    collection = client.get_or_create_collection(
        name="notes", metadata={"hnsw:space": "cosine"}
    )
    print("[VECTORSTORE] Database reset — all data cleared")


collection = init_db()


if __name__ == "__main__":
    try:
        import sys

        sys.path.insert(0, ".")

        from ocr import extract_text_from_pdf
        from chunker import chunk_pages

        print("Step 1: Extracting text...")
        pages = extract_text_from_pdf("../data/uploads/test.pdf")
        print(f"Total pages: {len(pages)}")

        print("Step 2: Chunking...")
        chunks = chunk_pages(pages, "test.pdf")
        print(f"Total chunks: {len(chunks)}")

        print("Step 3: Storing in ChromaDB...")
        store_chunks(chunks)

        print("Step 4: Searching...")
        results = search("what is in these notes")
        for index, result in enumerate(results, start=1):
            similarity = float(result.get("similarity", 0.0))
            page_num = result.get("page_num")
            text = result.get("text", "") or ""
            snippet = text[:100]
            print(
                f"{index}. {similarity:.2f} | page {page_num} | {snippet}"
            )

        print("Step 5: Sources:")
        sources = get_all_sources()
        print(sources)
    except Exception as exc:
        print(f"[VECTORSTORE] Error: {exc}")
