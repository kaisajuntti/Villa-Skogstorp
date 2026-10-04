"""Tiny Supabase client for maintenance scripts (budget edits etc.).

Logs in as a dedicated Supabase Auth user. Credentials come from the
environment — never commit them:
    VS_EMAIL, VS_PASSWORD
Usage:
    from vsapi import get, put
    row = get("budget")            # {data, updated_at, updated_by}
    put("budget", data, "Claude (beskrivning)")
"""
import datetime as dt
import json
import os
import urllib.request

URL = "https://xeoxxqahepdedjgfhfbo.supabase.co"
KEY = "sb_publishable_hocvLC9wkoHeMiM0kGhx9g_Q3dZtZkW"  # publishable, browser-safe
WS = "skogstorp"
_token = None


def _req(path, data=None, method=None, headers=None):
    r = urllib.request.Request(URL + path, data=data, method=method, headers=headers or {})
    with urllib.request.urlopen(r) as resp:
        body = resp.read()
        return resp.status, (json.loads(body) if body else None)


def token():
    global _token
    if _token is None:
        email, pw = os.environ.get("VS_EMAIL"), os.environ.get("VS_PASSWORD")
        if not (email and pw):
            raise SystemExit("VS_EMAIL / VS_PASSWORD saknas i miljön")
        _, j = _req("/auth/v1/token?grant_type=password",
                    json.dumps({"email": email, "password": pw}).encode(), "POST",
                    {"apikey": KEY, "Content-Type": "application/json"})
        _token = j["access_token"]
    return _token


def H():
    return {"apikey": KEY, "Authorization": "Bearer " + token(), "Content-Type": "application/json"}


def get(key, kind="space"):
    _, rows = _req(f"/rest/v1/vs_items?workspace=eq.{WS}&kind=eq.{kind}&key=eq.{key}"
                   "&select=data,updated_at,updated_by", headers=H())
    return rows[0]


def put(key, data, who, kind="space"):
    row = dict(workspace=WS, kind=kind, key=key, data=data, updated_by=who,
               updated_at=dt.datetime.now(dt.timezone.utc).isoformat())
    st, _ = _req("/rest/v1/vs_items?on_conflict=workspace,kind,key", json.dumps(row).encode(), "POST",
                 {**H(), "Prefer": "resolution=merge-duplicates,return=minimal"})
    return st


def versions(key, kind="space", limit=20):
    _, rows = _req(f"/rest/v1/vs_versions?workspace=eq.{WS}&kind=eq.{kind}&key=eq.{key}"
                   f"&select=id,data,updated_by,created_at&order=created_at.desc&limit={limit}", headers=H())
    return rows
