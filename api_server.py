from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, HttpUrl

from nfc_controller import NFCWriterController, TagWriteRequest


class TagPayload(BaseModel):
    url: HttpUrl


class JobCreatePayload(BaseModel):
    tags: list[TagPayload] = Field(min_length=1)


controller = NFCWriterController()

app = FastAPI(title="Ghostwriter NFC API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/status")
def get_status():
    return controller.get_status()


@app.get("/api/jobs/current")
def get_current_job():
    return {"job": controller.get_current_job_data()}


@app.post("/api/jobs")
def create_job(payload: JobCreatePayload):
    try:
        job = controller.submit_job([TagWriteRequest(url=str(tag.url)) for tag in payload.tags])
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"jobId": job.job_id, "state": job.state, "job": controller.get_current_job_data()}