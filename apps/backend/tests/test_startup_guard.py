"""Refusing to start rather than inventing readings.

Without `OPENROUTER_API_KEY` the app falls back to the stub extractor, which is
what makes the pipeline runnable locally with no key and no network. Deployed,
that same fallback is the worst failure this system has: every screen works,
every count adds up, and every reading is fabricated. Nothing about it looks
wrong until somebody reads a reading closely and finds it describes a day they
did not have.

So a deployment sets `REQUIRE_REAL_MODEL` and gets a boot failure instead.
"""

import pytest

from tlon.config import Settings
from tlon.extraction.stub import StubExtractor
from tlon.main import build_extractor


def settings(**over) -> Settings:
    # `_env_file=None` and an explicit empty key, because the developer running
    # this has a real one in `.env` and the point of most of these is what
    # happens when nobody does.
    base = {"database_url": "postgres://unused", "openrouter_api_key": "", **over}
    return Settings(_env_file=None, **base)


def test_no_key_and_no_requirement_still_uses_the_stub():
    # Local development, unchanged: this is the bargain that lets someone run the
    # whole pipeline without an account anywhere.
    assert isinstance(build_extractor(settings()), StubExtractor)


def test_no_key_with_the_requirement_refuses_to_start():
    with pytest.raises(RuntimeError, match="readings nobody wrote"):
        build_extractor(settings(require_real_model=True))


def test_the_error_names_both_things_the_operator_must_reconcile():
    # A boot failure that does not say which of the two settings to change is a
    # boot failure someone fixes by turning the guard off.
    with pytest.raises(RuntimeError) as caught:
        build_extractor(settings(require_real_model=True))
    message = str(caught.value)
    assert "REQUIRE_REAL_MODEL" in message
    assert "OPENROUTER_API_KEY" in message


def test_a_key_satisfies_the_requirement():
    extractor = build_extractor(settings(require_real_model=True, openrouter_api_key="sk-test"))
    assert not isinstance(extractor, StubExtractor)
