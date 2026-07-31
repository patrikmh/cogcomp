"""The conversational journalling agent.

Talking is easier than facing a blank page, so this exists to help someone get a
thought out — not to interpret it. Interpretation happens downstream in the
extraction pipeline, where it is schema-constrained, confidence-scored, and
visible on the explain screen. An agent that interprets in conversation would put
its reading into the person's mouth, and that reading would then be recorded as
though it were theirs.

Only the user's turns become observations. The agent's turns are kept so the
exchange reads back sensibly, and are then never referenced again.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import ClassVar

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

logger = logging.getLogger(__name__)

PROMPT_VERSION = "converse-v0.1"

_PROMPT_PATH = (
    Path(__file__).resolve().parents[3] / "packages" / "prompts" / "converse-v0.1.system.md"
)

#: The agent emits this when someone discloses risk of serious harm. It is a
#: marker rather than a keyword filter on the user's text: a filter on input
#: cannot tell "I want to kill myself" from "that meeting killed me", and gets
#: both directions wrong. The model has the whole conversation in view.
CRISIS_MARKER = "[CRISIS]"

#: How much of the exchange the agent sees. Long enough to follow a thread,
#: short enough that an hour-long conversation does not silently become an
#: expensive request. Older turns are still stored; they are just not re-sent.
CONTEXT_TURNS = 24

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


def load_system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


class ConversationError(Exception):
    pass


class Reply:
    """One turn from the agent."""

    def __init__(self, content: str, crisis: bool) -> None:
        self.content = content
        self.crisis = crisis


def _strip_marker(text: str) -> tuple[str, bool]:
    """Pull the crisis marker off the front of a reply.

    The marker is for the application, not the person — showing them a literal
    `[CRISIS]` tag would be both alarming and meaningless.
    """
    stripped = text.lstrip()
    if stripped.startswith(CRISIS_MARKER):
        return stripped[len(CRISIS_MARKER) :].lstrip(), True
    return text.strip(), False


class StubAgent:
    """A deterministic stand-in so conversations work without a key.

    It asks the same two questions in rotation. That is obviously not a
    conversation, which is the point — it should never be mistaken for one.
    """

    OPENERS: ClassVar[list[str]] = ["What happened?", "What else?"]

    @property
    def version(self) -> str:
        return f"{PROMPT_VERSION}/stub"

    async def reply(self, turns: list[dict]) -> Reply:
        user_turns = [t for t in turns if t["speaker"] == "user"]
        return Reply(self.OPENERS[len(user_turns) % len(self.OPENERS)], crisis=False)


class ConversationAgent:
    """Holds up the other side of a journalling conversation."""

    def __init__(self, api_key: str, model: str) -> None:
        self._model_name = model
        self._client = ChatOpenAI(
            model=model,
            api_key=api_key,
            base_url=OPENROUTER_BASE_URL,
            timeout=60,
            max_retries=2,
            # Replies are one or two sentences by design. A cap keeps a
            # misbehaving turn from becoming a monologue the person has to sit
            # through while it is spoken aloud.
            max_completion_tokens=300,
            default_headers={
                "HTTP-Referer": "https://github.com/tlon",
                "X-Title": "Tlon",
            },
        )
        self._system = load_system_prompt()

    @property
    def version(self) -> str:
        return f"{PROMPT_VERSION}/{self._model_name}"

    async def reply(self, turns: list[dict]) -> Reply:
        messages: list = [SystemMessage(content=self._system)]
        for turn in turns[-CONTEXT_TURNS:]:
            if turn["speaker"] == "user":
                messages.append(HumanMessage(content=turn["content"]))
            else:
                messages.append(AIMessage(content=turn["content"]))

        try:
            response = await self._client.ainvoke(messages)
        except Exception as exc:
            logger.warning("conversation turn failed: %s", exc)
            raise ConversationError(str(exc)) from exc

        text = response.content if isinstance(response.content, str) else str(response.content)
        content, crisis = _strip_marker(text)
        if not content:
            raise ConversationError("the agent returned an empty reply")
        return Reply(content, crisis)


def build_agent(api_key: str, model: str):
    if api_key.strip():
        return ConversationAgent(api_key, model)
    logger.warning("OPENROUTER_API_KEY is unset — conversations will use the stub agent")
    return StubAgent()
