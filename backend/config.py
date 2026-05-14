import os

try:
    from dotenv import load_dotenv
except Exception as exc:
    load_dotenv = None
    print(f"[config] Warning: python-dotenv not available: {exc}")

if load_dotenv is not None:
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    load_dotenv(env_path, override=True)

GOOGLE_APPLICATION_CREDENTIALS = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
CHROMA_PATH = os.getenv("CHROMA_PATH", "../data/chroma_db")
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "../data/uploads")
REPORTS_DIR = os.getenv("REPORTS_DIR", "../data/reports")
LOGS_DIR = os.getenv("LOGS_DIR", "../data/logs")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-70b-versatile")
GROQ_BASE_URL = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
JINA_API_KEY = os.getenv("JINA_API_KEY", "").strip()
JINA_MODEL = os.getenv("JINA_MODEL", "jina-embeddings-v2-base-en")
JINA_API_URL = os.getenv("JINA_API_URL", "https://api.jina.ai/v1/embeddings")
JINA_TASK = os.getenv("JINA_TASK", "").strip()
JINA_USE_PREFIXES = os.getenv("JINA_USE_PREFIXES", "true").strip().lower() == "true"
FASTAPI_URL = os.getenv("FASTAPI_URL", "http://localhost:8000")
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "300"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "50"))
TOP_K = int(os.getenv("TOP_K", "5"))
SIMILARITY_THRESHOLD = float(os.getenv("SIMILARITY_THRESHOLD", "0.35"))
REINDEX_INTERVAL_MINUTES = int(os.getenv("REINDEX_INTERVAL_MINUTES", "30"))
USE_CLOUD_OCR = os.getenv("USE_CLOUD_OCR", "true").strip().lower() == "true"

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(REPORTS_DIR, exist_ok=True)
os.makedirs(LOGS_DIR, exist_ok=True)
