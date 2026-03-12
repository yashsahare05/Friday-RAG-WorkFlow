import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  chat,
  ChatHistoryItem,
  ChatSource,
  downloadReport,
  getFiles,
  getUploadStatus,
  health,
  reset,
  SourceInfo,
  uploadPdf,
  UploadResponse,
} from "./lib/api";

type HealthState = {
  status: string;
  llm_provider: string;
  llm_ready: boolean;
  llm_model: string;
  embed_provider: string;
  embed_ready: boolean;
  embed_model: string;
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
  llm_provider: "groq",
  llm_ready: false,
  llm_model: "unknown",
  embed_provider: "jina",
  embed_ready: false,
  embed_model: "unknown",
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
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadPhase, setUploadPhase] = useState<string | null>(null);
  const uploadPollRef = useRef<number | null>(null);

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

  const chatFeedRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
        llm_ready: false,
        embed_ready: false,
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

  const scrollChatToBottom = (behavior: ScrollBehavior = "smooth") => {
    const feed = chatFeedRef.current;
    if (!feed) {
      return;
    }
    feed.scrollTo({
      top: feed.scrollHeight,
      behavior,
    });
  };

  const clearUploadPoll = () => {
    if (uploadPollRef.current !== null) {
      window.clearInterval(uploadPollRef.current);
      uploadPollRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearUploadPoll();
  }, []);

  useEffect(() => {
    if (messages.length === 0) {
      return;
    }
    const behavior: ScrollBehavior = messages.length < 2 ? "auto" : "smooth";
    const raf = window.requestAnimationFrame(() => scrollChatToBottom(behavior));
    return () => window.cancelAnimationFrame(raf);
  }, [messages.length]);

  const resizeChatInput = () => {
    const field = chatInputRef.current;
    if (!field) {
      return;
    }
    field.style.height = "0px";
    field.style.height = `${field.scrollHeight}px`;
  };

  useEffect(() => {
    resizeChatInput();
  }, [question]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setUploadError(null);
    setUploadResult(null);
    setUploadProgress(null);
    setUploadPhase(null);
  };

  const handleFileButtonClick = () => {
    fileInputRef.current?.click();
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
      setUploadProgress(0);
      setUploadPhase("queued");
      await new Promise((resolve) => setTimeout(resolve, 50));

      const accepted = await uploadPdf(selectedFile);
      let keepPolling = true;
      const poll = async () => {
        try {
          const status = await getUploadStatus(accepted.job_id);
          setUploadProgress(status.progress ?? 0);
          setUploadPhase(status.phase ?? "processing");

          if (status.status === "done") {
            setUploading(false);
            setUploadResult({
              status: "success",
              filename: status.filename ?? selectedFile.name,
              pages: status.pages ?? 0,
              chunks: status.chunks ?? 0,
              message: status.message ?? "Indexing completed successfully.",
            });
            keepPolling = false;
            clearUploadPoll();
            await refreshFiles();
          } else if (status.status === "error") {
            setUploading(false);
            setUploadError(status.error ?? "Indexing failed.");
            keepPolling = false;
            clearUploadPoll();
          }
        } catch (error) {
          setUploading(false);
          setUploadError(getErrorMessage(error));
          keepPolling = false;
          clearUploadPoll();
        }
      };

      clearUploadPoll();
      await poll();
      if (keepPolling) {
        uploadPollRef.current = window.setInterval(poll, 800);
      }
    } catch (error) {
      setUploading(false);
      setUploadError(getErrorMessage(error));
      setUploadProgress(null);
      setUploadPhase(null);
      clearUploadPoll();
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

  const progressBarClassName = uploadProgress === null
    ? "absolute inset-0 block h-full w-[40%] bg-[linear-gradient(90deg,transparent,#ff6b4a,#f2b94c,transparent)] animate-progressSlide motion-reduce:animate-none"
    : "block h-full w-0 bg-gradient-to-r from-accent to-accent2 transition-[width] duration-[350ms] ease-[ease]";

  const baseButtonClassName = "inline-flex items-center rounded-full border-0 px-[18px] py-[10px] font-semibold transition-[transform,box-shadow,background] duration-200 ease-[ease] hover:-translate-y-[1px] hover:shadow-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgba(255,107,74,0.35)] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none disabled:hover:translate-y-0 motion-reduce:transition-none max-[720px]:w-full max-[720px]:justify-center";
  const fileButtonClassName = `${baseButtonClassName} border border-[#e2c8b7] bg-[rgba(255,255,255,0.7)] text-[#3b2719]`;

  return (
    <div className="relative min-h-screen bg-[radial-gradient(circle_at_20%_20%,#ffe7d5_0%,transparent_50%),radial-gradient(circle_at_80%_10%,#fff1d7_0%,transparent_45%),linear-gradient(135deg,#f7efe7_0%,#f5e6da_50%,#f9f1e8_100%)] font-sans leading-[normal] text-ink selection:bg-[rgba(255,107,74,0.2)]">
      <div className="pointer-events-none fixed right-[-120px] top-[-120px] z-0 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(255,107,74,0.2),transparent_70%)] blur-[20px] opacity-50" />
      <div className="pointer-events-none fixed bottom-[-160px] left-[-140px] z-0 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(242,185,76,0.24),transparent_70%)] blur-[20px] opacity-50" />

      <div className="relative z-10 flex flex-col gap-8 px-16 pb-16 pt-10 max-[1100px]:px-6 max-[1100px]:pb-10 max-[1100px]:pt-8">
        <header className="flex items-center justify-between gap-6 max-[720px]:flex-col max-[720px]:items-start">
          <div className="flex flex-col gap-2">
            <div className="text-[clamp(2rem,4vw,3rem)] text-gray-800 font-bold tracking-[-0.02em]">Friday</div>
            <p className="max-w-[420px] text-[0.95rem] text-muted">
              A local RAG cockpit for indexing PDFs, grounding answers, and exporting study reports.
            </p>
          </div>
          <div className="flex items-center  gap-4 max-[1100px]:flex-col max-[1100px]:items-start">
            <div className="flex items-center gap-3 rounded-full border border-[#f3d5c5] bg-[rgba(255,255,255,0.7)] px-4 py-3 text-[0.92rem] font-medium shadow-soft">
              <span
                className={`h-[10px] w-[10px] rounded-full ${
                  healthState.llm_ready
                    ? "bg-success shadow-[0_0_0_4px_rgba(31,122,79,0.18)]"
                    : "bg-warning shadow-[0_0_0_4px_rgba(217,72,15,0.15)]"
                }`}
              />
              <span>
                {healthState.llm_ready
                  ? `${healthState.llm_provider} connected`
                  : `${healthState.llm_provider} missing key`}
              </span>
            </div>
            <div className="rounded-full bg-[#f8e9dd] px-[10px] py-[6px] font-mono text-[0.8rem] text-muted">
              LLM: {healthState.llm_model}
            </div>
            <div className="rounded-full bg-[#f8e9dd] px-[10px] py-[6px] font-mono text-[0.8rem] text-muted">
              {healthState.embed_ready ? "Embeddings" : "Embeddings missing key"}: {healthState.embed_model}
            </div>
          </div>
        </header>

        {healthError && (
          <div className="rounded-xl border border-[rgba(109,98,85,0.2)] bg-[rgba(109,98,85,0.1)] px-[14px] py-[10px] text-[0.88rem] text-[#4d4036]">
            {healthError}
          </div>
        )}

        <main className="grid grid-cols-[minmax(280px,360px)_minmax(0,1fr)] items-start gap-8 max-[1100px]:grid-cols-1">
          <section className="flex flex-col gap-6">
            <div
              className="relative overflow-hidden rounded-3xl border border-[#f1d9ca] bg-card p-6 shadow-soft after:absolute after:-right-10 after:-top-10 after:h-[140px] after:w-[140px] after:bg-[radial-gradient(circle,rgba(255,107,74,0.15),transparent_70%)] after:opacity-60 after:content-[''] animate-floatIn motion-reduce:animate-none"
              style={{ animationDelay: "0.05s" }}
            >
              <h2 className="mb-2 text-[1.2rem] font-semibold">Index a PDF</h2>
              <p className="mb-4 text-[0.92rem] text-muted">
                Upload notes to build your local knowledge base.
              </p>

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className={fileButtonClassName}
                      onClick={handleFileButtonClick}
                      disabled={uploading}
                    >
                      Choose PDF
                    </button>
                    <span className="text-[0.85rem] text-muted">
                      {selectedFile ? `Selected: ${selectedFile.name}` : "No file selected"}
                    </span>
                  </div>
                </div>

                {uploading && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-[0.85rem]">
                      <span className="text-muted">
                        {uploadPhase ? `Indexing: ${uploadPhase}` : "Indexing..."}
                      </span>
                      <span className="font-mono text-muted">{uploadProgress ?? 0}%</span>
                    </div>
                    <div className="relative h-2 overflow-hidden rounded-full border border-[rgba(255,107,74,0.25)] bg-[rgba(255,107,74,0.15)]">
                      <span
                        className={progressBarClassName}
                        style={uploadProgress !== null ? { width: `${uploadProgress}%` } : undefined}
                      />
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className={`${baseButtonClassName} bg-gradient-to-br from-accent to-accent3 text-[#1d120c] shadow-[0_10px_18px_rgba(255,107,74,0.28)] hover:shadow-soft`}
                    onClick={handleUpload}
                    disabled={uploading}
                  >
                    {uploading ? "Indexing..." : "Upload & Index"}
                  </button>
                </div>

                {uploadError && (
                  <div className="rounded-xl border border-[rgba(180,35,24,0.24)] bg-[rgba(180,35,24,0.1)] px-[14px] py-[10px] text-[0.88rem] text-[#8a1f15]">
                    {uploadError}
                  </div>
                )}
                {uploadResult && (
                  <div className="rounded-xl border border-[rgba(31,122,79,0.25)] bg-[rgba(31,122,79,0.12)] px-[14px] py-[10px] text-[0.88rem] text-[#1f5e3f]">
                    {uploadResult.message}
                  </div>
                )}

                {uploadResult && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1 rounded-2xl border border-[#f1d9ca] bg-[rgba(255,255,255,0.8)] p-3 text-[0.85rem]">
                      <span className="text-muted">Pages</span>
                      <strong className="text-[1.05rem]">{uploadResult.pages}</strong>
                    </div>
                    <div className="flex flex-col gap-1 rounded-2xl border border-[#f1d9ca] bg-[rgba(255,255,255,0.8)] p-3 text-[0.85rem]">
                      <span className="text-muted">Chunks</span>
                      <strong className="text-[1.05rem]">{uploadResult.chunks}</strong>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div
              className="relative overflow-hidden rounded-3xl border border-[#f1d9ca] bg-card p-6 shadow-soft after:absolute after:-right-10 after:-top-10 after:h-[140px] after:w-[140px] after:bg-[radial-gradient(circle,rgba(255,107,74,0.15),transparent_70%)] after:opacity-60 after:content-[''] animate-floatIn motion-reduce:animate-none"
              style={{ animationDelay: "0.1s" }}
            >
              <h2 className="mb-2 text-[1.2rem] font-semibold">Indexed Files</h2>
              <p className="mb-4 text-[0.92rem] text-muted">See which sources are ready for retrieval.</p>

              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className={`${baseButtonClassName} border border-[#e2c8b7] bg-transparent text-muted`}
                    onClick={refreshFiles}
                    disabled={filesLoading}
                  >
                    {filesLoading ? "Refreshing..." : "Refresh"}
                  </button>
                </div>

                {filesError && (
                  <div className="rounded-xl border border-[rgba(180,35,24,0.24)] bg-[rgba(180,35,24,0.1)] px-[14px] py-[10px] text-[0.88rem] text-[#8a1f15]">
                    {filesError}
                  </div>
                )}

                {sortedFiles.length === 0 && !filesLoading ? (
                  <div className="rounded-2xl border border-dashed border-[#e2c8b7] bg-[rgba(255,255,255,0.5)] p-6 text-center text-muted">
                    No files indexed yet.
                  </div>
                ) : (
                  <div className="flex max-h-[200px] flex-col gap-3 overflow-y-auto">
                    {sortedFiles.map((file) => (
                      <div
                        className="flex items-center justify-between gap-2 rounded-2xl border border-[#ead2c4] bg-[rgba(255,255,255,0.7)] px-3 py-[10px] text-[0.9rem]"
                        key={file.source}
                      >
                        <div>
                          <div>{file.source}</div>
                          <div className="text-[0.8rem] text-muted">Chunks: {file.chunk_count}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div
              className="relative overflow-hidden rounded-3xl border border-[#f1d9ca] bg-card p-6 shadow-soft after:absolute after:-right-10 after:-top-10 after:h-[140px] after:w-[140px] after:bg-[radial-gradient(circle,rgba(255,107,74,0.15),transparent_70%)] after:opacity-60 after:content-[''] animate-floatIn motion-reduce:animate-none"
              style={{ animationDelay: "0.15s" }}
            >
              <h2 className="mb-2 text-[1.2rem] font-semibold">Actions</h2>
              <p className="mb-4 text-[0.92rem] text-muted">Reset the workspace or export the latest report.</p>

              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className={`${baseButtonClassName} bg-[#f7e1d2] text-[#3b2719]`}
                    onClick={handleReset}
                    disabled={resetLoading}
                  >
                    {resetLoading ? "Resetting..." : "Reset Database"}
                  </button>
                  <button
                    className={`${baseButtonClassName} bg-gradient-to-br from-accent to-accent3 text-[#1d120c] shadow-[0_10px_18px_rgba(255,107,74,0.28)] hover:shadow-soft`}
                    onClick={handleDownloadReport}
                    disabled={reportLoading}
                  >
                    {reportLoading ? "Preparing..." : "Download Report"}
                  </button>
                </div>

                {resetError && (
                  <div className="rounded-xl border border-[rgba(180,35,24,0.24)] bg-[rgba(180,35,24,0.1)] px-[14px] py-[10px] text-[0.88rem] text-[#8a1f15]">
                    {resetError}
                  </div>
                )}
                {reportError && (
                  <div className="rounded-xl border border-[rgba(109,98,85,0.2)] bg-[rgba(109,98,85,0.1)] px-[14px] py-[10px] text-[0.88rem] text-[#4d4036]">
                    {reportError}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-6">
            <div
              className="relative flex min-h-[460px] flex-col gap-4 overflow-hidden rounded-3xl border border-[#f1d9ca] bg-card p-6 shadow-soft after:absolute after:-right-10 after:-top-10 after:h-[140px] after:w-[140px] after:bg-[radial-gradient(circle,rgba(255,107,74,0.15),transparent_70%)] after:opacity-60 after:content-[''] animate-floatIn motion-reduce:animate-none"
              style={{ animationDelay: "0.05s" }}
            >
              <h2 className="text-[1.2rem] font-semibold">Conversation</h2>
              <p className="text-[0.92rem] text-muted">Ask questions grounded in your uploaded notes.</p>

              <div ref={chatFeedRef} className="flex max-h-[420px] flex-col gap-3 overflow-y-auto pr-2">
                {messages.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#e2c8b7] bg-[rgba(255,255,255,0.5)] p-6 text-center text-muted">
                    No messages yet. Ask your first question.
                  </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${
                        message.role === "user" ? "justify-end" : "justify-start"
                      } animate-riseIn motion-reduce:animate-none`}
                    >
                      <div
                        className={`max-w-[min(620px,80%)] whitespace-pre-wrap rounded-[18px] border p-3 text-[0.95rem] leading-[1.5] shadow-bubble ${
                          message.role === "user"
                            ? "border-[#f5c6a6] bg-[#ffe9dc]"
                            : "border-[#f1d9ca] bg-[#fffdf9]"
                        }`}
                      >
                        {message.content}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {chatError && (
                <div className="rounded-xl border border-[rgba(180,35,24,0.24)] bg-[rgba(180,35,24,0.1)] px-[14px] py-[10px] text-[0.88rem] text-[#8a1f15]">
                  {chatError}
                </div>
              )}

              <form
                className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 max-[720px]:grid-cols-1"
                onSubmit={handleSend}
              >
                <textarea
                  ref={chatInputRef}
                  className="min-h-[80px] w-full resize-none overflow-hidden rounded-2xl border border-[#e6cbb9] bg-[rgba(255,255,255,0.9)] p-3 text-[0.95rem] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgba(255,107,74,0.35)] focus-visible:outline-offset-2"
                  placeholder="Ask Friday something about your notes..."
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                />
                <button
                  className={`${baseButtonClassName} bg-gradient-to-br from-accent to-accent3 text-[#1d120c] shadow-[0_10px_18px_rgba(255,107,74,0.28)] hover:shadow-soft`}
                  type="submit"
                  disabled={chatLoading}
                >
                  {chatLoading ? "Thinking..." : "Send"}
                </button>
              </form>
            </div>

            <div
              className="relative flex flex-col gap-3 overflow-hidden rounded-3xl border border-[#f1d9ca] bg-card p-6 shadow-soft after:absolute after:-right-10 after:-top-10 after:h-[140px] after:w-[140px] after:bg-[radial-gradient(circle,rgba(255,107,74,0.15),transparent_70%)] after:opacity-60 after:content-[''] animate-floatIn motion-reduce:animate-none"
              style={{ animationDelay: "0.1s" }}
            >
              <h2 className="text-[1.2rem] font-semibold">Sources & Confidence</h2>
              <p className="text-[0.92rem] text-muted">Latest retrieval context powering the answer.</p>

              <div className="flex items-center justify-between gap-2 rounded-2xl border border-[#ead2c4] bg-[rgba(255,255,255,0.7)] px-[14px] py-[10px] text-[0.92rem]">
                <span className="text-muted">Confidence</span>
                <span className="font-mono text-[1rem]">{confidenceLabel}</span>
              </div>

              {isLowConfidence && (
                <div className="rounded-xl border border-[rgba(109,98,85,0.2)] bg-[rgba(109,98,85,0.1)] px-[14px] py-[10px] text-[0.88rem] text-[#4d4036]">
                  The latest answer has low confidence or lacks enough source coverage.
                </div>
              )}

              {latestSources.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#e2c8b7] bg-[rgba(255,255,255,0.5)] p-6 text-center text-muted">
                  No sources to show yet.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {latestSources.map((source, index) => (
                    <div
                      className="rounded-2xl border border-[#ead2c4] bg-[rgba(255,255,255,0.65)] px-3 py-[10px] text-[0.88rem]"
                      key={`${source.source ?? "source"}-${index}`}
                    >
                      <strong className="mb-1 block">
                        Page {source.page_num ?? "?"} - {source.source ?? "Unknown"}
                      </strong>
                      <span className="text-muted">{source.excerpt}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
