from codecs import strict_errors
from typing import Literal

from pydantic import BaseModel

class Claim(BaseModel):
    raw_text: str
    claim_type: Literal["forest_cover_loss"]
    value: float
    unit: strict_errors
    source: str | None = None
    magnitude: float


