"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { createJob, getMachineStatus, MachineStatus, TagResult } from "@/lib/api";

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
  const [tags, setTags] = useState<string[]>(EMPTY_TAGS);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadStatus = async () => {
      try {
        const nextStatus = await getMachineStatus();
        if (!active) {
          return;
        }
        setStatus(nextStatus);
        setApiError(null);
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
          <p>Updated {status?.updatedAt ?? "waiting for API"}</p>
        </div>
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
        </article>

        <article className="panel formPanel">
          <div className="panelHeader">
            <h2>New tag job</h2>
            <p>Create a variable-sized batch of URLs to write onto tags.</p>
          </div>

          <form onSubmit={handleSubmit} className="tagForm">
            <div className="tagList">
              {tags.map((tag, index) => (
                <div key={`${index}-${tag}`} className="tagRow">
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
                disabled={isSubmitting || status?.state === "running" || status?.state === "queued"}
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
                  <TagResultRow key={`${result.index}-${result.url}`} result={result} />
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