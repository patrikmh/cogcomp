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
from collections.abc import AsyncIterator
from dataclasses import dataclass
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


@dataclass(frozen=True)
class Delta:
    """A piece of the reply, safe to show. The marker is already gone."""

    text: str


@dataclass(frozen=True)
class Done:
    """The end of a reply, with the whole of it for storing."""

    content: str
    crisis: bool


StreamEvent = Delta | Done


class MarkerGate:
    """Withholds the front of a reply until the crisis marker is ruled out.

    Streaming a reply means showing it before it is finished, and the marker
    arrives at the front of it. Emitting text the moment it arrives would put a
    literal `[CRISIS]` on screen, one character at a time, in front of the one
    person who must not be shown it — and then take it back.

    So the opening is held. Not all of it: only until what has arrived can no
    longer become the marker, which is at most eight characters and in practice
    the first token. `[CRI` is still undecided and waits; `What` cannot become
    `[CRISIS]` and goes out immediately.
    """

    def __init__(self) -> None:
        self._held = ""
        self._decided = False
        self._started = False
        self.crisis = False

    def _emit(self, text: str) -> str:
        """Text on its way out, without the newline the marker was sitting on.

        The model writes the marker on its own line, and the tokeniser is free
        to end a chunk between the two — leaving the whitespace to arrive after
        the gate has already decided. Nothing has been shown until the first
        visible character, so leading whitespace is stripped up to that point
        rather than at the boundary of any one chunk.
        """
        if self._started:
            return text
        opening = text.lstrip()
        if opening:
            self._started = True
        return opening

    def push(self, chunk: str) -> str:
        """What is safe to show now, which may be nothing."""
        if self._decided:
            return self._emit(chunk)

        self._held += chunk
        stripped = self._held.lstrip()
        if not stripped:
            # Nothing but whitespace so far, and the marker tolerates leading
            # whitespace in front of it. Still undecided.
            return ""

        if stripped.startswith(CRISIS_MARKER):
            self._decided = True
            self.crisis = True
            self._held = ""
            return self._emit(stripped[len(CRISIS_MARKER) :])

        if len(stripped) < len(CRISIS_MARKER) and CRISIS_MARKER.startswith(stripped):
            # Could still turn into the marker with the next token.
            return ""

        self._decided = True
        self._held = ""
        return self._emit(stripped)

    def flush(self) -> str:
        """Whatever is still held when the stream ends.

        A reply shorter than the marker — the model saying "Ok." and stopping —
        would otherwise be held forever.
        """
        if self._decided:
            return ""
        self._decided = True
        held = self._held.strip()
        self._held = ""
        return held


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

    async def stream(self, turns: list[dict]) -> AsyncIterator[StreamEvent]:
        """Arrives whole, because there is nothing here to write gradually.

        The shape still matches the real agent's, so a deployment without a key
        exercises the same client path rather than a quieter one that would hide
        whatever breaks on the path that matters.
        """
        answer = await self.reply(turns)
        yield Delta(answer.content)
        yield Done(answer.content, answer.crisis)


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

    def _messages(self, turns: list[dict]) -> list:
        messages: list = [SystemMessage(content=self._system)]
        for turn in turns[-CONTEXT_TURNS:]:
            if turn["speaker"] == "user":
                messages.append(HumanMessage(content=turn["content"]))
            else:
                messages.append(AIMessage(content=turn["content"]))
        return messages

    async def stream(self, turns: list[dict]) -> AsyncIterator[StreamEvent]:
        """The same reply, as it is written rather than once it is finished.

        Worth the second code path for what it does to the silence. A reply is
        spoken a sentence at a time, and a sentence is finished long before the
        reply is — so the first sentence can be sent for synthesis while the
        model is still writing the second. The wait for the model and the wait
        for the voice stop being consecutive.
        """
        messages = self._messages(turns)
        gate = MarkerGate()
        parts: list[str] = []

        try:
            async for chunk in self._client.astream(messages):
                text = chunk.content if isinstance(chunk.content, str) else str(chunk.content)
                if not text:
                    continue
                visible = gate.push(text)
                if visible:
                    parts.append(visible)
                    yield Delta(visible)
        except Exception as exc:
            logger.warning("conversation stream failed: %s", exc)
            raise ConversationError(str(exc)) from exc

        tail = gate.flush()
        if tail:
            parts.append(tail)
            yield Delta(tail)

        content = "".join(parts).strip()
        if not content:
            raise ConversationError("the agent returned an empty reply")
        yield Done(content, gate.crisis)

    async def reply(self, turns: list[dict]) -> Reply:
        messages = self._messages(turns)

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
