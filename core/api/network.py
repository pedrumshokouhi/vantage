"""Contacts: relationship memory, "who do I know", drafts and contact import."""
import csv
import io

from .. import ai, db, intel
from .common import HTTPError, need, route


@route("GET", "/api/network")
def network(h):
    cs = db.list_records(h.space, "contact")
    for c in cs:
        lc = intel.last_contact(c)
        c["_last"] = lc.isoformat() if lc else None
        nf = intel.next_followup(c)
        c["_next"] = nf.isoformat() if nf else None
        c["_cadence"] = intel.cadence(c)
    return {"contacts": cs, "memory": intel.relationship_memory(h.space)}


@route("GET", "/api/who")
def who(h):
    return intel.who(h.space, h.query.get("q") or "")


@route("POST", "/api/draft")
def draft(h):
    d = h.body()
    need(d, "contact_id")
    base = intel.draft_message(h.space, d["contact_id"], d.get("purpose") or "")
    if not base:
        raise HTTPError(404, "Contact not found")
    if d.get("ai"):
        c = db.get_record(h.space, d["contact_id"])
        try:
            base["body"] = ai.draft({k: c.get(k) for k in ("name", "role", "org", "city", "interests", "notes", "how_met", "interactions", "commitments")},
                                    base["basis"], d.get("purpose"))
            base["model"] = ai.model()
        except ai.AIUnavailable as e:
            raise HTTPError(503, str(e))
    return base


@route("POST", "/api/import/contacts")
def import_contacts(h):
    text = h.body().get("csv") or ""
    lines = text.strip().splitlines()
    # LinkedIn exports start with a "Notes:" preamble before the header row
    for i, ln in enumerate(lines[:10]):
        if "First Name" in ln or ln.lower().startswith(("name", "first name", "given name")):
            lines = lines[i:]
            break
    rows = list(csv.DictReader(io.StringIO("\n".join(lines))))
    existing = {(c.get("name") or "").lower() for c in db.list_records(h.space, "contact")}
    added = 0
    for r in rows:
        g = {(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}
        name = g.get("name") or " ".join(x for x in (g.get("first name") or g.get("given name"), g.get("last name") or g.get("family name")) if x)
        if not name or name.lower() in existing:
            continue
        rec = {"name": name, "org": g.get("company") or g.get("organization 1 - name") or g.get("organization") or g.get("org"),
               "role": g.get("position") or g.get("organization 1 - title") or g.get("title") or g.get("role"),
               "email": g.get("email address") or g.get("e-mail 1 - value") or g.get("email"),
               "city": g.get("city") or g.get("address 1 - city"), "birthday": g.get("birthday") or None,
               "linkedin": g.get("url"), "closeness": 2, "influence": 2, "prominence": 1,
               "how_met": ("LinkedIn connection since %s" % g["connected on"]) if g.get("connected on") else None,
               "notes": g.get("notes") or ""}
        db.create_record(h.space, "contact", {k: v for k, v in rec.items() if v not in (None, "")})
        existing.add(name.lower())
        added += 1
    return {"added": added, "rows": len(rows)}
