import pytest
from lurq import Scenario, Policy


def test_scenario_instantiation():
    scenario = Scenario(
        domain="labor_economics",
        region="California",
        policy=Policy(variable="min_wage_fast_food", from_value=16.0, to_value=22.0),
        horizon_months=24,
    )
    assert scenario.region == "California"
    assert scenario.horizon_months == 24


def test_scenario_simulate_not_implemented():
    scenario = Scenario(
        domain="labor_economics",
        region="California",
        policy=Policy(variable="min_wage_fast_food", from_value=16.0, to_value=22.0),
    )
    with pytest.raises(NotImplementedError):
        scenario.simulate()