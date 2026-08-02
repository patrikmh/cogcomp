"""Background agents — the parts of the system that draw insights unasked.

The registry is explicit rather than discovered by import scanning. An agent that
makes claims about someone should have to be named somewhere a person can read,
not appear because a file landed in a directory.

Order matters. Consolidation runs before pattern mining because merging duplicate
nodes changes what recurs — mining first would count the same thing twice and
report a pattern that consolidation is about to dissolve.
"""

from tlon.agents.base import Agent, AgentResult
from tlon.agents.consolidation import ConsolidationAgent
from tlon.agents.patterns_agent import PatternAgent

REGISTRY: list[Agent] = [
    ConsolidationAgent(),
    PatternAgent(),
]

BY_NAME = {agent.name: agent for agent in REGISTRY}

__all__ = ["BY_NAME", "REGISTRY", "Agent", "AgentResult"]
