"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  cancelJob,
  createJob,
  getSettings,
  getMachineStatus,
  MachineSettings,
  MachineStatus,
  NudgeDirection,
  nudgeStepper,
  startPriming,
  stopPriming,
  TagResult,
  updateSettings,
} from "@/lib/api";

const EMPTY_TAGS = ["https://", "https://"];

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
  const [status, setStatus] = useState<MachineStatus | null>(null);
  const [settings, setSettings] = useState<MachineSettings | null>(null);
  const [tags, setTags] = useState<string[]>(EMPTY_TAGS);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [stepCountInput, setStepCountInput] = useState("64");
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [nudgingAction, setNudgingAction] = useState<string | null>(null);
  const [nudgeError, setNudgeError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  // Unused priming handlers kept for reference when feature is re-enabled
  const _startPriming = startPriming;
  const _stopPriming = stopPriming;
  void _startPriming;
  void _stopPriming;

  useEffect(() => {
    let active = true;

    const loadStatus = async () => {
      try {
        const [nextStatus, nextSettings] = await Promise.all([getMachineStatus(), getSettings()]);
        if (!active) {
          return;
        }
        setStatus(nextStatus);
        setSettings(nextSettings);
        setStepCountInput(String(nextSettings.stepCountPerTag));
        setApiError(null);
        setSettingsError(null);
      } catch (error) {
        if (!active) {
          return;
        }
        setApiError(error instanceof Error ? error.message : "Failed to load machine status");
      }
    };

    void loadStatus();
    const interval = window.setInterval(() => void loadStatus(), 1500);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const progressPercent = useMemo(() => {
    if (!status || status.totalTags === 0) {
      return 0;
    }
    return Math.round((status.completedTags / status.totalTags) * 100);
  }, [status]);

  const addTagRow = () => {
    setTags((current) => [...current, "https://"]);
  };

  const removeTagRow = (index: number) => {
    setTags((current) => (current.length === 1 ? current : current.filter((_, currentIndex) => currentIndex !== index)));
  };

  const updateTag = (index: number, value: string) => {
    setTags((current) => current.map((tag, currentIndex) => (currentIndex === index ? value : tag)));
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
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Failed to save settings");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setApiError(null);

    const cleaned = tags.map((tag) => tag.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      setFormError("Add at least one tag URL before starting a job.");
      return;
    }

    const invalid = cleaned.find((tag) => {
      try {
        new URL(tag);
        return false;
      } catch {
        return true;
      }
    });

    if (invalid) {
      setFormError(`Invalid URL: ${invalid}`);
      return;
    }

    setIsSubmitting(true);
    try {
      await createJob(cleaned);
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
              {[15, 20, 25, 30].map((steps) => {
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
              {[15, 20, 25, 30].map((steps) => {
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
              onChange={(event) => setStepCountInput(event.target.value)}
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
              <dt>Last message</dt>
              <dd>{status?.lastMessage ?? "Waiting for first status response"}</dd>
            </div>
            <div>
              <dt>Last error</dt>
              <dd>{status?.lastError ?? "—"}</dd>
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
            </div>

            {formError ? <div className="alert error">{formError}</div> : null}

            <div className="buttonRow">
              <button type="button" className="secondaryButton" onClick={addTagRow}>
                Add tag row
              </button>
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

      <section className="panel resultsPanel">
        <div className="panelHeader">
          <h2>Current job details</h2>
          <p>Per-tag write progress from the active or most recent job.</p>
        </div>

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