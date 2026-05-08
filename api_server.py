import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, HttpUrl

from nfc_controller import NFCWriterController, TagWriteRequest

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


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
    logger.info("GET /api/status - Fetching machine status")
    status = controller.get_status()
    logger.info(f"Status: state={status['state']}, jobId={status.get('jobId')}")
    return status


@app.get("/api/jobs/current")
def get_current_job():
    logger.info("GET /api/jobs/current - Fetching current job")
    job_data = controller.get_current_job_data()
    logger.info(f"Current job: {job_data['jobId'] if job_data else 'None'}")
    return {"job": job_data}


@app.post("/api/priming/start")
def start_priming():
    logger.info("POST /api/priming/start - Entering priming mode")
    try:
        controller.start_priming()
    except RuntimeError as exc:
        logger.error(f"RuntimeError starting priming: {exc}")
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"state": "priming"}


@app.post("/api/priming/stop")
def stop_priming():
    logger.info("POST /api/priming/stop - Exiting priming mode")
    try:
        controller.stop_priming()
    except RuntimeError as exc:
        logger.error(f"RuntimeError stopping priming: {exc}")
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"state": "idle"}


@app.post("/api/jobs")
def create_job(payload: JobCreatePayload):
    logger.info(f"POST /api/jobs - Creating job with {len(payload.tags)} tags")
    try:
        job = controller.submit_job([TagWriteRequest(url=str(tag.url)) for tag in payload.tags])
        logger.info(f"Job created successfully: jobId={job.job_id}, state={job.state}")
    except RuntimeError as exc:
        logger.error(f"RuntimeError creating job: {exc}")
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        logger.error(f"ValueError creating job: {exc}")
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"jobId": job.job_id, "state": job.state, "job": controller.get_current_job_data()}
