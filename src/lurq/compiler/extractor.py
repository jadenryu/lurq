from pydantic import BaseModel
from typing import Protocol

class ProposedPin(BaseModel):
    axis_id: str
    value: str | int | float
    source_evidence: str | None = None

class Extractor(Protocol):
    id: str
    ## def extract(BaseModel):

class ManualExtractor:
    id = "manual"
    def __init__(self, pins: dict[str, str | float | int] | None = None, source_evidence: dict[str, str | float | int] | None = None):
        self.pins = pins or {}
        self.source_evidence = source_evidence or {}
    def extract(self) -> list[ProposedPin]:
        return [ProposedPin(
            axis_id = axis_id,
            value = value, 
            source_evidence = self.source_evidence.get(axis_id),
        )
        for axis_id, value in self.pins.items()
        ]

