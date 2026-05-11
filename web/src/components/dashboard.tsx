"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  BackendJob,
  cancelJob,
  createJob,
  getBackendJobs,
  getSettings,
  getMachineStatus,
  MachineSettings,
  MachineStatus,
  NudgeDirection,
  nudgeStepper,
  startBackendJob,
  startPriming,
  stopPriming,
  TagResult,
  updateSettings,
} from "@/lib/api";
import {
  generatePatternTags,
  mergeTags,
  normalizeTagUrls,
  parseImportedTags,
  TagMergeMode,
  validateTagUrls,
} from "@/lib/tag-utils";

const EMPTY_TAGS = ["https://", "https://"];
const TAG_EDIT_MODES = [
  { key: "manual", label: "Manual" },
  { key: "import", label: "Import JSON / CSV" },
  { key: "wizard", label: "Tag creator wizard" },
] as const;

type TagEditMode = (typeof TAG_EDIT_MODES)[number]["key"];

function prettyState(state: string) {
  return state.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusTone(state: string) {
  switch (state) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "error":
      return "error";
    case "queued":
      return "queued";
    case "cancelled":
      return "cancelled";
    default:
      return "idle";
  }
}

function TagResultRow({ result }: { result: TagResult }) {
  return (
    <tr>
      <td>{result.index}</td>
      <td className="urlCell">{result.url}</td>
      <td>
        <span className={`pill ${statusTone(result.status)}`}>{prettyState(result.status)}</span>
      </td>
      <td>{result.uid ?? "—"}</td>
      <td>{result.message ?? "—"}</td>
    </tr>
  );
}

