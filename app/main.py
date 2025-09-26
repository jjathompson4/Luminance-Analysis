from __future__ import annotations

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.image_store import store
from app.processing import (
    DEFAULT_COLORMAP,
    DEFAULT_FALSECOLOR_RANGE,
    build_colorbar,
    encode_png,
    false_color_image,
    luminance_histogram,
    luminance_stats,
    load_hdr_image,
    pixel_luminance,
    roi_mean_luminance,
    tone_map,
)

app = FastAPI(title="Luminance Analysis Web", max_request_size=200 * 1024 * 1024)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"]
    ,
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")


class RenderPayload(BaseModel):
    session_id: str = Field(alias="sessionId")
    exposure: float = 6.0
    gamma: float = 2.2
    use_srgb: bool = Field(False, alias="useSrgb")
    false_color: bool = Field(False, alias="falseColor")
    colormap: str = DEFAULT_COLORMAP
    falsecolor_min: float = Field(DEFAULT_FALSECOLOR_RANGE[0], alias="falsecolorMin")
    falsecolor_max: float = Field(DEFAULT_FALSECOLOR_RANGE[1], alias="falsecolorMax")


class CoordinatePayload(BaseModel):
    session_id: str = Field(alias="sessionId")
    x: int
    y: int


class RoiPayload(BaseModel):
    session_id: str = Field(alias="sessionId")
    x0: int
    y0: int
    x1: int
    y1: int


class CalibrationPayload(CoordinatePayload):
    known_value: float = Field(alias="knownValue")


@app.get("/")
async def index():
    return FileResponse("index.html")


@app.post("/api/upload")
async def upload_image(file: UploadFile = File(...)):
    contents = await file.read()
    try:
        hdr = load_hdr_image(contents, file.filename)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    session = store.create_session(file.filename, hdr)
    stats = luminance_stats(session.calibrated_hdr)
    response = {
        "sessionId": session.session_id,
        "filename": file.filename,
        "width": session.shape[1],
        "height": session.shape[0],
        "stats": stats,
        "calibrated": session.calibrated,
    }
    return JSONResponse(response)


@app.get("/api/summary")
async def summary(sessionId: str):
    try:
        session = store.get(sessionId)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc
    stats = luminance_stats(session.calibrated_hdr)
    return {
        "filename": session.filename,
        "width": session.shape[1],
        "height": session.shape[0],
        "stats": stats,
        "calibrated": session.calibrated,
        "scaleFactor": session.scale_factor,
    }


@app.post("/api/render")
async def render_image(payload: RenderPayload):
    try:
        session = store.get(payload.session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc

    hdr = session.calibrated_hdr

    if payload.false_color:
        image = false_color_image(
            hdr,
            colormap=payload.colormap,
            lum_min=payload.falsecolor_min,
            lum_max=payload.falsecolor_max,
        )
        colorbar = build_colorbar(
            payload.colormap,
            payload.falsecolor_min,
            payload.falsecolor_max,
        )
    else:
        image = tone_map(
            hdr,
            ev=payload.exposure,
            gamma=payload.gamma,
            use_srgb=payload.use_srgb,
        )
        colorbar = None

    encoded_image = encode_png(image)

    response = {
        "image": encoded_image,
        "width": hdr.shape[1],
        "height": hdr.shape[0],
    }
    if colorbar:
        response["colorbar"] = colorbar
    return JSONResponse(response)


@app.post("/api/pixel")
async def pixel_query(payload: CoordinatePayload):
    try:
        session = store.get(payload.session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc
    try:
        luminance = pixel_luminance(session.calibrated_hdr, payload.x, payload.y)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"luminance": luminance}


@app.post("/api/roi")
async def roi_query(payload: RoiPayload):
    try:
        session = store.get(payload.session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc
    try:
        mean_lum = roi_mean_luminance(
            session.calibrated_hdr,
            payload.x0,
            payload.y0,
            payload.x1,
            payload.y1,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"mean": mean_lum}


@app.post("/api/calibrate")
async def calibrate(payload: CalibrationPayload):
    try:
        session = store.get(payload.session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc

    actual = pixel_luminance(session.original_hdr, payload.x, payload.y)
    if actual <= 0:
        raise HTTPException(status_code=400, detail="Selected pixel has zero luminance")
    scale_factor = payload.known_value / actual
    session.apply_scale_factor(scale_factor)
    stats = luminance_stats(session.calibrated_hdr)
    return {
        "scaleFactor": scale_factor,
        "stats": stats,
        "calibrated": session.calibrated,
    }


@app.get("/api/histogram")
async def histogram(sessionId: str, mode: str = "calibrated"):
    try:
        session = store.get(sessionId)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc

    if mode not in {"calibrated", "original"}:
        raise HTTPException(status_code=400, detail="Invalid histogram mode")

    hdr = session.calibrated_hdr if mode == "calibrated" else session.original_hdr
    bins, counts = luminance_histogram(hdr)
    return {"bins": bins, "counts": counts}

@app.get("/healthz")
def healthz():
    return {"status": "ok"}
