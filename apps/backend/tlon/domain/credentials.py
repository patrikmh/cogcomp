"""Password and token handling.

Two different hashes, for two different threat models:

- **Passwords** use Argon2id — deliberately slow, so a stolen database cannot be
  brute-forced offline at speed. Users pick weak, reused passwords; the KDF is what
  stands between a dump and their journal.
- **Tokens** use SHA-256 — fast on purpose. A token is 256 bits of server-generated
  randomness with no structure to guess, so there is nothing for a slow hash to
  defend, and it is checked on every single request.

Using Argon2 for tokens would make every API call take ~100ms of CPU for no security
gain. Using SHA-256 for passwords would be a serious vulnerability. They are not
interchangeable.
"""

import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

#: Argon2id at library defaults, which track current guidance on memory and time cost.
_hasher = PasswordHasher()

#: 32 bytes of entropy, URL-safe. Long enough that rate limiting is a courtesy
#: rather than the thing holding the door shut.
TOKEN_BYTES = 32

MIN_PASSWORD_LENGTH = 12


class WeakPassword(ValueError):
    pass


def validate_password(password: str) -> str:
    """Length is the only rule.

    Composition rules (a digit, a symbol, a capital) push people toward
    `Password1!` and away from long passphrases. Length is what actually costs an
    attacker work, so it is what we ask for.
    """
    if len(password) < MIN_PASSWORD_LENGTH:
        raise WeakPassword(f"password must be at least {MIN_PASSWORD_LENGTH} characters")
    if len(password) > 1024:
        # Argon2 will hash any length; the cap stops a multi-megabyte body from
        # turning one request into a CPU denial of service.
        raise WeakPassword("password must be at most 1024 characters")
    return password


def hash_password(password: str) -> str:
    return _hasher.hash(validate_password(password))


def verify_password(password_hash: str | None, password: str) -> bool:
    if not password_hash:
        # No password set. Still not a fast path — see the timing note in the
        # login route, which burns an equivalent hash before returning.
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    """True when the stored hash used weaker parameters than we now use.

    Lets cost parameters be raised over time and applied on next login, rather than
    leaving old accounts permanently on the weaker setting.
    """
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return False


def generate_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def normalize_email(email: str) -> str:
    return email.strip().lower()
