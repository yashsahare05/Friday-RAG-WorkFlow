import json
import asyncio
from datetime import datetime

import httpx
import requests

from config import GROQ_API_KEY, GROQ_BASE_URL, GROQ_MODEL, SIMILARITY_THRESHOLD
from vectorstore import search


session_log: list[dict] = []


def _get_qa_prompt(question: str, context: str, history_text: str) -> str:
    return (
        "SYSTEM: You are a study assistant. Answer ONLY using the context notes below. "
        "Never use outside knowledge. If the answer is not in the context say exactly: "
        "I don't have enough information in the notes.\n"
        "Formatting instructions:\n"
        "- Use Markdown for formatting (bold, lists, etc.).\n"
        "- Use standard LaTeX for math. Use $ for inline math (e.g. $E=mc^2$) and $$ for display math blocks.\n\n"
        "CONTEXT:\n"
        f"{context}\n"
        "CONVERSATION HISTORY:\n"
        f"{history_text}\n"
        f"QUESTION: {question}\n"
        "ANSWER:"
    )


def answer_question(question: str, history: list[dict]) -> dict:
    results = search(question)
    if not results:
        return {
            "answer": "I don't have enough information in the notes to answer this question.",
            "sources": [],
            "confidence": 0,
        }

    best_similarity = float(results[0].get("similarity", 0.0) or 0.0)
    if best_similarity < SIMILARITY_THRESHOLD:
        return {
            "answer": "I don't have enough information in the notes to answer this question.",
            "sources": [],
            "confidence": 0,
        }

    top_results = results[:3]
    context_lines = []
    for index, result in enumerate(top_results, start=1):
        page_num = result.get("page_num")
        source = result.get("source")
        text = result.get("text", "") or ""
        context_lines.append(f"[{index}] (Page {page_num}, {source}): {text}")
    context = "\n".join(context_lines)

    recent_history = history[-3:] if history else []
    if recent_history:
        history_lines = []
        for item in recent_history:
            history_lines.append(f"User: {item.get('question', '')}")
            history_lines.append(f"Assistant: {item.get('answer', '')}")
        history_text = "\n".join(history_lines)
    else:
        history_text = "No previous conversation"

    prompt = _get_qa_prompt(question, context, history_text)

    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not set")

    response = requests.post(
        f"{GROQ_BASE_URL.rstrip('/')}/chat/completions",
        headers={
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": GROQ_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
        },
        timeout=60,
    )

    if not response.ok:
        raise RuntimeError(f"Groq API error ({response.status_code}): {response.text}")

    payload = response.json()
    choices = payload.get("choices") or []
    if not choices:
        raise RuntimeError("Groq API returned no choices")

    message = choices[0].get("message") or {}
    answer_text = message.get("content") or ""
    
    sources = [
        {
            "page_num": r.get("page_num"),
            "source": r.get("source"),
            "excerpt": (r.get("text") or "")[:80],
        }
        for r in top_results
    ]
    confidence = int(best_similarity * 100)

    session_log.append({
        "question": question,
        "answer": answer_text,
        "sources": sources,
        "confidence": confidence,
        "timestamp": datetime.now().isoformat(),
    })

    return {"answer": answer_text, "sources": sources, "confidence": confidence}


async def stream_answer_question(question: str, history: list[dict]):
    results = await asyncio.to_thread(search, question)
    if not results:
        yield json.dumps({
            "answer": "I don't have enough information in the notes to answer this question.",
            "sources": [],
            "confidence": 0,
            "done": True
        }) + "\n"
        return

    best_similarity = float(results[0].get("similarity", 0.0) or 0.0)
    if best_similarity < SIMILARITY_THRESHOLD:
        yield json.dumps({
            "answer": "I don't have enough information in the notes to answer this question.",
            "sources": [],
            "confidence": 0,
            "done": True
        }) + "\n"
        return

    top_results = results[:3]
    context_lines = []
    for index, result in enumerate(top_results, start=1):
        page_num = result.get("page_num")
        source = result.get("source")
        text = result.get("text", "") or ""
        context_lines.append(f"[{index}] (Page {page_num}, {source}): {text}")
    context = "\n".join(context_lines)

    recent_history = history[-3:] if history else []
    history_text = "\n".join([
        f"User: {item.get('question', '')}\nAssistant: {item.get('answer', '')}"
        for item in recent_history
    ]) if recent_history else "No previous conversation"

    prompt = _get_qa_prompt(question, context, history_text)

    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not set")

    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream(
            "POST",
            f"{GROQ_BASE_URL.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": GROQ_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0,
                "stream": True,
            },
        ) as response:
            if not response.is_success:
                error_text = await response.aread()
                raise RuntimeError(f"Groq API error ({response.status_code}): {error_text.decode()}")

            full_answer = ""
            async for line in response.aiter_lines():
                if not line:
                    continue
                
                decoded_line = line.strip()
                if not decoded_line.startswith("data: "):
                    continue
                    
                data_str = decoded_line[6:]
                if data_str == "[DONE]":
                    break
                    
                try:
                    chunk_data = json.loads(data_str)
                    chunk_content = chunk_data["choices"][0]["delta"].get("content", "")
                    if chunk_content:
                        full_answer += chunk_content
                        yield json.dumps({"chunk": chunk_content, "done": False}) + "\n"
                except Exception:
                    continue

    sources = [
        {
            "page_num": r.get("page_num"),
            "source": r.get("source"),
            "excerpt": (r.get("text") or "")[:80],
        }
        for r in top_results
    ]
    confidence = int(best_similarity * 100)

    session_log.append({
        "question": question,
        "answer": full_answer,
        "sources": sources,
        "confidence": confidence,
        "timestamp": datetime.now().isoformat(),
    })

    yield json.dumps({
        "answer": full_answer,
        "sources": sources,
        "confidence": confidence,
        "done": True
    }) + "\n"


def get_session_log() -> list:
    return session_log


def clear_session_log():
    session_log.clear()


if __name__ == "__main__":
    test_questions = [
        "what is a project schedule",
        "what is the critical path",
        "what is the capital of France",
    ]

    for test_question in test_questions:
        print(f"Question: {test_question}")
        try:
            result = answer_question(test_question, session_log)
            answer = result.get("answer", "")
            confidence = result.get("confidence", 0)
            sources = result.get("sources", [])
            page_nums = [source.get("page_num") for source in sources]

            print(f"Answer: {answer}")
            print(f"Confidence: {confidence}")
            print(f"Source pages: {page_nums}")
        except Exception as exc:
            print(f"Error: {exc}")
        print("-")

    print(f"Session log length: {len(session_log)}")
