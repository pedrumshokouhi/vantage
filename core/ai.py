"""Optional Claude layer. Vantage is fully functional without it; with an API key
the chief of staff, story analysis, consequence maps, thesis checks, meeting
prep and message drafts get a reasoning upgrade.

Every prompt carries the same contract: separate retrieved facts from
interpretation, cite record ids, say what's missing, never invent data.
"""
import json
import os
import re
import sys

from . import db

VENDOR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "vendor")
if os.path.isdir(VENDOR) and VENDOR not in sys.path:
    sys.path.insert(0, VENDOR)

try:
    import anthropic  # noqa: E402
except ImportError:  # pragma: no cover
    anthropic = None

DEFAULT_MODEL = "claude-opus-5"

CONTRACT = """You are the analytical engine inside Vantage, a private command center for one person.
Rules you must follow:
- Use only the records and sources provided. Never invent prices, holdings, people, relationships, dates, quotes or sources.
- Separate what the records say (retrieved/facts) from your reasoning (interpretation) and from anything forward-looking (forecast).
- Cite records inline as [ref:<kind>:<id>] and news as [src:<n>] using the ids given.
- When information needed for a good answer is missing, say exactly what is missing.
- Be concise, specific and decision-useful. Offer considerations, not personalised financial advice or instructions to trade."""


def key():
    return db.get_setting("live", "anthropic_key") or os.environ.get("ANTHROPIC_API_KEY")


def status():
    if anthropic is None:
        return {"ok": False, "reason": "sdk_missing",
                "help": "Install the Anthropic SDK: python3 -m pip install --target vendor anthropic (run inside the vantage folder), then restart."}
    if not key():
        return {"ok": False, "reason": "no_key", "help": "Add an Anthropic API key in Settings → Integrations."}
    return {"ok": True, "model": model()}


def model():
    return db.get_setting("live", "anthropic_model") or DEFAULT_MODEL


class AIUnavailable(Exception):
    pass


def complete(prompt, system_extra="", max_tokens=8000, effort="medium"):
    st = status()
    if not st["ok"]:
        raise AIUnavailable(st["help"])
    client = anthropic.Anthropic(api_key=key(), timeout=120.0, max_retries=2)
    # output_config (effort) and server-side refusal fallbacks are sent via extra_body/extra_headers so this
    # works across SDK versions available on Python 3.9.
    try:
        resp = client.messages.create(
            model=model(),
            max_tokens=max_tokens,
            system=CONTRACT + ("\n\n" + system_extra if system_extra else ""),
            messages=[{"role": "user", "content": prompt}],
            extra_body={"output_config": {"effort": effort}, "fallbacks": "default"},
            extra_headers={"anthropic-beta": "server-side-fallback-2026-07-01"},
        )
    except anthropic.AuthenticationError:
        raise AIUnavailable("The Anthropic API key was rejected.")
    except anthropic.RateLimitError:
        raise AIUnavailable("Rate limited by the Anthropic API. Try again shortly.")
    except anthropic.BadRequestError as e:
        raise AIUnavailable("Request rejected: %s" % getattr(e, "message", e))
    except anthropic.APIStatusError as e:
        raise AIUnavailable("Anthropic API error %s." % e.status_code)
    except anthropic.APIConnectionError:
        raise AIUnavailable("Could not reach the Anthropic API (network).")
    if resp.stop_reason == "refusal":
        raise AIUnavailable("The model declined this request.")
    text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
    return text


def complete_json(prompt, system_extra="", max_tokens=8000, effort="medium"):
    text = complete(prompt + "\n\nRespond with a single JSON object only, no prose before or after.", system_extra, max_tokens, effort)
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise AIUnavailable("The model did not return JSON.")
    try:
        return json.loads(m.group(0))
    except ValueError:
        raise AIUnavailable("The model returned malformed JSON.")


def _j(x):
    return json.dumps(x, default=str, ensure_ascii=False)[:60000]


def analyze_story(story, port_summary, interests):
    prompt = """Story cluster (reported facts from these sources):
%s

My portfolio summary (calculated): %s
My interests: %s

Explain this development in five parts. JSON keys:
"happened": 2-3 sentences of what was reported, attributing claims to sources [src:n],
"matters": why it matters (interpretation),
"people": effect on everyday people, "business": effect on businesses, "markets": effect on financial markets,
"mine": how it relates to my specific holdings or plans (name them; say "no clear link" if none),
"watch": list of 3-5 concrete things to watch next (forecast-type, with what would confirm or refute),
"competing": the strongest competing interpretation,
"confidence": "low"|"medium"|"high" with one-line reason.""" % (_j(story), _j(port_summary), _j(interests))
    return complete_json(prompt)


def deepen_impact(story, graph, holdings):
    prompt = """Event: %s
Built-in model's consequence map (drivers and links): %s
My holdings (ticker, sector, weight): %s

Improve the consequence map for this specific event. Return JSON:
{"edges":[{"from":"<event or driver label>","to":"<driver, industry, or holding ticker>","sign":1|-1,
"logic":"...","evidence":"what supports this link (cite [src:n] if from the story)","uncertainty":"low|medium|high",
"horizon":"...","offsets":"offsetting effects","threshold":"what would have to happen for this to matter"}],
"competing":"strongest competing interpretation","summary":"2 sentences on the net effect on my holdings (interpretation)"}
Keep to at most 12 edges, only ones that add information beyond the built-in map.""" % (_j(story), _j(graph), _j(holdings))
    return complete_json(prompt, effort="high")


def assess_thesis(holding, thesis, story):
    prompt = """Holding: %s
My recorded thesis: %s
New information (reported): %s

Assess whether this new information supports, weakens, or does not change my thesis. JSON:
{"verdict":"supports|weakens|no change|unclear","reason":"...","what_changed":"You bought this partly because X. The latest information indicates Y.",
"what_to_check":["..."],"confidence":"low|medium|high"}""" % (_j(holding), _j(thesis), _j(story))
    return complete_json(prompt, effort="high")


def ask(question, context):
    prompt = """Question: %s

Records and sources retrieved from my Vantage data (cite them):
%s

Answer in Markdown with three sections: **What the records show** (retrieved, cited), **Interpretation** (your reasoning, labelled),
**Missing or uncertain** (what data would change the answer). End with up to three suggested next actions.""" % (question, _j(context))
    return complete(prompt, effort="medium")


def draft(contact, context, purpose):
    prompt = """Draft a short, warm, specific message from me to this contact. Contact record: %s
Context (reasons to reconnect, promises, recent news): %s
Purpose: %s
Plain text, under 120 words, no clichés, no em dashes, sound like a real person. Do not invent shared history not in the record.""" % (
        _j(contact), _j(context), purpose or "reconnect")
    return complete(prompt, effort="low", max_tokens=2000)


def prep(brief):
    prompt = """Prepare me for this event. Brief assembled from my records: %s
Return Markdown: **Objective** (one line), **Talking points** (5 max, each tied to a record), **Questions to ask**, **Watch-outs**, **Missing information**.""" % _j(brief)
    return complete(prompt, effort="medium")
