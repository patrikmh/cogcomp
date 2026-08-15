"""Conversation agent behaviour that does not need a network."""

import pytest

from tlon.conversation import (
    CRISIS_MARKER,
    PROMPT_VERSION,
    ConversationAgent,
    Delta,
    Done,
    MarkerGate,
    StubAgent,
    _strip_marker,
    build_agent,
    load_system_prompt,
)

pytestmark = pytest.mark.anyio


class TestCrisisMarker:
    def test_the_marker_is_stripped_before_the_person_sees_it(self):
        # Showing someone a literal [CRISIS] tag would be alarming and meaningless.
        content, crisis = _strip_marker(f"{CRISIS_MARKER}\nI've heard you. Please talk to someone.")
        assert crisis is True
        assert CRISIS_MARKER not in content
        assert content.startswith("I've heard you")

    def test_leading_whitespace_does_not_hide_the_marker(self):
        _, crisis = _strip_marker(f"\n\n  {CRISIS_MARKER}\nplease reach out")
        assert crisis is True

    def test_an_ordinary_reply_is_not_flagged(self):
        content, crisis = _strip_marker("  What happened?  ")
        assert crisis is False
        assert content == "What happened?"

    def test_the_marker_only_counts_at_the_start(self):
        # Otherwise someone quoting the token, or the model mentioning it
        # mid-sentence, would trip the safety path.
        _, crisis = _strip_marker("You could write [CRISIS] in your notes if you like")
        assert crisis is False


class TestPrompt:
    def test_the_prompt_is_the_file_on_disk(self):
        assert "You are helping someone put something into words" in load_system_prompt()

    def test_it_forbids_interpretation(self):
        prompt = load_system_prompt().lower()
        assert "do not interpret" in prompt

    def test_it_forbids_diagnosis_and_advice(self):
        prompt = load_system_prompt().lower()
        assert "do not diagnose" in prompt
        assert "do not advise" in prompt

    def test_it_forbids_engagement_nudges(self):
        # "Do not optimize for engagement" has to reach the prompt, not just
        # the specification.
        prompt = load_system_prompt().lower()
        assert "do not praise them for journalling" in prompt

    def test_it_carries_the_crisis_instruction_and_the_marker(self):
        prompt = load_system_prompt()
        assert CRISIS_MARKER in prompt
        assert "ending their life" in prompt.lower()

    def test_it_tells_the_agent_not_to_invent_phone_numbers(self):
        # The application supplies real, locally correct services; a model
        # inventing one is worse than showing none.
        assert "should not invent any" in load_system_prompt().lower()


class TestStubAgent:
    async def test_it_replies(self):
        reply = await StubAgent().reply([{"speaker": "user", "content": "hi"}])
        assert reply.content

    async def test_it_never_claims_a_crisis(self):
        # A stub must not be able to trigger the safety path, in either direction.
        reply = await StubAgent().reply([{"speaker": "user", "content": "i want to kill myself"}])
        assert reply.crisis is False

    async def test_it_is_obviously_not_a_real_conversation(self):
        turns = []
        replies = []
        for i in range(4):
            turns.append({"speaker": "user", "content": f"turn {i}"})
            replies.append((await StubAgent().reply(turns)).content)
        # It rotates two fixed questions; nobody should mistake this for talking.
        assert len(set(replies)) <= 2

    async def test_its_version_is_distinguishable_from_a_real_model(self):
        assert StubAgent().version == f"{PROMPT_VERSION}/stub"


class TestMarkerGate:
    """The marker must never reach the screen, not even for one token.

    Streaming shows a reply before it is finished, and the marker is at the
    front of it. Everything here is about the window between those two facts.
    """

    def _drain(self, chunks: list[str]) -> tuple[str, bool]:
        gate = MarkerGate()
        out = "".join(gate.push(chunk) for chunk in chunks)
        return out + gate.flush(), gate.crisis

    def test_an_ordinary_reply_flows_straight_through(self):
        text, crisis = self._drain(["What ", "happened", "?"])
        assert text == "What happened?"
        assert crisis is False

    def test_the_marker_never_appears_however_it_is_split(self):
        # The tokeniser decides where the breaks fall, so no single split can be
        # assumed. Every one of them has to hold.
        for cut in range(len(CRISIS_MARKER) + 1):
            marker = CRISIS_MARKER
            text, crisis = self._drain([marker[:cut], marker[cut:], " please reach out"])
            assert CRISIS_MARKER not in text, f"leaked when split at {cut}"
            assert crisis is True
            assert text == "please reach out"

    def test_it_holds_only_the_opening(self):
        # Once the marker is ruled out nothing is buffered, so the reply streams
        # at the speed it arrives rather than in one lump at the end.
        gate = MarkerGate()
        gate.push("What happened")
        assert gate.push(" next?") == " next?"

    def test_a_reply_shorter_than_the_marker_still_arrives(self):
        text, crisis = self._drain(["Ok."])
        assert text == "Ok."
        assert crisis is False

    def test_a_reply_that_merely_starts_like_the_marker_is_not_flagged(self):
        text, crisis = self._drain(["[CRI", "TICAL] was the word you used"])
        assert crisis is False
        assert text == "[CRITICAL] was the word you used"

    def test_leading_whitespace_does_not_hide_the_marker(self):
        text, crisis = self._drain(["\n\n  ", CRISIS_MARKER, "\nplease reach out"])
        assert crisis is True
        assert text == "please reach out"

    def test_the_marker_only_counts_at_the_start(self):
        text, crisis = self._drain(["You could write ", CRISIS_MARKER, " in your notes"])
        assert crisis is False
        assert CRISIS_MARKER in text


class TestStubAgentStream:
    async def test_it_streams_the_same_reply_it_would_have_returned(self):
        turns = [{"speaker": "user", "content": "hi"}]
        events = [event async for event in StubAgent().stream(turns)]
        assert isinstance(events[-1], Done)
        assert events[-1].content == (await StubAgent().reply(turns)).content

    async def test_it_ends_with_the_whole_reply_for_storing(self):
        events = [event async for event in StubAgent().stream([{"speaker": "user", "content": "hi"}])]
        deltas = "".join(e.text for e in events if isinstance(e, Delta))
        assert deltas == events[-1].content

    async def test_it_never_claims_a_crisis(self):
        turns = [{"speaker": "user", "content": "i want to kill myself"}]
        events = [event async for event in StubAgent().stream(turns)]
        assert events[-1].crisis is False


class TestBuildAgent:
    def test_a_blank_key_falls_back_to_the_stub(self):
        assert isinstance(build_agent("", "model"), StubAgent)
        assert isinstance(build_agent("   ", "model"), StubAgent)

    def test_a_key_selects_the_real_agent(self):
        assert isinstance(build_agent("sk-test", "anthropic/claude-opus-5"), ConversationAgent)

    def test_the_version_names_the_prompt_and_model(self):
        agent = build_agent("sk-test", "anthropic/claude-opus-5")
        assert agent.version == f"{PROMPT_VERSION}/anthropic/claude-opus-5"
