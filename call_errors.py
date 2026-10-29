"""Distinguish HTTP authentication statuses from image paths and identifiers."""
import re


def authentication_status_error(message):
    # Image reader errors often include a job path and a nanosecond timestamp.
    # Neither a path component nor digits embedded in an ID are an HTTP status.
    text = re.sub(r'\S*[/\\]\S*', '', str(message))
    return bool(re.search(r'(?<!\w)(?:401|403)(?!\w)', text))
