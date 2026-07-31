import pytest

from tlon.domain.credentials import (
    MIN_PASSWORD_LENGTH,
    WeakPassword,
    generate_token,
    hash_password,
    hash_token,
    needs_rehash,
    normalize_email,
    validate_password,
    verify_password,
)

GOOD = "correct horse battery staple"


class TestPasswordHashing:
    def test_a_password_verifies_against_its_own_hash(self):
        assert verify_password(hash_password(GOOD), GOOD)

    def test_a_wrong_password_does_not_verify(self):
        assert not verify_password(hash_password(GOOD), "something else entirely")

    def test_the_same_password_hashes_differently_each_time(self):
        # Argon2 salts per hash, so two accounts with the same password are not
        # visibly identical in a database dump.
        assert hash_password(GOOD) != hash_password(GOOD)

    def test_the_plaintext_never_appears_in_the_hash(self):
        assert GOOD not in hash_password(GOOD)

    def test_a_user_with_no_password_cannot_authenticate(self):
        assert not verify_password(None, GOOD)
        assert not verify_password("", GOOD)

    def test_a_corrupt_stored_hash_fails_closed(self):
        assert not verify_password("not-an-argon2-hash", GOOD)

    def test_a_fresh_hash_does_not_need_rehashing(self):
        assert not needs_rehash(hash_password(GOOD))

    def test_a_corrupt_hash_is_not_reported_as_needing_rehash(self):
        # It cannot be upgraded on login; it fails verification instead.
        assert not needs_rehash("garbage")


class TestPasswordPolicy:
    def test_short_passwords_are_rejected(self):
        with pytest.raises(WeakPassword):
            validate_password("a" * (MIN_PASSWORD_LENGTH - 1))

    def test_a_password_at_the_minimum_is_accepted(self):
        assert validate_password("a" * MIN_PASSWORD_LENGTH)

    def test_absurdly_long_passwords_are_rejected(self):
        # Hashing a multi-megabyte body would turn one request into a CPU DoS.
        with pytest.raises(WeakPassword):
            validate_password("a" * 1025)

    def test_a_long_passphrase_with_no_symbols_is_accepted(self):
        # Composition rules push people toward Password1!; length is what costs
        # an attacker work.
        assert validate_password("this is a perfectly fine passphrase")


class TestTokens:
    def test_tokens_are_unique(self):
        assert len({generate_token() for _ in range(100)}) == 100

    def test_tokens_are_long_enough_to_resist_guessing(self):
        assert len(generate_token()) >= 40

    def test_token_hashing_is_deterministic(self):
        token = generate_token()
        assert hash_token(token) == hash_token(token)

    def test_different_tokens_hash_differently(self):
        assert hash_token(generate_token()) != hash_token(generate_token())

    def test_the_raw_token_never_appears_in_its_hash(self):
        token = generate_token()
        assert token not in hash_token(token)


class TestEmailNormalization:
    def test_case_and_whitespace_are_normalized(self):
        assert normalize_email("  Patrik@Example.COM ") == "patrik@example.com"

    def test_normalization_is_idempotent(self):
        once = normalize_email("  A@B.com ")
        assert normalize_email(once) == once
