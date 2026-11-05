"""HTTP helper with retries."""
import random
import time

MAX_ATTEMPTS = 5
BASE_BACKOFF_SECONDS = 2
MAX_BACKOFF_SECONDS = 30


def fetch_with_retry(fetch, attempts=MAX_ATTEMPTS):
    """Call fetch() and retry on failure using exponential backoff with jitter.

    The wait doubles after every failed attempt (2s, 4s, 8s...) but never exceeds MAX_BACKOFF_SECONDS.
    Only ConnectionError and TimeoutError are retried; any other exception is raised immediately.
    """
    for attempt in range(1, attempts + 1):
        try:
            return fetch()
        except (ConnectionError, TimeoutError):
            if attempt == attempts:
                raise
            delay = min(BASE_BACKOFF_SECONDS * 2 ** (attempt - 1), MAX_BACKOFF_SECONDS)
            time.sleep(delay + random.uniform(0, 0.5))
