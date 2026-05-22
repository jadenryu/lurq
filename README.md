<div align="center">

# lurq

### Open-source claim verification

</div>

---

## What is lurq?

**lurq cross-validates environmental-based claims with pinpoint accuracy using a reverse-engineered methodology process** 


## Quickstart

```python
from lurq.claim import Claim

claim = Claim(
    raw_text: str
    claim_type: Literal["forest_cover_loss"]
    value: float
    unit: float
    source: str | None = None
    magnitude: float
)
result = scenario.simulate(n_agents=500)

print(result.summary())  

```


## Installation

```bash
# From PyPI (once published)
pip install lurq

# From source
git clone https://github.com/jadenryu/lurq.git
cd lurq
pip install -e ".[dev]"
```


Requires Python 3.11+ 


## Contributing

lurq is pre-alpha. 

Open an issue or reach out on Gmail @ jadenryu@gmail.com!

## License

[Apache 2.0](LICENSE) - free to use, modify, and distribute commercially.
