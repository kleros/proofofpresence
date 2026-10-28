"""Publish only the built read-only preview using an existing Netlify login.

Credentials stay in memory. Site/deploy IDs are saved locally for repeatable updates;
no repository, backend, financial registry, DNS or account billing is changed.
"""
import argparse
import io
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("--team", required=True)
parser.add_argument("--name", default="kleros-event-workbench-preview")
args = parser.parse_args()
token = os.environ.get("NETLIFY_AUTH_TOKEN")
if not token:
    configs = [
        Path.home() / "Library/Preferences/netlify/config.json",
        Path.home() / ".config/netlify/config.json",
        Path.home() / "AppData/Roaming/netlify/Config/config.json",
    ]
    for config in configs:
        if config.is_file():
            value = json.loads(config.read_text())
            token = value.get("users", {}).get(value.get("userId"), {}).get("auth", {}).get("token")
            if token:
                break
if not token:
    raise SystemExit("Sign in with the official Netlify CLI or set NETLIFY_AUTH_TOKEN before deploying.")


def request(method, endpoint, body=None, content_type="application/json"):
    payload = json.dumps(body).encode() if isinstance(body, dict) else body
    req = urllib.request.Request(
        "https://api.netlify.com/api/v1" + endpoint,
        data=payload,
        method=method,
        headers={"Authorization": "Bearer " + token, "Content-Type": content_type, "User-Agent": "Kleros-read-only-preview-deployment"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"Netlify {method} {endpoint.split('?')[0]} returned HTTP {error.code}. No credentials are logged.")


directory = ROOT / "dist/netlify-preview"
data = json.loads((directory / "preview-data.json").read_text())
assert data["schemaVersion"] == 1
assert all(b["capabilities"]["readOnly"] for b in data["bootstrapByIdentity"].values())
assert 'src="/preview.js"' in (directory / "index.html").read_text()
assert (directory / "_headers").is_file()
archive = io.BytesIO()
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
    for file in sorted(directory.rglob("*")):
        if not file.is_file():
            continue
        relative = file.relative_to(directory)
        assert not any(p.startswith(".") for p in relative.parts)
        assert file.suffix.lower() in {".html", ".css", ".js", ".json", ".svg", ".woff2", ".md", ".txt"} or file.name == "_headers"
        output.write(file, relative.as_posix())

state_file = ROOT / ".netlify/state.json"
if state_file.is_file():
    state = json.loads(state_file.read_text())
    site = request("GET", "/sites/" + state["siteId"])
    assert site["name"] == args.name and site["account_slug"] == args.team, "Refusing an unrelated linked site"
else:
    sites = request("GET", "/sites?per_page=100")
    matches = [s for s in sites if s["name"] == args.name and s["account_slug"] == args.team]
    site = matches[0] if matches else request("POST", "/" + urllib.parse.quote(args.team, safe="") + "/sites", {"name": args.name, "force_ssl": True})
    state_file.parent.mkdir(exist_ok=True)
    state_file.write_text(json.dumps({"siteId": site["id"], "name": site["name"], "kind": "read-only-preview"}, indent=2) + "\n")

title = urllib.parse.quote("Read-only Kleros preview " + data["sourceCommit"][:12])
deploy = request("POST", "/sites/" + site["id"] + "/deploys?title=" + title, archive.getvalue(), "application/zip")
record = {
    "siteId": site["id"], "siteName": site["name"], "deployId": deploy["id"],
    "url": site.get("ssl_url") or site["url"], "deployUrl": deploy.get("deploy_ssl_url") or deploy.get("deploy_url"),
    "state": deploy["state"], "sourceCommit": data["sourceCommit"], "capturedAt": data["capturedAt"],
    "kind": "read-only-preview", "archiveBytes": len(archive.getvalue()),
}
(ROOT / "artifacts/netlify-deployment.json").write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps(record, indent=2))
