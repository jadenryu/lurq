"""the compiler takes the proposed pins and validates them on the MethodologySpace. axis ids must match, if not, axes 
are gridded rather than pinned. pinned axes must have source evidence and must contain a value that is in an instantiated axis_option"""

from datetime import datetime
from pydantic import BaseModel

from lurq.claim import Claim
from lurq.compiler.extractor import Extractor, ProposedPin
from lurq.compiler.specs import AxisAssignment, PipelineSpecs
from lurq.methodology import MethodologySpace

## def compile_claim(temp)