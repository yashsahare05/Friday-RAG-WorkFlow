import os

try:
    from dotenv import load_dotenv
except Exception as exc:
    load_dotenv = None
    print(f"[config] Warning: python-dotenv not available: {exc}")

if load_dotenv is not None:
    load_dotenv()

GOOGLE_APPLICATION_CREDENTIALS = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
CHROMA_PATH = os.getenv("CHROMA_PATH", "../data/chroma_db")
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "../data/uploads")
REPORTS_DIR = os.getenv("REPORTS_DIR", "../data/reports")
LOGS_DIR = os.getenv("LOGS_DIR", "../data/logs")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
FASTAPI_URL = os.getenv("FASTAPI_URL", "http://localhost:8000")
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "300"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "50"))
TOP_K = int(os.getenv("TOP_K", "5"))
SIMILARITY_THRESHOLD = float(os.getenv("SIMILARITY_THRESHOLD", "0.35"))
REINDEX_INTERVAL_MINUTES = int(os.getenv("REINDEX_INTERVAL_MINUTES", "30"))
USE_CLOUD_OCR = os.getenv("USE_CLOUD_OCR", "false").strip().lower() == "true"
TESSERACT_PATH = os.getenv("TESSERACT_PATH", "tesseract")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(REPORTS_DIR, exist_ok=True)
os.makedirs(LOGS_DIR, exist_ok=True)
