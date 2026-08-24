"""Theme summaries: one sentence a model writes about what a region shares.

ADR-0007. A theme's honest label lists its members — "work, dread and 2 more" —
because an invented name is an interpretation, and a heading is the hardest
kind of interpretation to argue with. But the membership list alone does not
help someone see *why those words belong together*, which is exactly the
hidden shape they cannot find on their own.

So a model may write one sentence, under three constraints:

**Labels only, never entries.** The prompt receives the theme's member labels
— single words the extraction already derived — and nothing else. The summary
can reveal nothing the heading does not already name.

**Bounded and plain.** One sentence, short. No diagnosis, no advice, no causal
claim. The restraint benchmarks hold here too: clinical language is forbidden
unless the person themselves used it in a member label.

**Marked as written, kept provisional.** The sentence is stored beside the
model that wrote it (`summary_model`) and rendered beneath the membership
label, never instead of it. Deleting it leaves the theme exactly as clusters
found it.

Failures are logged and skipped: a theme without a summary is the honest state
every theme lived in before this module existed.
"""

from __future__ import annotations

import logging
from uuid import UUID

import asyncpg
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

logger = logging.getLogger(__name__)

VERSION = "theme-summaries-v0.1"

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

SYSTEM_PROMPT = """You describe regions of one person's life from the words \
they themselves used. You are given the words that make up one region. Write \
ONE sentence, at most fifteen words, saying what these words share or when \
they tend to arrive together.

Rules you may not break:
- Use only what the given words say. Add no cause, no reason, no diagnosis, \
no advice, no clinical term unless it appears in the words themselves.
- Name no one. Make no claim about who the person is.
- If the words do not form anything coherent, write exactly: \
"These words have not yet formed something I can describe."
- Plain words, second person ("you"). No preamble, no quotes, one sentence."""

#: How many member labels to show the model. Themes with more members than
#: this get their most confident members' labels; the sentence describes the
#: region's core, not its census.
MAX_LABELS = 12


def _member_labels(members: list[dict]) -> list[str]:
    """Member labels for the prompt: deduplicated, confidence-ordered, capped."""
    ordered = sorted(
        members,
        key=lambda m: (-(m.get("confidence") or 0.0), str(m.get("label", ""))),
    )
    seen: set[str] = set()
    labels: list[str] = []
    for member in ordered:
        label = str(member.get("label") or "").strip()
        if not label or label.lower() in seen:
            continue
        seen.add(label.lower())
        labels.append(label)
        if len(labels) >= MAX_LABELS:
            break
    return labels


def _client(api_key: str, model: str) -> ChatOpenAI:
    return ChatOpenAI(
        model=model,
        api_key=api_key,
        base_url=OPENROUTER_BASE_URL,
        timeout=60,
        max_retries=2,
        # One sentence by design; a cap keeps a misbehaving prompt from
        # producing a paragraph that pretends to be a summary.
        max_completion_tokens=120,
        default_headers={
            "HTTP-Referer": "https://github.com/tlon",
            "X-Title": "Tlon",
        },
    )


async def store(
    conn: asyncpg.Connection,
    theme_id: UUID,
    summary: str,
    model: str,
) -> None:
    await conn.execute(
        """
        UPDATE themes
        SET summary = $2, summary_model = $3, summary_at = now()
        WHERE node_id = $1
        """,
        theme_id,
        summary.strip(),
        model,
    )


async def clear(conn: asyncpg.Connection, theme_id: UUID) -> None:
    """Forget the sentence but keep the region. The judgment stays with the
    person, and the cluster stays exactly what clustering found."""
    await conn.execute(
        """
        UPDATE themes
        SET summary = NULL, summary_model = NULL, summary_at = NULL
        WHERE node_id = $1
        """,
        theme_id,
    )


async def summarise_themes(
    pool: asyncpg.Pool,
    user_id: UUID,
    api_key: str,
    model: str,
) -> int:
    """Write one sentence per held theme that lacks one. Returns how many were
    written. Failures are logged and skipped per theme: no summary is the
    honest state every theme lived in before models could write."""
    client = _client(api_key, model)
    written = 0
    async with pool.acquire() as connection:
        themes = [
            row
            async for row in _fetch_rows_with_members(connection, user_id)
        ]
        for theme in themes:
            labels = _member_labels(theme["members"])
            if not labels:
                continue
            try:
                reply = await client.ainvoke(
                    [
                        SystemMessage(content=SYSTEM_PROMPT),
                        HumanMessage(content="The words: " + ", ".join(labels)),
                    ],
                )
            except Exception:
                logger.warning("theme summary failed for %s", theme["id"], exc_info=True)
                continue
            sentence = (reply.content or "").strip().strip('"')
            if not sentence or len(sentence) > 400:
                logger.info("theme summary rejected for %s (empty or overlong)", theme["id"])
                continue
            await store(connection, theme["id"], sentence, model)
            written += 1
    return written


async def _fetch_rows_with_members(pool: asyncpg.Pool, user_id: UUID):
    """Held themes lacking a summary, with structured member details."""
    rows = await pool.fetch(
        """
        SELECT n.id, m.label, m.confidence
        FROM graph_nodes n
        JOIN themes t ON t.node_id = n.id
        JOIN theme_members tm ON tm.theme_id = n.id
        JOIN graph_nodes m ON m.id = tm.node_id
        WHERE n.user_id = $1 AND n.kind = 'Theme'
          AND n.deleted_at IS NULL AND t.lapsed_at IS NULL
          AND (t.summary IS NULL OR t.summary_model IS NULL)
        ORDER BY n.id
        """,
        user_id,
    )
    themes: dict[UUID, dict] = {}
    for row in rows:
        theme = themes.setdefault(row["id"], {"id": row["id"], "members": []})
        theme["members"].append({"label": row["label"], "confidence": row["confidence"]})
    for theme in themes.values():
        yield theme
