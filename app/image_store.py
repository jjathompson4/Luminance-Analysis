from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Dict

import numpy as np


@dataclass
class ImageSession:
    session_id: str
    filename: str
    original_hdr: np.ndarray
    calibrated_hdr: np.ndarray = field(repr=False)
    scale_factor: float = 1.0
    calibrated: bool = False

    @property
    def shape(self):
        return self.original_hdr.shape

    def reset_calibration(self):
        self.scale_factor = 1.0
        self.calibrated_hdr = self.original_hdr.copy()
        self.calibrated = False

    def apply_scale_factor(self, factor: float):
        self.scale_factor = factor
        self.calibrated_hdr = self.original_hdr * factor
        self.calibrated = True


class ImageStore:
    def __init__(self) -> None:
        self._sessions: Dict[str, ImageSession] = {}
        self._lock = Lock()

    def create_session(self, filename: str, hdr: np.ndarray) -> ImageSession:
        session_id = uuid.uuid4().hex
        session = ImageSession(
            session_id=session_id,
            filename=filename,
            original_hdr=hdr,
            calibrated_hdr=hdr.copy(),
        )
        with self._lock:
            self._sessions[session_id] = session
        return session

    def get(self, session_id: str) -> ImageSession:
        with self._lock:
            if session_id not in self._sessions:
                raise KeyError("Session not found")
            return self._sessions[session_id]

    def drop(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)


store = ImageStore()
