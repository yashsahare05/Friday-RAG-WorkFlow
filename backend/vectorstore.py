# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any

import requests
import chromadb

from config import CHROMA_PATH, OLLAMA_URL, EMBED_MODEL, TOP_K


client: chromadb.PersistentClient | None = None
collection = None


def get_embedding(text: str) -> list[float]:
    try:
        response = requests.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text},
        )
        response.raise_for_status()
        payload = response.json()
        embedding = payload["embedding"]
        if not isinstance(embedding, list):
            raise ValueError("Invalid embedding payload")
        return embedding
    except Exception as exc:
        raise RuntimeError(
            "Ollama embedding failed — is Ollama running?"
        ) from exc


def init_db():
    global client
    client = chromadb.PersistentClient(path=CHROMA_PATH)
    db_collection = client.get_or_create_collection(
        name="notes", metadata={"hnsw:space": "cosine"}
    )
    print(f"[VECTORSTORE] Database initialized at {CHROMA_PATH}")
    return db_collection


def store_chunks(chunks: list[dict]) -> None:
    global collection
    if collection is None:
        collection = init_db()

    total = len(chunks)
    source = chunks[0].get("source", "unknown") if chunks else "unknown"

    for index, chunk in enumerate(chunks, start=1):
        embedding = get_embedding(chunk["text"])
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

    print(f"[VECTORSTORE] Done — {total} chunks stored from {source}")


def search(query: str) -> list[dict]:
    global collection
    if collection is None:
        collection = init_db()

    embedding = get_embedding(query)
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
