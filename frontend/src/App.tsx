import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

// Import Questrial font for modern geometric feel
const fontLink = document.createElement('link');
fontLink.href = 'https://fonts.googleapis.com/css2?family=Questrial&display=swap';
fontLink.rel = 'stylesheet';
document.head.appendChild(fontLink);
import {
  chat,
  chatStream,
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

  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem("friday-dark-mode");
    return saved === "true";
  });

  const chatFeedRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    localStorage.setItem("friday-dark-mode", String(darkMode));
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  useEffect(() => {
    if (chatFeedRef.current) {
      chatFeedRef.current.scrollTo({
        top: chatFeedRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages]);

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
      const assistantId = makeId();
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
      };

      setMessages((prev) => [...prev, assistantMessage]);

      let fullAnswer = "";
      await chatStream(
        trimmed,
        historySnapshot,
        (chunk) => {
          fullAnswer += chunk;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: fullAnswer } : m))
          );
        },
        (response) => {
          setChatHistory((prev) => [...prev, { question: trimmed, answer: response.answer }]);
          setLatestSources(response.sources || []);
          setLatestConfidence(response.confidence ?? null);
          setLatestAnswer(response.answer);
          
          // Final sync of content just in case
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: response.answer } : m))
          );
        }
      );
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

  const baseButtonClassName = "inline-flex items-center rounded-full border-0 px-[18px] py-[10px] font-semibold transition-all duration-300 ease-[ease] hover:-translate-y-[1px] hover:shadow-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgba(255,107,74,0.35)] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none disabled:hover:translate-y-0 motion-reduce:transition-none max-[720px]:w-full max-[720px]:justify-center";
  const fileButtonClassName = `${baseButtonClassName} border border-[#e2c8b7] dark:border-[#4d4036] bg-[rgba(255,255,255,0.7)] dark:bg-[rgba(30,30,30,0.7)] text-[#3b2719] dark:text-[#e4e4e7]`;

  return (
    <div className={`relative min-h-screen ${darkMode ? 'dark bg-[#121212]' : 'bg-[#f7efe7]'} font-sans leading-[normal] text-ink dark:text-gray-100 selection:bg-[rgba(255,107,74,0.2)] transition-all duration-300`}>
      {/* Light Mode Gradients Layer */}
      <div 
        className={`pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_20%_20%,#ffe7d5_0%,transparent_50%),radial-gradient(circle_at_80%_10%,#fff1d7_0%,transparent_45%),linear-gradient(135deg,#f7efe7_0%,#f5e6da_50%,#f9f1e8_100%)] transition-opacity duration-300 ${darkMode ? 'opacity-0' : 'opacity-100'}`}
      />
      
      {/* Dark Mode Gradients Layer */}
      <div 
        className={`pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_20%_20%,#1a1512_0%,transparent_50%),radial-gradient(circle_at_80%_10%,#181614_0%,transparent_45%)] transition-opacity duration-300 ${darkMode ? 'opacity-100' : 'opacity-0'}`}
      />

      <div className="pointer-events-none fixed right-[-120px] top-[-120px] z-0 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(255,107,74,0.15),transparent_70%)] blur-[20px] transition-opacity duration-300 opacity-40 dark:opacity-20" />
      <div className="pointer-events-none fixed bottom-[-160px] left-[-140px] z-0 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(242,185,76,0.18),transparent_70%)] blur-[20px] transition-opacity duration-300 opacity-40 dark:opacity-15" />

      <div className="relative z-10 flex flex-col gap-5 px-16 pb-16 pt-2 max-[1100px]:px-6 max-[1100px]:pb-10 max-[1100px]:pt-2">
        <header className="flex items-center justify-between gap-6 max-[720px]:flex-col max-[720px]:items-start">
          <div className="flex flex-col pt-2">
            <div 
              className="text-[clamp(1.6rem,3vw,2.2rem)] font-bold tracking-[0.12em] text-gray-900 dark:text-white uppercase"
              style={{ fontFamily: "'Questrial', sans-serif" }}
            >
              FRIDAY
            </div>
          </div>
          <div className="flex flex-col items-end gap-3 max-[1100px]:items-start">
            <div className="flex items-center gap-2 max-[1100px]:flex-col max-[1100px]:items-start">
              <div className="flex items-center gap-2 rounded-full border border-[#f3d5c5] dark:border-[#4d4036] bg-[rgba(255,255,255,0.6)] dark:bg-[rgba(30,30,30,0.6)] px-2.5 py-1 text-[0.8rem] font-medium shadow-soft backdrop-blur-sm">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    healthState.llm_ready
                      ? "bg-success shadow-[0_0_0_2px_rgba(31,122,79,0.1)]"
                      : "bg-warning shadow-[0_0_0_2px_rgba(217,72,15,0.08)]"
                  }`}
                />
                <span className="text-gray-700 dark:text-gray-300 capitalize">
                  {healthState.llm_ready
                    ? `${healthState.llm_provider} connected`
                    : `${healthState.llm_provider} offline`}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="rounded-full border border-[rgba(248,233,221,0.8)] dark:border-[#4d4036] bg-[rgba(248,233,221,0.5)] dark:bg-[rgba(40,40,40,0.5)] px-2 py-0.5 font-mono text-[0.7rem] text-muted-dark dark:text-gray-400 backdrop-blur-sm">
                  LLM: {healthState.llm_model}
                </div>
                <div className="rounded-full border border-[rgba(248,233,221,0.8)] dark:border-[#4d4036] bg-[rgba(248,233,221,0.5)] dark:bg-[rgba(40,40,40,0.5)] px-2 py-0.5 font-mono text-[0.7rem] text-muted-dark dark:text-gray-400 backdrop-blur-sm">
                  {healthState.embed_ready ? "Embeddings" : "No Embed"}: {healthState.embed_model}
                </div>
              </div>
            </div>
          </div>
        </header>

        {healthError && (
          <div className="rounded-xl border border-[rgba(109,98,85,0.2)] bg-[rgba(109,98,85,0.1)] px-[14px] py-[10px] text-[0.88rem] text-[#4d4036]">
            {healthError}
          </div>
        )}

        <div className="flex items-center justify-between gap-6 max-[1100px]:flex-col max-[1100px]:items-start">
          <div className="max-w-[600px] border-l-2 border-accent pl-4 animate-fadeIn">
            <p className="text-[0.82rem] leading-relaxed tracking-tight text-[#6d6255] dark:text-gray-400 font-medium">
              Master your knowledge. A private, high-performance RAG environment for indexing documents, grounded AI research, and automated study reporting.
            </p>
          </div>

          <div className="flex items-center gap-4 animate-fadeIn" style={{ animationDelay: "0.1s" }}>
            <div className="flex items-center gap-4">
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[#f3d5c5] dark:border-[#4d4036] bg-[rgba(255,255,255,0.6)] dark:bg-[rgba(30,30,30,0.6)] text-[#3b2719] dark:text-[#e4e4e7] shadow-soft transition-transform hover:scale-110 active:scale-95"
                title="Toggle Theme"
                onClick={() => setDarkMode(!darkMode)}
              >
                {darkMode ? (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 5a7 7 0 100 14 7 7 0 000-14z" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
              </button>
              
              <div className="flex items-center gap-2.5 rounded-full border border-[#f3d5c5] dark:border-[#4d4036] bg-[rgba(255,255,255,0.6)] dark:bg-[rgba(30,30,30,0.6)] pl-1 pr-3 py-1 shadow-soft backdrop-blur-sm transition-all hover:bg-[rgba(255,255,255,0.8)] dark:hover:bg-[rgba(40,40,40,0.8)]">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent3 text-[0.75rem] font-bold text-white shadow-sm">
                  YS
                </div>
                <span className="text-[0.82rem] font-semibold text-gray-800 dark:text-gray-100">Yash Sahare</span>
              </div>
            </div>
          </div>
        </div>

        <main className="grid grid-cols-[minmax(280px,360px)_minmax(0,1fr)] items-start gap-8 max-[1100px]:grid-cols-1">
          <section className="flex flex-col gap-6">
            <div
              className="relative overflow-hidden rounded-3xl border border-[#f1d9ca] dark:border-[#332b26] bg-card dark:bg-[#1a1a1a] pt-4 px-6 pb-6 shadow-soft dark:shadow-[0_10px_24px_rgba(0,0,0,0.3)] transition-all duration-300"
            >
              <div className="mb-4 flex items-center gap-2">
                <svg className="h-5 w-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <h2 className="text-[1.15rem] font-bold tracking-tight text-gray-800 dark:text-gray-100">Index a PDF</h2>
              </div>
              <p className="mb-5 text-[0.9rem] leading-relaxed text-[#6d6255] dark:text-gray-400">
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
                    <span className="text-[0.85rem] text-muted dark:text-gray-400">
                      {selectedFile ? `Selected: ${selectedFile.name}` : "No file selected"}
                    </span>
                  </div>
                </div>

                {uploading && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-[0.85rem]">
                      <span className="text-muted dark:text-gray-400">
                        {uploadPhase ? `Indexing: ${uploadPhase}` : "Indexing..."}
                      </span>
                      <span className="font-mono text-muted dark:text-gray-400">{uploadProgress ?? 0}%</span>
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
                    <div className="flex flex-col gap-1 rounded-2xl border border-[#f1d9ca] dark:border-[#332b26] bg-[rgba(255,255,255,0.8)] dark:bg-[rgba(30,30,30,0.8)] p-3 text-[0.85rem] transition-all duration-300">
                      <span className="text-muted dark:text-gray-400">Pages</span>
                      <strong className="text-[1.05rem] dark:text-gray-100">{uploadResult.pages}</strong>
                    </div>
                    <div className="flex flex-col gap-1 rounded-2xl border border-[#f1d9ca] dark:border-[#332b26] bg-[rgba(255,255,255,0.8)] dark:bg-[rgba(30,30,30,0.8)] p-3 text-[0.85rem] transition-all duration-300">
                      <span className="text-muted dark:text-gray-400">Chunks</span>
                      <strong className="text-[1.05rem] dark:text-gray-100">{uploadResult.chunks}</strong>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div
              className="relative overflow-hidden rounded-3xl border border-[#f1d9ca] dark:border-[#332b26] bg-card dark:bg-[#1a1a1a] pt-4 px-6 pb-6 shadow-soft dark:shadow-[0_10px_24px_rgba(0,0,0,0.3)] transition-all duration-300"
            >
              <div className="mb-4 flex items-center gap-2">
                <svg className="h-5 w-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h2 className="text-[1.15rem] font-bold tracking-tight text-gray-800 dark:text-gray-100">Indexed Files</h2>
              </div>
              <p className="mb-5 text-[0.9rem] leading-relaxed text-[#6d6255] dark:text-gray-400">See which sources are ready for retrieval.</p>

              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className={`${baseButtonClassName} border border-[#e2c8b7] dark:border-[#4d4036] bg-transparent text-muted dark:text-gray-400`}
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
                  <div className="rounded-2xl border border-dashed border-[#e2c8b7] dark:border-[#4d4036] bg-[rgba(255,255,255,0.5)] dark:bg-[rgba(30,30,30,0.5)] p-6 text-center text-muted dark:text-gray-500">
                    No files indexed yet.
                  </div>
                ) : (
                  <div className="custom-scrollbar flex max-h-[200px] flex-col gap-3 overflow-y-auto pr-1">
                    {sortedFiles.map((file) => (
                      <div
                        className="flex items-center justify-between gap-2 rounded-2xl border border-[#ead2c4] dark:border-[#332b26] bg-[rgba(255,255,255,0.7)] dark:bg-[rgba(30,30,30,0.7)] px-3 py-[10px] text-[0.9rem] dark:text-gray-200 transition-all duration-300"
                        key={file.source}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium" title={file.source}>{file.source}</div>
                          <div className="text-[0.8rem] text-muted dark:text-gray-500">Chunks: {file.chunk_count}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div
              className="relative overflow-hidden rounded-3xl border border-[#f1d9ca] dark:border-[#332b26] bg-card dark:bg-[#1a1a1a] pt-4 px-6 pb-6 shadow-soft dark:shadow-[0_10px_24px_rgba(0,0,0,0.3)] transition-all duration-300"
            >
              <div className="mb-4 flex items-center gap-2">
                <svg className="h-5 w-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <h2 className="text-[1.15rem] font-bold tracking-tight text-gray-800 dark:text-gray-100">Quick Actions</h2>
              </div>
              <p className="mb-5 text-[0.9rem] leading-relaxed text-[#6d6255] dark:text-gray-400">Reset the workspace or export the latest report.</p>

              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className={`${baseButtonClassName} bg-[#f7e1d2] dark:bg-[#3d2b1f] text-[#3b2719] dark:text-[#f3d5c5]`}
                    onClick={handleReset}
                    disabled={resetLoading}
                  >
                    {resetLoading ? "Resetting..." : "Reset Database"}
                  </button>
                  <button
                    className={`${baseButtonClassName} bg-gradient-to-br from-accent to-accent3 text-white shadow-[0_10px_18px_rgba(255,107,74,0.28)] hover:shadow-soft`}
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
              className="relative flex flex-col gap-4 overflow-hidden rounded-3xl border border-[#f1d9ca] dark:border-[#332b26] bg-card dark:bg-[#1a1a1a] pt-4 px-6 pb-6 shadow-soft dark:shadow-[0_10px_24px_rgba(0,0,0,0.3)] transition-all duration-300"
            >
              <div className="mb-3 flex items-center gap-2">
                <svg className="h-5 w-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <h2 className="text-[1.15rem] font-bold tracking-tight text-gray-800 dark:text-gray-100">Friday Conversation</h2>
              </div>
              <p className="mb-5 text-[0.9rem] leading-relaxed text-[#6d6255] dark:text-gray-400">Ask questions grounded in your uploaded notes.</p>

              <div ref={chatFeedRef} className="custom-scrollbar flex max-h-[420px] flex-col gap-3 overflow-y-auto pr-2">
                {messages.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#e2c8b7] dark:border-[#4d4036] bg-[rgba(255,255,255,0.5)] dark:bg-[rgba(30,30,30,0.5)] p-6 text-center text-muted dark:text-gray-500">
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
                        className={`max-w-[min(620px,85%)] rounded-[22px] border px-4 py-3 text-[0.95rem] leading-[1.6] shadow-sm transition-all duration-300 ${
                          message.role === "user"
                            ? "whitespace-pre-wrap border-[#f5c6a6] dark:border-[#5a4332] bg-[#ffe9dc] dark:bg-[#3d2b1f] text-[#3b2719] dark:text-[#f3d5c5]"
                            : "prose-chat border-[#f1d9ca] dark:border-[#332b26] bg-white dark:bg-[#262626] text-[#2a1e17] dark:text-gray-200"
                        }`}
                      >
                        {message.role === "assistant" ? (
                          message.content === "" ? (
                            <div className="flex items-center gap-1.5 py-1.5 px-1">
                              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60" style={{ animationDelay: "0ms" }}></div>
                              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60" style={{ animationDelay: "150ms" }}></div>
                              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60" style={{ animationDelay: "300ms" }}></div>
                            </div>
                          ) : (
                            <ReactMarkdown
                              remarkPlugins={[remarkMath]}
                              rehypePlugins={[rehypeKatex]}
                            >
                              {message.content
                                .replace(/\\\[/g, "$$")
                                .replace(/\\\]/g, "$$")
                                .replace(/\\\(/g, "$")
                                .replace(/\\\)/g, "$")}
                            </ReactMarkdown>
                          )
                        ) : (
                          message.content
                        )}
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
                  className="min-h-[80px] w-full resize-none overflow-y-auto rounded-2xl border border-[#e6cbb9] dark:border-[#4d4036] bg-[rgba(255,255,255,0.9)] dark:bg-[rgba(30,30,30,0.9)] p-4 text-[0.95rem] dark:text-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgba(255,107,74,0.35)] focus-visible:outline-offset-2 transition-all duration-300"
                  placeholder="Ask Friday something about your notes..."
                  value={question}
                  onChange={(event) => {
                    setQuestion(event.target.value);
                    // Auto-resize
                    event.target.style.height = "auto";
                    event.target.style.height = `${event.target.scrollHeight}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend(e as any);
                    }
                  }}
                  style={{ maxHeight: "200px" }}
                />
                <button
                  className={`${baseButtonClassName} bg-accent text-white shadow-[0_4px_14px_rgba(255,107,74,0.3)] hover:bg-[#e65a3d] hover:shadow-[0_6px_20px_rgba(255,107,74,0.4)]`}
                  type="submit"
                  disabled={chatLoading}
                >
                  {chatLoading ? "Thinking..." : "Send Question"}
                </button>
              </form>
            </div>

            <div
              className="relative flex flex-col gap-3 overflow-hidden rounded-3xl border border-[#f1d9ca] dark:border-[#332b26] bg-card dark:bg-[#1a1a1a] pt-4 px-6 pb-6 shadow-soft dark:shadow-[0_10px_24px_rgba(0,0,0,0.3)] transition-all duration-300"
            >
              <div className="mb-3 flex items-center gap-2">
                <svg className="h-5 w-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <h2 className="text-[1.15rem] font-bold tracking-tight text-gray-800 dark:text-gray-100">Sources & Confidence</h2>
              </div>
              <p className="mb-5 text-[0.9rem] leading-relaxed text-[#6d6255] dark:text-gray-400">Latest retrieval context powering the answer.</p>

              <div className="flex items-center justify-between gap-2 rounded-2xl border border-[#ead2c4] dark:border-[#332b26] bg-[rgba(255,255,255,0.7)] dark:bg-[rgba(40,40,40,0.7)] px-[14px] py-[10px] text-[0.92rem] transition-all duration-300">
                <span className="text-muted dark:text-gray-400">Confidence</span>
                <span className="font-bold text-accent dark:text-accent">
                  {latestConfidence !== null ? `${latestConfidence}%` : "--"}
                </span>
              </div>

              {isLowConfidence && (
                <div className="rounded-xl border border-[rgba(109,98,85,0.2)] bg-[rgba(109,98,85,0.1)] px-[14px] py-[10px] text-[0.88rem] text-[#4d4036] dark:text-[#cfc3b7]">
                  The latest answer has low confidence or lacks enough source coverage.
                </div>
              )}

              {latestSources.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#e2c8b7] dark:border-[#4d4036] bg-[rgba(255,255,255,0.5)] dark:bg-[rgba(30,30,30,0.5)] p-6 text-center text-muted dark:text-gray-500">
                  No sources to show yet.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {latestSources.map((source, index) => (
                    <div
                      className="rounded-2xl border border-[#ead2c4] dark:border-[#3d342f] bg-[rgba(255,255,255,0.65)] dark:bg-[rgba(40,40,40,0.65)] px-3 py-[10px] text-[0.88rem] dark:text-gray-100 transition-all duration-300"
                      key={`${source.source ?? "source"}-${index}`}
                    >
                      <strong className="mb-1 block truncate dark:text-accent" title={source.source ?? "Unknown"}>
                        Page {source.page_num ?? "?"} - {source.source ?? "Unknown"}
                      </strong>
                      <span className="text-muted dark:text-gray-400">{source.excerpt}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </main>

        <footer className="mt-12 flex flex-col items-center gap-4 border-t border-[#ead2c4] dark:border-[#332b26] pt-8 transition-all duration-300">
          <div className="flex items-center gap-6">
            <a 
              href="https://github.com/yashsahare05" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-[0.85rem] font-medium text-muted hover:text-accent transition-colors"
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.041-1.416-4.041-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              @yashsahare05
            </a>
          </div>
          <p className="text-[0.78rem] text-muted dark:text-gray-500 font-medium">
            &copy; 2026 Friday-RAG Agent. Built for researchers and students.
          </p>
        </footer>
      </div>
    </div>
  );
}
