"""Scenario: user-facing entry point for the simulations"""

from typing import Literal
from pydantic import BaseModel

class Policy(BaseModel):
    """policy change"""
    variable: str
    from_value: float
    to_value: float

class Scenario(BaseModel):

    domain: Literal["labor_economics"]
    region: str
    policy: Policy
    horizon_months: int = 24


    def simulate(self, n_agents: int = 500, seed: int = 42):
        """run simulation"""
        raise NotImplementedError("Engine not built yet")