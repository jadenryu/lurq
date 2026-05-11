<div align="center">

# lurq

### Open-source simulation engine for high-stakes decisions.

</div>

---

## What is lurq?

**lurq simulates what happens when you change a policy, tariff, regulation, or business decision.** 


## Quickstart

```python
import lurq

scenario = lurq.Scenario(
    domain="labor_economics",
    region="California",
    policy=lurq.Policy(
        variable="min_wage_fast_food",
        from_value=16.0,
        to_value=22.0,
    ),
    horizon_months=24,
)

result = scenario.simulate(n_agents=500)

print(result.summary())                    # high-level outcomes
result.distribution("employment_rate")     # outcome distribution
result.explain_agent(247)                  # why a specific agent decided what they did
result.causal_path("employment_rate")      # which graph edges drove the result
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


Requires Python 3.11+ and an Anthropic API key. Claude Haiku is recommended for cost (~$2-5 per simulation at 500 agents). 


## Contributing

lurq is pre-alpha. 

Open an issue or reach out on X.


## License

[Apache 2.0](LICENSE) - free to use, modify, and distribute commercially.
