"""Background agents — the parts of the system that draw insights unasked.

The registry is explicit rather than discovered by import scanning. An agent that
makes claims about someone should have to be named somewhere a person can read,
not appear because a file landed in a directory.

Order matters. Consolidation runs before pattern mining because merging duplicate
nodes changes what recurs — mining first would count the same thing twice and
report a pattern that consolidation is about to dissolve. Association mining runs
last for the same reason twice over: it groups on the same normalised labels, so
it wants the merges done, and it draws edges between nodes that consolidation
would otherwise be repointing underneath it.
"""

from tlon.agents.base import Agent, AgentResult
from tlon.agents.consolidation import ConsolidationAgent
from tlon.agents.cooccurrence_agent import CoOccurrenceAgent
from tlon.agents.patterns_agent import PatternAgent
from tlon.agents.themes_agent import ThemesAgent

REGISTRY: list[Agent] = [
    ConsolidationAgent(),
    PatternAgent(),
    CoOccurrenceAgent(),
    # Last: themes are communities in the association graph, so clustering before
    # those edges are current would describe a life as it was yesterday.
    ThemesAgent(),
]

BY_NAME = {agent.name: agent for agent in REGISTRY}

__all__ = ["BY_NAME", "REGISTRY", "Agent", "AgentResult"]
