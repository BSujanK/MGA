import type { CalEvent } from "./calendar";
import type {
  CandidateProfile, ChatResponse, ChatTurn, GapReport, JobPosting, JobProfile, JobRef, MarketReport, PrepKit, Resource,
  ResumeSection, SkillInfo, SkillOverride, TailoredResume,
} from "./types";

export interface AccountUser {
  id: string;
  email: string;
  name?: string | null;
  created_at: string;
  is_new?: boolean;
}

export interface SavedReportMeta {
  id: string;
  kind: "gap" | "market" | "tailored" | "prep";
  title: string;
  job_id?: string | null;
  summary: Record<string, unknown>;
  created_at: string;
}

export interface JobFit {
  job: Omit<JobPosting, "description">;
  readiness: number;
  must_have_coverage: number;
  open_must: string[];
  est_hours: number;
}

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    const headers = new Headers(init?.headers);
    headers.set("X-Requested-With", "mga");
    res = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: "include" });
  } catch {
    throw new ApiError(`Can't reach the MGA API at ${API_URL}. Is the backend running?`, 0);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {}
    throw new ApiError(detail, res.status);
  }
  return res;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await send(path, init)).json() as Promise<T>;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function put<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export const api = {
  authConfig: () => request<{ email: boolean; google_client_id: string | null; terms_version: string }>("/auth/config"),
  sendCode: (email: string) => post<{ sent: boolean; dev_code?: string | null }>("/auth/code", { email }),
  verifyCode: (email: string, code: string, accept_terms: boolean) =>
    post<AccountUser>("/auth/verify", { email, code, accept_terms }),
  googleSignIn: (credential: string, accept_terms: boolean) => post<AccountUser>("/auth/google", { credential, accept_terms }),
  logout: () => post<{ ok: boolean }>("/auth/logout", {}),
  logoutAll: () => post<{ ok: boolean }>("/auth/logout-all", {}),
  me: () => request<{ user: AccountUser; has_resume: boolean; counts: Record<string, number> }>("/me"),
  deleteMe: () => request<{ deleted: boolean }>("/me", { method: "DELETE" }),
  exportMe: async () => (await send("/me/export")).blob(),
  getProfile: () =>
    request<{ resume_text: string; file_name?: string | null; overrides: SkillOverride[]; updated_at?: string | null }>("/me/profile"),
  putProfile: (body: { resume_text: string; file_name?: string | null; overrides: SkillOverride[] }) => put("/me/profile", body),
  getDocs: (kind: "tuner" | "prep") =>
    request<Record<string, { data: unknown; updated_at: string }>>(`/me/documents/${kind}`),
  putDoc: (kind: "tuner" | "prep", key: string, data: unknown) =>
    put(`/me/documents/${kind}/${encodeURIComponent(key)}`, { data }),
  deleteDoc: (kind: "tuner" | "prep", key: string) =>
    request(`/me/documents/${kind}/${encodeURIComponent(key)}`, { method: "DELETE" }),
  getCalendar: () => request<CalEvent[]>("/me/calendar"),
  putEvent: (ev: CalEvent) => put(`/me/calendar/${encodeURIComponent(ev.id)}`, ev),
  deleteEvent: (id: string) => request(`/me/calendar/${encodeURIComponent(id)}`, { method: "DELETE" }),
  importLocal: (body: { profile?: unknown; tuner: unknown; prep: unknown; calendar: unknown[] }) => post("/me/import", body),
  reports: () => request<SavedReportMeta[]>("/me/reports"),
  saveReport: (body: { kind: SavedReportMeta["kind"]; title: string; job_id?: string; summary: Record<string, unknown>; data: unknown }) =>
    post<SavedReportMeta>("/me/reports", body),
  deleteReport: (id: string) => request(`/me/reports/${encodeURIComponent(id)}`, { method: "DELETE" }),
  jobFit: (body: { resume_text?: string; overrides?: SkillOverride[]; role?: string; location?: string; q?: string; limit?: number }) =>
    post<{ jobs: JobFit[]; considered: number; used_saved_profile: boolean }>("/jobs/fit", body),
  health: () => request<{ status: string; llm_enabled: boolean; skills: number; jobs: number }>("/health"),
  skills: () => request<SkillInfo[]>("/skills"),
  jobs: (params: { role?: string; location?: string; q?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return request<JobPosting[]>(`/jobs?${qs}`);
  },
  job: (id: string) => request<JobPosting>(`/jobs/${encodeURIComponent(id)}`),
  analyzeJob: (text: string) => post<JobProfile>("/analyze/job", { text }),
  analyzeResume: (text: string) => post<CandidateProfile>("/analyze/resume", { text }),
  parseResume: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ filename: string; text: string; chars: number }>("/resume/parse", { method: "POST", body: form });
  },
  gap: (body: { resume_text?: string; overrides?: SkillOverride[]; job_id?: string; job_text?: string }) =>
    post<GapReport>("/gap", body),
  market: (body: { role: string; location?: string; resume_text?: string; overrides?: SkillOverride[]; top?: number }) =>
    post<MarketReport>("/market", body),
  learn: (skillId: string, level = 0) => request<Resource[]>(`/learn/${skillId}?level=${level}`),
  resumeChat: (body: JobRef & { resume_text?: string; overrides?: SkillOverride[]; turns: ChatTurn[]; max_questions?: number }) =>
    post<ChatResponse>("/resume/chat", body),
  resumeTailor: (body: JobRef & { resume_text: string; overrides?: SkillOverride[]; turns: ChatTurn[] }) =>
    post<TailoredResume>("/resume/tailor", body),
  prep: (body: JobRef & { resume_text?: string; overrides?: SkillOverride[]; hours_per_week?: number }) =>
    post<PrepKit>("/prep", body),
  exportDocx: async (body: { header: string[]; sections: ResumeSection[]; filename?: string }) => {
    const res = await send("/resume/export/docx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.blob();
  },
};
