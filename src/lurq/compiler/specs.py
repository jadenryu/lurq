from datetime import datetime
from typing import Literal

from pydantic import BaseModel, model_validator

from lurq.claim import Claim

class AxisAssignment(BaseModel):
    axis_id: str
    status: Literal["pinned", "gridded"]
    values: list[str | int | float]
    source_evidence: str | None = None

    @model_validator(mode="after")
    def validate_values(self):
        if self.status == "pinned" and len(self.values) != 1:
            raise ValueError("Number of values for pinned axes must equal one")
        if self.status == "gridded" and len(self.values) < 1:
            raise ValueError("Number of values for gridded axes cannot equal one")
        ## if self.status == "gridded" and self.source_evidence is not None:
        ##   raise ValueError("Gridded axes should not have source evidence")
        return self
class PipelineSpecs(BaseModel):
    claim: Claim
    methodology_space_v: str
    assignments: list[AxisAssignment]
    compiled_at: datetime
    compiled_id: str
    
    ## axis_id = str? shouldn't be a list
    def check_assignments(self, axis_id: str) -> AxisAssignment:
        for a in self.assignments:
            if a.axis_id == axis_id:
                return a
        raise KeyError(f"Axis {a.axis_id!r} does not equal the axis id: {axis_id!r}")
    def pinned_axes(self) -> list[AxisAssignment]:
        return [a for a in self.assignments if a.status == "pinned"]
    def gridded_axis(self) -> list[AxisAssignment]:
        return [a for a in self.assignments if a.status == "gridded"]
    def grid_size(self) -> int:
        gridsize = 1
        for a in self.assignments:
            gridsize *= len(a.values)
        return gridsize

