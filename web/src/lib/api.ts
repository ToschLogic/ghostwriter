export type MachineState = "idle" | "queued" | "running" | "completed" | "error";

export type TagResult = {
  index: number;
  url: string;
  status: string;
  uid: string | null;
  message: string | null;
  started_at: string | null;
  completed_at: string | null;
};

export type CurrentJob = {
  jobId: string;
  state: MachineState;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  currentTagIndex: number | null;
  currentUid: string | null;
  results: TagResult[];
};

export type MachineStatus = {
  state: MachineState;
  jobId: string | null;
  totalTags: number;
  completedTags: number;
  currentTagNumber: number | null;
  lastUid: string | null;
  lastMessage: string;
  lastError: string | null;
  updatedAt: string;
  job: CurrentJob | null;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_GHOSTWRITER_API_BASE_URL ?? "http://localhost:8000";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = payload?.detail ?? `Request failed with status ${response.status}`;
    throw new Error(detail);
  }

  return response.json() as Promise<T>;
}

export function getMachineStatus() {
  return apiFetch<MachineStatus>("/api/status");
}

export function createJob(urls: string[]) {
  return apiFetch<{ jobId: string; state: MachineState; job: CurrentJob }>("/api/jobs", {
    method: "POST",
    body: JSON.stringify({
      tags: urls.map((url) => ({ url })),
    }),
  });
}