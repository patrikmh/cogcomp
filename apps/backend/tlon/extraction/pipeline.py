"""The extraction pipeline as a LangGraph state machine.

    extract ──> validate ──(ok / gave up)──> END
       ^                │
       └──(retry with feedback)

Milestone 1 only needs extract-and-check, which a plain function would cover. It is a
graph because Milestone 3 adds nodes to this loop — pattern mining, a critic pass,
human-in-the-loop confirmation — and growing a graph is cheaper than converting a
function into one later.

The retry edge carries the specific structural errors back to the model rather than
just asking again, so a second attempt has something to correct.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Annotated, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph

from tlon.extraction.models import Extraction

logger = logging.getLogger(__name__)

PROMPT_VERSION = "extract-v0.1"

#: Read from packages/prompts rather than duplicated here. That is what makes
#: "no hidden prompts" true rather than aspirational: the reviewable artifact and
#: the bytes actually sent cannot drift apart.
_PROMPT_PATH = (
    Path(__file__).resolve().parents[4] / "packages" / "prompts" / "extract-v0.1.system.md"
)

#: One retry. A model that produces structurally invalid output twice on the same
#: entry is not going to be argued into correctness, and the user is waiting.
MAX_ATTEMPTS = 2

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


def load_system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


class ExtractionState(TypedDict, total=False):
    """State threaded through the graph."""

    content: str
    attempts: int
    extraction: Extraction | None
    #: Structural errors from the last validate pass; fed back on retry.
    errors: Annotated[list[str], "structural errors from the last attempt"]
    #: Set when the model declined the request rather than failing to parse.
    refused: bool


def build_model(api_key: str, model: str) -> ChatOpenAI:
    """OpenRouter speaks the OpenAI-compatible API, so the OpenAI client points at it.

    No provider SDK is compiled in: switching models is a config change.
    Sampling parameters are left at provider defaults — several current models reject
    an explicit temperature outright.
    """
    return ChatOpenAI(
        model=model,
        api_key=api_key,
        base_url=OPENROUTER_BASE_URL,
        timeout=120,
        max_retries=2,
        default_headers={
            # OpenRouter attributes traffic with these; they are optional but make
            # usage legible on the dashboard.
            "HTTP-Referer": "https://github.com/tlon",
            "X-Title": "Tlon",
        },
    )


def build_pipeline(model: ChatOpenAI):
    """Compile the extraction graph for a given model client."""
    structured = model.with_structured_output(Extraction)
    system_prompt = load_system_prompt()

    async def extract(state: ExtractionState) -> ExtractionState:
        attempts = state.get("attempts", 0) + 1
        messages: list = [SystemMessage(content=system_prompt)]

        errors = state.get("errors") or []
        if errors:
            # Retry: show the model exactly what was wrong rather than repeating
            # the request verbatim and hoping for a different sample.
            complaint = "\n".join(f"- {error}" for error in errors)
            messages.append(
                HumanMessage(
                    content=(
                        f"{state['content']}\n\n"
                        "Your previous response was structurally invalid:\n"
                        f"{complaint}\n"
                        "Return a corrected extraction."
                    )
                )
            )
        else:
            messages.append(HumanMessage(content=state["content"]))

        try:
            extraction = await structured.ainvoke(messages)
        except Exception as exc:  # noqa: BLE001 — transport and parse failures alike
            logger.warning("extraction attempt %s failed: %s", attempts, exc)
            return {
                "attempts": attempts,
                "extraction": None,
                "errors": [f"model call failed: {exc}"],
            }

        return {"attempts": attempts, "extraction": extraction, "errors": []}

    async def validate(state: ExtractionState) -> ExtractionState:
        extraction = state.get("extraction")
        if extraction is None:
            return {"errors": state.get("errors") or ["no extraction produced"]}
        return {"errors": extraction.structural_errors()}

    def should_retry(state: ExtractionState) -> str:
        if not state.get("errors"):
            return "done"
        if state.get("attempts", 0) >= MAX_ATTEMPTS:
            return "done"
        return "retry"

    builder = StateGraph(ExtractionState)
    builder.add_node("extract", extract)
    builder.add_node("validate", validate)
    builder.set_entry_point("extract")
    builder.add_edge("extract", "validate")
    builder.add_conditional_edges("validate", should_retry, {"retry": "extract", "done": END})
    return builder.compile()


class ExtractionFailed(Exception):
    """Raised when the pipeline could not produce a storable extraction."""

    def __init__(self, errors: list[str]) -> None:
        super().__init__("; ".join(errors) or "extraction failed")
        self.errors = errors


class LangGraphExtractor:
    """Runs the compiled pipeline and reports which prompt and model produced a result."""

    def __init__(self, api_key: str, model: str) -> None:
        self._model_name = model
        self._pipeline = build_pipeline(build_model(api_key, model))

    @property
    def version(self) -> str:
        return f"{PROMPT_VERSION}/{self._model_name}"

    async def extract(self, content: str) -> Extraction:
        final: ExtractionState = await self._pipeline.ainvoke(
            {"content": content, "attempts": 0, "errors": []}
        )
        errors = final.get("errors") or []
        extraction = final.get("extraction")
        if errors or extraction is None:
            raise ExtractionFailed(errors)
        return extraction
