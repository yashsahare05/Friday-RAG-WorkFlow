# FRIDAY 🚀 
### Master your knowledge. A private, high-performance RAG environment.

**FRIDAY** is a professional-grade Retrieval-Augmented Generation (RAG) cockpit designed for researchers, students, and power users. It allows you to index complex PDF documents, conduct grounded AI research, and generate automated study reports in a private, high-performance environment.

---

## ✨ Key Features

- **🚀 Ultra-Fast AI Streaming**: Backend refactored for asynchronous streaming, delivering tokens to the frontend as they are generated.
- **👁️ Hybrid OCR Pipeline**: Intelligent digital PDF extraction via PyMuPDF with seamless fallback to **Google Cloud Vision OCR** for high-fidelity scanned document processing.
- **🧠 Grounded Research**: Context-aware answering powered by **Groq (Llama 3)** and **Jina Embeddings**, with local vector storage in **ChromaDB**.
- **🎨 Premium UI/UX**:
  - **Synchronized Dark Mode**: A unified theme engine that toggles the entire dashboard instantly.
  - **Custom Scrollbars**: Minimalist, theme-aware scroll interactions.
  - **Typing Indicator**: Real-time "AI thinking" visual feedback.
  - **Responsiveness**: Optimized for both high-end monitors and mobile devices.
- **📄 Study Reporting**: Generate and download professional PDF summaries of your research sessions.

---

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite, Tailwind CSS, Questrial Typography.
- **Backend**: FastAPI (Python 3.10), ChromaDB (Vector Search), Google Cloud Vision (OCR).
- **LLM**: Groq (Llama 3 / Mixtral).
- **Embeddings**: Jina AI (v2 Base English).

---

## 🚀 Quick Start

### 1. Prerequisites
- Python 3.10+
- Node.js 18+
- [Google Cloud Service Account Key](https://console.cloud.google.com/) (for OCR)
- [Groq API Key](https://console.groq.com/)

### 2. Backend Setup
```powershell
cd backend
# Create and activate virtual environment
python -m venv .venv
.venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure .env (Copy from .env.example)
# Ensure GOOGLE_APPLICATION_CREDENTIALS points to your JSON key
uvicorn main:app --reload --port 8000
```

### 3. Frontend Setup
```powershell
cd frontend
# Install dependencies
npm install

# Start development server
npm run dev
```

---

## 🏗️ Project Structure

- `/backend`: FastAPI service, OCR pipeline, and RAG logic.
- `/frontend`: React source code, custom theme engine, and components.
- `/data`: Local storage for ChromaDB, logs, and generated reports.

---

## 📖 Usage Guide

1.  **Index a PDF**: Upload your notes or research papers. FRIDAY will automatically detect if OCR is needed and begin parallel indexing.
2.  **Monitor Progress**: Watch the real-time indexing status and chunk count.
3.  **Chat & Research**: Ask questions grounded in your specific documents. Check the **Sources & Confidence** panel to verify accuracy.
4.  **Export**: Download a PDF report summarizing your session findings.

---

## 👤 Author

Developed with ❤️ by **[Yash Sahare](https://github.com/yashsahare05)**.

---

## 📜 License
Private / Educational Use.