export function Dashboard() {
  const nudgeSteps = [20, 30, 40, 50, 60];
  const [status, setStatus] = useState<MachineStatus | null>(null);
  const [settings, setSettings] = useState<MachineSettings | null>(null);
  const [tags, setTags] = useState<string[]>(EMPTY_TAGS);
  const [tagEditMode, setTagEditMode] = useState<TagEditMode>("manual");
  const [tagMergeMode, setTagMergeMode] = useState<TagMergeMode>("replace");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [stepCountInput, setStepCountInput] = useState("64");
  const [isEditingStepCount, setIsEditingStepCount] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [nudgingAction, setNudgingAction] = useState<string | null>(null);
  const [nudgeError, setNudgeError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [backendJobs, setBackendJobs] = useState<BackendJob[]>([]);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [selectedBackendJobId, setSelectedBackendJobId] = useState<string | null>(null);
  const [isStartingBackendJob, setIsStartingBackendJob] = useState(false);
  const [wizardPattern, setWizardPattern] = useState("https://example.com/tag-{n}");
  const [wizardStart, setWizardStart] = useState("1");
  const [wizardCount, setWizardCount] = useState("10");
  const [wizardStep, setWizardStep] = useState("1");
  const [wizardPadWidth, setWizardPadWidth] = useState("0");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Unused priming handlers kept for reference when feature is re-enabled
  const _startPriming = startPriming;
  const _stopPriming = stopPriming;
  void _startPriming;
  void _stopPriming;

  useEffect(() => {
    let active = true;

    const loadStatus = async () => {
      try {
        const [nextStatus, nextSettings, nextBackendJobs] = await Promise.all([
          getMachineStatus(),
          getSettings(),
          getBackendJobs(),
        ]);
        if (!active) {
          return;
        }
        setStatus(nextStatus);
        setSettings(nextSettings);
        setBackendJobs(nextBackendJobs.jobs);
        setSelectedBackendJobId((current) => {
          if (current && nextBackendJobs.jobs.some((job) => job.id === current)) {
            return current;
          }
          return nextBackendJobs.jobs[0]?.id ?? null;
        });
        if (!isEditingStepCount) {
          setStepCountInput(String(nextSettings.stepCountPerTag));
        }
        setApiError(null);
        setSettingsError(null);
        setBackendError(null);
      } catch (error) {
        if (!active) {
          return;
        }
        setApiError(error instanceof Error ? error.message : "Failed to load machine status");
        setBackendError(error instanceof Error ? error.message : "Failed to load backend jobs");
      }
    };

    void loadStatus();
    const interval = window.setInterval(() => void loadStatus(), 1500);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [isEditingStepCount]);

  const progressPercent = useMemo(() => {
    if (!status || status.totalTags === 0) {
      return 0;
    }
    return Math.round((status.completedTags / status.totalTags) * 100);
  }, [status]);

  const normalizedTags = useMemo(() => normalizeTagUrls(tags), [tags]);

  const wizardPreview = useMemo(() => {
    const start = Number(wizardStart);
    const count = Number(wizardCount);
    const step = Number(wizardStep);
    const padWidth = Number(wizardPadWidth);

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(count) ||
      count < 1 ||
      !Number.isInteger(step) ||
      step < 1 ||
      !Number.isInteger(padWidth) ||
      padWidth < 0 ||
      !wizardPattern.includes("{n}")
    ) {
      return [];
    }

    try {
      return generatePatternTags({
        pattern: wizardPattern,
        start,
        count: Math.min(count, 5),
        step,
        padWidth,
      });
    } catch {
      return [];
    }
  }, [wizardCount, wizardPadWidth, wizardPattern, wizardStart, wizardStep]);

  const addTagRow = () => {
    setFormError(null);
    setFormNotice(null);
    setTags((current) => [...current, "https://"]);
  };

  const removeTagRow = (index: number) => {
    setFormError(null);
    setFormNotice(null);
    setTags((current) => (current.length === 1 ? current : current.filter((_, currentIndex) => currentIndex !== index)));
  };

  const updateTag = (index: number, value: string) => {
    setFormError(null);
    setFormNotice(null);
    setTags((current) => current.map((tag, currentIndex) => (currentIndex === index ? value : tag)));
  };

  const applyIncomingTags = (incoming: string[], mode: TagMergeMode) => {
    setTags((current) => {
      const nextExisting = mode === "append" ? normalizeTagUrls(current) : current;
      const merged = mergeTags(nextExisting, incoming, mode);
      return merged.length > 0 ? merged : EMPTY_TAGS;
    });
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setFormError(null);
    setFormNotice(null);

    try {
      const content = await file.text();
      const { urls, invalidEntries, format } = parseImportedTags(content, file.name);

      if (urls.length === 0) {
        setFormError(`No valid URLs were found in the ${format.toUpperCase()} file.`);
        return;
      }

      applyIncomingTags(urls, tagMergeMode);

      const skippedCount = invalidEntries.length;
      setFormNotice(
        skippedCount > 0
          ? `Imported ${urls.length} tags from ${file.name} and skipped ${skippedCount} invalid entr${skippedCount === 1 ? "y" : "ies"}.`
          : `Imported ${urls.length} tags from ${file.name}.`,
      );
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to import file");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleGenerateTags = () => {
    setFormError(null);
    setFormNotice(null);

    try {
      const urls = generatePatternTags({
        pattern: wizardPattern,
        start: Number(wizardStart),
        count: Number(wizardCount),
        step: Number(wizardStep),
        padWidth: Number(wizardPadWidth),
      });

      applyIncomingTags(urls, tagMergeMode);
      setFormNotice(`Generated ${urls.length} test tag URL${urls.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to generate tags");
    }
  };

  const handleNudge = async (steps: number, direction: NudgeDirection) => {
    const actionKey = `${direction}-${steps}`;
    setNudgingAction(actionKey);
    setNudgeError(null);
    try {
      await nudgeStepper(steps, direction);
    } catch (error) {
      setNudgeError(error instanceof Error ? error.message : "Nudge failed");
    } finally {
      setNudgingAction(null);
    }
  };

  const handleCancel = async () => {
    setIsCancelling(true);
    setApiError(null);
    try {
      await cancelJob();
      const nextStatus = await getMachineStatus();
      setStatus(nextStatus);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Failed to cancel job");
    } finally {
      setIsCancelling(false);
    }
  };

  const handleSaveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSettingsError(null);

    const parsed = Number(stepCountInput);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setSettingsError("Step count per tag must be a whole number greater than 0.");
      return;
    }

    setIsSavingSettings(true);
    try {
      const nextSettings = await updateSettings({ stepCountPerTag: parsed });
      setSettings(nextSettings);
      setStepCountInput(String(nextSettings.stepCountPerTag));
      setIsEditingStepCount(false);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Failed to save settings");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleStartBackendJob = async () => {
    if (!selectedBackendJobId) {
      setBackendError("Choose a backend job before starting it.");
      return;
    }

    setIsStartingBackendJob(true);
    setApiError(null);
    setBackendError(null);
    try {
      await startBackendJob(selectedBackendJobId);
      const [nextStatus, nextBackendJobs] = await Promise.all([getMachineStatus(), getBackendJobs()]);
      setStatus(nextStatus);
      setBackendJobs(nextBackendJobs.jobs);
      setSelectedBackendJobId((current) => {
        if (current && nextBackendJobs.jobs.some((job) => job.id === current)) {
          return current;
        }
        return nextBackendJobs.jobs[0]?.id ?? null;
      });
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : "Failed to start backend job");
    } finally {
      setIsStartingBackendJob(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setFormNotice(null);
    setApiError(null);

    const { validUrls, invalidUrls } = validateTagUrls(tags);
    if (validUrls.length === 0) {
      setFormError("Add at least one tag URL before starting a job.");
      return;
    }

    if (invalidUrls.length > 0) {
      setFormError(`Invalid URL: ${invalidUrls[0]}`);
      return;
    }

    setIsSubmitting(true);
    try {
      await createJob(validUrls);
      const nextStatus = await getMachineStatus();
      setStatus(nextStatus);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Failed to create job");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isJobActive = status?.state === "running" || status?.state === "queued";

  return (
    <main className="pageShell">
      <section className="heroCard">
        <div>
          <p className="eyebrow">Ghostwriter Operator Console</p>
          <h1>NFC tag writing dashboard</h1>
          <p className="lede">
            Monitor the machine, build a batch of 1 to x tag URLs, and send the job to the
            Python NFC controller.
          </p>
        </div>
        <div className="heroMeta">
          <span className={`pill ${statusTone(status?.state ?? "idle")}`}>
            {prettyState(status?.state ?? "idle")}
          </span>
          <p>Updated {status ? status.updatedAt : "waiting for API"}</p>
        </div>
      </section>

      {/* Stepper nudge panel — always visible */}
      <section className="panel nudgePanel">
        <div className="panelHeader">
          <h2>Manual stepper nudge</h2>
          <p>Advance the spool by a fixed number of steps at any time.</p>
        </div>

        {nudgeError ? <div className="alert error">{nudgeError}</div> : null}

        <div className="nudgeControlGrid">
          <div className="nudgeGroup">
            <h3>Forward</h3>
            <div className="nudgeButtonRow">
              {nudgeSteps.map((steps) => {
                const actionKey = `forward-${steps}`;
                return (
                  <button
                    key={actionKey}
                    type="button"
                    className="nudgeButton"
                    onClick={() => handleNudge(steps, "forward")}
                    disabled={nudgingAction !== null}
                  >
                    {nudgingAction === actionKey ? "Moving…" : `+${steps} steps`}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="nudgeGroup">
            <h3>Backward</h3>
            <div className="nudgeButtonRow">
              {nudgeSteps.map((steps) => {
                const actionKey = `backward-${steps}`;
                return (
                  <button
                    key={actionKey}
                    type="button"
                    className="nudgeButton nudgeButtonReverse"
                    onClick={() => handleNudge(steps, "backward")}
                    disabled={nudgingAction !== null}
                  >
                    {nudgingAction === actionKey ? "Moving…" : `-${steps} steps`}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>Stepper settings</h2>
          <p>Adjust the default number of forward steps used between written tags.</p>
        </div>

        {settingsError ? <div className="alert error">{settingsError}</div> : null}

        <form onSubmit={handleSaveSettings} className="settingsForm">
          <label className="settingsField">
            <span>Default steps per tag</span>
            <input
              type="number"
              min={1}
              step={1}
              value={stepCountInput}
              onChange={(event) => {
                setIsEditingStepCount(true);
                setStepCountInput(event.target.value);
              }}
              onBlur={() => {
                if (settings && stepCountInput === String(settings.stepCountPerTag)) {
                  setIsEditingStepCount(false);
                }
              }}
              placeholder="64"
            />
          </label>

          <div className="settingsMeta">
            <span>Current value: {settings?.stepCountPerTag ?? "—"}</span>
            <button type="submit" className="secondaryButton" disabled={isSavingSettings}>
              {isSavingSettings ? "Saving…" : "Save setting"}
            </button>
          </div>
        </form>
      </section>

      <section className="gridLayout">
        <article className="panel statusPanel">
          <div className="panelHeader">
            <h2>Machine status</h2>
            <p>Live runtime state from the local Python API.</p>
          </div>

          {apiError ? <div className="alert error">{apiError}</div> : null}

          <div className="statsGrid">
            <div className="statCard">
              <span>State</span>
              <strong>{prettyState(status?.state ?? "idle")}</strong>
            </div>
            <div className="statCard">
              <span>Completed tags</span>
              <strong>
                {status?.completedTags ?? 0} / {status?.totalTags ?? 0}
              </strong>
            </div>
            <div className="statCard">
              <span>Current tag</span>
              <strong>{status?.currentTagNumber ?? "—"}</strong>
            </div>
            <div className="statCard">
              <span>Last UID</span>
              <strong>{status?.lastUid ?? "—"}</strong>
            </div>
          </div>

          <div className="progressBlock">
            <div className="progressHeader">
              <span>Job progress</span>
              <strong>{progressPercent}%</strong>
            </div>
            <div className="progressTrack">
              <div className="progressFill" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>

          <dl className="statusDetails">
            <div>
              <dt>Job ID</dt>
              <dd>{status?.jobId ?? "—"}</dd>
            </div>
            <div>
              <dt>Job source</dt>
              <dd>{status?.jobSource ? prettyState(status.jobSource) : "—"}</dd>
            </div>
            <div>
              <dt>Last message</dt>
              <dd>{status?.lastMessage ?? "Waiting for first status response"}</dd>
            </div>
            <div>
              <dt>Last error</dt>
              <dd>{status?.lastError ?? "—"}</dd>
            </div>
            <div>
              <dt>Backend writer</dt>
              <dd>{status?.backend?.writerKey ?? "—"}</dd>
            </div>
            <div>
              <dt>Realtime status</dt>
              <dd>{status?.backend?.realtimeStatus ? prettyState(status.backend.realtimeStatus) : "—"}</dd>
            </div>
          </dl>

          {isJobActive && (
            <div className="buttonRow" style={{ marginTop: "16px" }}>
              <button
                type="button"
                className="cancelButton"
                onClick={handleCancel}
                disabled={isCancelling}
              >
                {isCancelling ? "Cancelling…" : "Cancel job"}
              </button>
            </div>
          )}
        </article>

        <article className="panel formPanel">
          <div className="panelHeader">
            <h2>New tag job</h2>
            <p>Create a variable-sized batch of URLs to write onto tags.</p>
          </div>

          <form onSubmit={handleSubmit} className="tagForm">
            <div className="tagBuilderPanel">
              <div className="segmentedControl" role="tablist" aria-label="Tag creation modes">
                {TAG_EDIT_MODES.map((mode) => (
                  <button
                    key={mode.key}
                    type="button"
                    className={`segmentButton ${tagEditMode === mode.key ? "active" : ""}`}
                    onClick={() => {
                      setTagEditMode(mode.key);
                      setFormError(null);
                      setFormNotice(null);
                    }}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              <div className="mergeModeRow">
                <span>When adding tags:</span>
                <label>
                  <input
                    type="radio"
                    name="tag-merge-mode"
                    checked={tagMergeMode === "replace"}
                    onChange={() => setTagMergeMode("replace")}
                  />
                  Replace current list
                </label>
                <label>
                  <input
                    type="radio"
                    name="tag-merge-mode"
                    checked={tagMergeMode === "append"}
                    onChange={() => setTagMergeMode("append")}
                  />
                  Append to current list
                </label>
              </div>

              {tagEditMode === "manual" ? (
                <div className="tagList">
                  {tags.map((tag, index) => (
                    <div key={index} className="tagRow">
                      <label>
                        <span>Tag {index + 1}</span>
                        <input
                          type="url"
                          value={tag}
                          onChange={(event) => updateTag(index, event.target.value)}
                          placeholder="https://example.com/my-tag"
                        />
                      </label>

                      <button
                        type="button"
                        className="secondaryButton"
                        onClick={() => removeTagRow(index)}
                        disabled={tags.length === 1}
                      >
                        Remove
                      </button>
                    </div>
                  ))}

                  <div className="buttonRow">
                    <button type="button" className="secondaryButton" onClick={addTagRow}>
                      Add tag row
                    </button>
                  </div>
                </div>
              ) : null}

              {tagEditMode === "import" ? (
                <div className="builderCard">
                  <div className="builderCardHeader">
                    <h3>Import tag URLs</h3>
                    <p>Upload a JSON or CSV file and merge the results into the current job list.</p>
                  </div>

                  <label className="fileInputField">
                    <span>JSON / CSV file</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,.csv,application/json,text/csv"
                      onChange={handleImportFile}
                    />
                  </label>

                  <div className="helperTextBlock">
                    <p>Supported JSON:</p>
                    <code>{'["https://example.com/1"]'}</code>
                    <code>[{`{ "url": "https://example.com/1" }`}]</code>
                    <code>{`{ "tags": [{ "url": "https://example.com/1" }] }`}</code>
                    <p>Supported CSV:</p>
                    <code>url</code>
                    <code>https://example.com/1</code>
                  </div>
                </div>
              ) : null}

              {tagEditMode === "wizard" ? (
                <div className="builderCard">
                  <div className="builderCardHeader">
                    <h3>Testing tag creator wizard</h3>
                    <p>Generate a run of URLs from a tag count and incrementing integer pattern.</p>
                  </div>

                  <div className="wizardGrid">
                    <label>
                      <span>URL pattern</span>
                      <input
                        type="text"
                        value={wizardPattern}
                        onChange={(event) => setWizardPattern(event.target.value)}
                        placeholder="https://example.com/tag-{n}"
                      />
                    </label>
                    <label>
                      <span>Start number</span>
                      <input type="number" value={wizardStart} onChange={(event) => setWizardStart(event.target.value)} />
                    </label>
                    <label>
                      <span>Tag count</span>
                      <input type="number" min={1} value={wizardCount} onChange={(event) => setWizardCount(event.target.value)} />
                    </label>
                    <label>
                      <span>Increment</span>
                      <input type="number" min={1} value={wizardStep} onChange={(event) => setWizardStep(event.target.value)} />
                    </label>
                    <label>
                      <span>Zero-padding width</span>
                      <input type="number" min={0} value={wizardPadWidth} onChange={(event) => setWizardPadWidth(event.target.value)} />
                    </label>
                  </div>

                  <div className="previewPanel">
                    <div className="previewHeader">
                      <strong>Preview</strong>
                      <span>Showing up to 5 URLs</span>
                    </div>
                    {wizardPreview.length > 0 ? (
                      <ul>
                        {wizardPreview.map((url) => (
                          <li key={url}>{url}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="emptyPreview">Enter a valid pattern with a <code>{"{n}"}</code> placeholder to preview generated tags.</p>
                    )}
                  </div>

                  <div className="buttonRow">
                    <button type="button" className="secondaryButton" onClick={handleGenerateTags}>
                      Generate tags
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {formError ? <div className="alert error">{formError}</div> : null}
            {formNotice ? <div className="alert success">{formNotice}</div> : null}

            <div className="tagSummaryRow">
              <span>Prepared tags</span>
              <strong>{normalizedTags.length}</strong>
            </div>

            <div className="buttonRow">
              <button
                type="submit"
                className="primaryButton"
                disabled={isSubmitting || isJobActive}
              >
                {isSubmitting ? "Submitting..." : "Start tag write job"}
              </button>
            </div>
          </form>
        </article>
      </section>

      <section className="panel backendJobsPanel">
        <div className="panelHeader">
          <h2>Backend writer jobs</h2>
          <p>Choose a Supabase job for this writer and start it manually from the Pi.</p>
        </div>

        {backendError ? <div className="alert error">{backendError}</div> : null}

        <div className="backendMetaRow">
          <span>
            Backend integration: {status?.backend?.enabled ? "enabled" : "disabled"}
          </span>
          <span>Writer key: {status?.backend?.writerKey ?? "default"}</span>
          <span>Available jobs: {backendJobs.length}</span>
        </div>

        {backendJobs.length > 0 ? (
          <div className="backendJobList" role="list">
            {backendJobs.map((job) => {
              const isSelected = selectedBackendJobId === job.id;
              return (
                <button
                  key={job.id}
                  type="button"
                  className={`backendJobCard ${isSelected ? "selected" : ""}`}
                  onClick={() => setSelectedBackendJobId(job.id)}
                >
                  <div className="backendJobCardHeader">
                    <strong>{job.lotName ?? "Unnamed lot"}</strong>
                    <span className={`pill ${statusTone(job.status)}`}>{prettyState(job.status)}</span>
                  </div>
                  <div className="backendJobCardMeta">
                    <span>ID: {job.id}</span>
                    <span>Type: {job.jobType ?? "write_lot"}</span>
                    <span>Tags: {job.tagCount}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="emptyState">No unfinished Supabase jobs are currently available for this writer.</div>
        )}

        <div className="buttonRow">
          <button
            type="button"
            className="secondaryButton"
            onClick={async () => {
              try {
                const nextBackendJobs = await getBackendJobs();
                setBackendJobs(nextBackendJobs.jobs);
                setSelectedBackendJobId((current) => current ?? nextBackendJobs.jobs[0]?.id ?? null);
                setBackendError(null);
              } catch (error) {
                setBackendError(error instanceof Error ? error.message : "Failed to refresh backend jobs");
              }
            }}
          >
            Refresh backend jobs
          </button>
          <button
            type="button"
            className="primaryButton"
            onClick={handleStartBackendJob}
            disabled={!selectedBackendJobId || isStartingBackendJob || isJobActive}
          >
            {isStartingBackendJob ? "Starting…" : "Start selected backend job"}
          </button>
        </div>
      </section>

      <section className="panel resultsPanel">
        <div className="panelHeader">
          <h2>Current job details</h2>
          <p>Per-tag write progress from the active or most recent job.</p>
        </div>

        {status?.job?.source === "supabase" ? (
          <div className="jobSourceBanner">
            <span>Supabase job</span>
            <strong>{status.job.lotName ?? status.job.remoteJobId ?? status.job.jobId}</strong>
          </div>
        ) : null}

        {status?.job?.results?.length ? (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>URL</th>
                  <th>Status</th>
                  <th>UID</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {status.job.results.map((result) => (
                  <TagResultRow key={result.index} result={result} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="emptyState">No job has been submitted yet.</div>
        )}
      </section>
    </main>
  );
}