"""JSON API routes, one module per area. Importing this package registers every route."""
from . import (  # noqa: F401
    account,
    admin,
    assistant,
    briefing,
    calendar,
    network,
    portfolio,
    records,
)
