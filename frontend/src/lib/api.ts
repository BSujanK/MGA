import type {
  CandidateProfile, ChatResponse, ChatTurn, GapReport, JobPosting, JobProfile, JobRef, MarketReport, Resource,
  ResumeSection, SkillInfo, SkillOverride, TailoredResume,
} from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
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

export const api = {
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
  exportDocx: async (body: { header: string[]; sections: ResumeSection[]; filename?: string }) => {
    const res = await send("/resume/export/docx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.blob();
  },
};
