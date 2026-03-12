import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import {
  chat,
  ChatHistoryItem,
  ChatSource,
  downloadReport,
  getFiles,
  health,
  reset,
  SourceInfo,
  uploadPdf,
  UploadResponse,
} from "./lib/api";

type HealthState = {
  status: string;
  ollama: boolean;
  model: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const makeId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
};

const EMPTY_HEALTH: HealthState = {
  status: "checking",
  ollama: false,
  model: "unknown",
};

const LOW_CONFIDENCE_THRESHOLD = 40;

export default function App() {
  const [healthState, setHealthState] = useState<HealthState>(EMPTY_HEALTH);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [files, setFiles] = useState<SourceInfo[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
  const [question, setQuestion] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [latestSources, setLatestSources] = useState<ChatSource[]>([]);
  const [latestConfidence, setLatestConfidence] = useState<number | null>(null);
  const [latestAnswer, setLatestAnswer] = useState<string | null>(null);

  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const refreshHealth = async () => {
    try {
      setHealthError(null);
      const data = await health();
      setHealthState(data);
    } catch (error) {
      setHealthError(getErrorMessage(error));
      setHealthState((prev) => ({
        ...prev,
        status: "error",
        ollama: false,
      }));
    }
  };

  const refreshFiles = async () => {
    try {
      setFilesError(null);
      setFilesLoading(true);
      const data = await getFiles();
      setFiles(data);
    } catch (error) {
      setFilesError(getErrorMessage(error));
    } finally {
      setFilesLoading(false);
    }
  };

  useEffect(() => {
    refreshHealth();
    refreshFiles();
    const interval = setInterval(refreshHealth, 20000);
    return () => clearInterval(interval);
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setUploadError(null);
    setUploadResult(null);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setUploadError("Select a PDF file to upload.");
      return;
    }

    if (!selectedFile.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Only PDF files are allowed.");
      return;
    }

    try {
      setUploading(true);
      setUploadError(null);
      setUploadResult(null);
      const result = await uploadPdf(selectedFile);
      setUploadResult(result);
      await refreshFiles();
    } catch (error) {
      setUploadError(getErrorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  const handleSend = async (event?: FormEvent) => {
    event?.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) {
      setChatError("Enter a question before sending.");
      return;
    }

    const historySnapshot = [...chatHistory];
    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: trimmed,
    };

    setQuestion("");
    setChatError(null);
    setChatLoading(true);
    setMessages((prev) => [...prev, userMessage]);

    try {
      const response = await chat(trimmed, historySnapshot);
      const assistantMessage: ChatMessage = {
        id: makeId(),
        role: "assistant",
        content: response.answer,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setChatHistory((prev) => [...prev, { question: trimmed, answer: response.answer }]);
      setLatestSources(response.sources || []);
      setLatestConfidence(response.confidence ?? null);
      setLatestAnswer(response.answer);
    } catch (error) {
      setChatError(getErrorMessage(error));
    } finally {
      setChatLoading(false);
    }
  };

  const handleDownloadReport = async () => {
    try {
      setReportError(null);
      setReportLoading(true);
      const blob = await downloadReport();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "friday_report.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setReportError(getErrorMessage(error));
    } finally {
      setReportLoading(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm("Reset the database and clear the session log?")) {
      return;
    }

    try {
      setResetError(null);
      setResetLoading(true);
      await reset();
      setMessages([]);
      setChatHistory([]);
      setLatestSources([]);
      setLatestConfidence(null);
      setLatestAnswer(null);
      setUploadResult(null);
      setSelectedFile(null);
      await refreshFiles();
    } catch (error) {
      setResetError(getErrorMessage(error));
    } finally {
      setResetLoading(false);
    }
  };

  const confidenceLabel = latestConfidence === null ? "--" : `${latestConfidence}%`;
  const isLowConfidence =
    (latestConfidence !== null && latestConfidence < LOW_CONFIDENCE_THRESHOLD) ||
    (latestAnswer && latestAnswer.toLowerCase().includes("don't have enough information"));

  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => a.source.localeCompare(b.source));
  }, [files]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-title">Friday</div>
          <p className="brand-subtitle">
            A local RAG cockpit for indexing PDFs, grounding answers, and exporting study reports.
          </p>
        </div>
        <div className="header-meta">
          <div className={`health-pill ${healthState.ollama ? "ok" : "warn"}`}>
            <span className="dot" />
            <span>{healthState.ollama ? "Ollama running" : "Ollama offline"}</span>
          </div>
          <div className="model-pill">Model: {healthState.model}</div>
        </div>
      </header>

      {healthError && <div className="alert alert-neutral">{healthError}</div>}

      <main className="app-body">
        <section className="column">
          <div className="card" style={{ animationDelay: "0.05s" }}>
            <h2 className="card-title">Index a PDF</h2>
            <p className="card-subtitle">Upload notes to build your local knowledge base.</p>

            <div className="stack">
              <div className="input-file">
                <input type="file" accept=".pdf,application/pdf" onChange={handleFileChange} />
                {selectedFile && (
                  <span className="muted">Selected: {selectedFile.name}</span>
                )}
              </div>

              <div className="inline">
                <button className="btn btn-primary" onClick={handleUpload} disabled={uploading}>
                  {uploading ? "Indexing..." : "Upload & Index"}
                </button>
              </div>

              {uploadError && <div className="alert alert-error">{uploadError}</div>}
              {uploadResult && (
                <div className="alert alert-success">{uploadResult.message}</div>
              )}

              {uploadResult && (
                <div className="stats-grid">
                  <div className="stat">
                    <span className="muted">Pages</span>
                    <strong>{uploadResult.pages}</strong>
                  </div>
                  <div className="stat">
                    <span className="muted">Chunks</span>
                    <strong>{uploadResult.chunks}</strong>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{ animationDelay: "0.1s" }}>
            <h2 className="card-title">Indexed Files</h2>
            <p className="card-subtitle">See which sources are ready for retrieval.</p>

            <div className="stack">
              <div className="inline">
                <button className="btn btn-ghost" onClick={refreshFiles} disabled={filesLoading}>
                  {filesLoading ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              {filesError && <div className="alert alert-error">{filesError}</div>}

              {sortedFiles.length === 0 && !filesLoading ? (
                <div className="empty-state">No files indexed yet.</div>
              ) : (
                <div className="files-list">
                  {sortedFiles.map((file) => (
                    <div className="file-item" key={file.source}>
                      <div>
                        <div>{file.source}</div>
                        <div className="file-meta">Chunks: {file.chunk_count}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{ animationDelay: "0.15s" }}>
            <h2 className="card-title">Actions</h2>
            <p className="card-subtitle">Reset the workspace or export the latest report.</p>

            <div className="stack">
              <div className="inline">
                <button className="btn btn-secondary" onClick={handleReset} disabled={resetLoading}>
                  {resetLoading ? "Resetting..." : "Reset Database"}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleDownloadReport}
                  disabled={reportLoading}
                >
                  {reportLoading ? "Preparing..." : "Download Report"}
                </button>
              </div>

              {resetError && <div className="alert alert-error">{resetError}</div>}
              {reportError && <div className="alert alert-neutral">{reportError}</div>}
            </div>
          </div>
        </section>

        <section className="column">
          <div className="card chat-card" style={{ animationDelay: "0.05s" }}>
            <h2 className="card-title">Conversation</h2>
            <p className="card-subtitle">Ask questions grounded in your uploaded notes.</p>

            <div className="chat-feed">
              {messages.length === 0 ? (
                <div className="empty-state">No messages yet. Ask your first question.</div>
              ) : (
                messages.map((message) => (
                  <div key={message.id} className={`message ${message.role}`}>
                    <div className="bubble">{message.content}</div>
                  </div>
                ))
              )}
            </div>

            {chatError && <div className="alert alert-error">{chatError}</div>}

            <form className="chat-input" onSubmit={handleSend}>
              <textarea
                className="textarea"
                placeholder="Ask Friday something about your notes..."
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              />
              <button className="btn btn-primary" type="submit" disabled={chatLoading}>
                {chatLoading ? "Thinking..." : "Send"}
              </button>
            </form>
          </div>

          <div className="card sources-card" style={{ animationDelay: "0.1s" }}>
            <h2 className="card-title">Sources & Confidence</h2>
            <p className="card-subtitle">Latest retrieval context powering the answer.</p>

            <div className="confidence">
              <span className="muted">Confidence</span>
              <span className="confidence-value">{confidenceLabel}</span>
            </div>

            {isLowConfidence && (
              <div className="alert alert-neutral">
                The latest answer has low confidence or lacks enough source coverage.
              </div>
            )}

            {latestSources.length === 0 ? (
              <div className="empty-state">No sources to show yet.</div>
            ) : (
              <div className="sources-list">
                {latestSources.map((source, index) => (
                  <div className="source-item" key={`${source.source ?? "source"}-${index}`}>
                    <strong>
                      Page {source.page_num ?? "?"} - {source.source ?? "Unknown"}
                    </strong>
                    <span className="muted">{source.excerpt}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
