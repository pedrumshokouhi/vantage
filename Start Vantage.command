#!/bin/bash
# Double-click to start Vantage and open it in your browser. Close this window (or Ctrl+C) to stop it.
cd "$(dirname "$0")"
( sleep 2; open "http://localhost:8790" ) &
exec /usr/bin/python3 -u vantage.py "$@"
