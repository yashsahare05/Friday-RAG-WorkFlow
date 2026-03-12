const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

type ErrorPayload = {
  detail?: string;
  message?: string;
};

const parseErrorMessage = async (response: Response): Promise<string> => {
  const fallback = `Request failed (${response.status})`;
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    return fallback;
  }

  if (!bodyText) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(bodyText) as ErrorPayload;
    if (parsed.detail) {
      return parsed.detail;
    }
    if (parsed.message) {
      return parsed.message;
    }
  } catch {
    // Not JSON, fall through.
  }

  return bodyText;
};

const fetchJson = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as T;
};

const postJson = async <T>(path: string, payload: unknown): Promise<T> => {
  return fetchJson<T>(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
};

export type HealthResponse = {
  status: string;
  ollama: boolean;
  model: string;
};

export type UploadResponse = {
  status: string;
  filename: string;
  pages: number;
  chunks: number;
  message: string;
};

export type ChatHistoryItem = {
  question: string;
  answer: string;
};

export type ChatSource = {
  page_num: number | null;
  source: string | null;
  excerpt: string;
};

export type ChatResponse = {
  answer: string;
  sources: ChatSource[];
  confidence: number;
};

export type SourceInfo = {
  source: string;
  chunk_count: number;
};

export type ResetResponse = {
  status: string;
  message: string;
};

export const health = () => fetchJson<HealthResponse>("/health");

export const uploadPdf = async (file: File): Promise<UploadResponse> => {
  const form = new FormData();
  form.append("file", file);

  const response = await fetch(`${API_URL}/upload`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as UploadResponse;
};

export const chat = (question: string, history: ChatHistoryItem[]) => {
  return postJson<ChatResponse>("/chat", { question, history });
};

export const getFiles = () => fetchJson<SourceInfo[]>("/files");

export const reset = () => fetchJson<ResetResponse>("/reset", { method: "DELETE" });

export const downloadReport = async (): Promise<Blob> => {
  const response = await fetch(`${API_URL}/report`);

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return response.blob();
};