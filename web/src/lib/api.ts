export type MachineState = "idle" | "queued" | "running" | "completed" | "error" | "cancelled" | "priming";

export type MachineSettings = {
  stepCountPerTag: number;
};

export type NudgeDirection = "forward" | "backward";

export type TagResult = {
  index: number;
  url: string;
  status: string;
  uid: string | null;
  message: string | null;
  started_at: string | null;
  completed_at: string | null;
};

export type BackendStatus = {
  enabled: boolean;
  writerKey: string;
  realtimeStatus: string;
  availableJobCount: number;
  lastError: string | null;
};

export type BackendJob = {
  id: string;
  writerKey: string;
  status: string;
  createdAt: string | null;
  requestedAt: string | null;
  tagCount: number;
  lotName: string | null;
  jobType: string | null;
  jobOptions: Record<string, unknown>;
};

export type CurrentJob = {
  jobId: string;
  source: "local" | "supabase";
  remoteJobId: string | null;
  writerKey: string | null;
  lotName: string | null;
  jobType: string | null;
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
  jobSource: "local" | "supabase" | null;
  totalTags: number;
  completedTags: number;
  currentTagNumber: number | null;
  lastUid: string | null;
  lastMessage: string;
  lastError: string | null;
  updatedAt: string;
  job: CurrentJob | null;
  backend: BackendStatus;
  primingTagPresent: boolean;
  primingUid: string | null;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
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

export function startPriming() {
  return apiFetch<{ state: MachineState }>("/api/priming/start", { method: "POST" });
}

export function stopPriming() {
  return apiFetch<{ state: MachineState }>("/api/priming/stop", { method: "POST" });
}

export function getSettings() {
  return apiFetch<MachineSettings>("/api/settings");
}

export function updateSettings(settings: Partial<MachineSettings>) {
  return apiFetch<MachineSettings>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export function nudgeStepper(steps: number, direction: NudgeDirection) {
  return apiFetch<{ moved: number; direction: NudgeDirection }>("/api/stepper/nudge", {
    method: "POST",
    body: JSON.stringify({ steps, direction }),
  });
}

export function cancelJob() {
  return apiFetch<{ cancelled: boolean }>("/api/jobs/cancel", { method: "POST" });
}

export function createJob(urls: string[]) {
  return apiFetch<{ jobId: string; state: MachineState; job: CurrentJob }>("/api/jobs", {
    method: "POST",
    body: JSON.stringify({
      tags: urls.map((url) => ({ url })),
    }),
  });
}

export function getBackendJobs() {
  return apiFetch<{ jobs: BackendJob[]; backend: BackendStatus }>("/api/backend/jobs");
}

export function startBackendJob(jobId: string) {
  return apiFetch<{ jobId: string; state: MachineState; job: CurrentJob }>("/api/backend/jobs/start", {
    method: "POST",
    body: JSON.stringify({ jobId }),
  });
}