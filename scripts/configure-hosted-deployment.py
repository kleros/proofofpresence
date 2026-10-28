"""Configure only the selected demo service and its Netlify gateway; never print secrets."""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import urllib.request
import urllib.error
from urllib.parse import urlparse, quote

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--backend-origin', required=True)
parser.add_argument('--public-origin', default='https://kleros-event-workbench-preview.netlify.app')
parser.add_argument('--project-id', required=True)
parser.add_argument('--service-id', required=True)
parser.add_argument('--environment', default='production')
args = parser.parse_args()
for value in [args.backend_origin, args.public_origin]:
    u = urlparse(value)
    assert u.scheme == 'https' and u.netloc and not u.username and not u.password and not u.path and not u.query and not u.fragment
private = root / '.runtime/hosted-deployment-private.json'
if private.is_file():
    state = json.loads(private.read_text())
    assert state['publicOrigin'] == args.public_origin, 'Refusing to reuse a key for an unrelated public site'
    key = state['proxySecret']
else:
    key = secrets.token_urlsafe(48)
    private.parent.mkdir(exist_ok=True)
    descriptor = os.open(private, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(json.dumps({'publicOrigin': args.public_origin, 'proxySecret': key}) + '\n')

variables = {'MODE': 'hosted-demo', 'PUBLIC_ORIGIN': args.public_origin, 'BACKEND_ORIGIN': args.backend_origin, 'PROXY_SECRET': key, 'PORT': '3000', 'RPC_PORT': '0', 'RUNTIME_ROOT': '/app/.runtime'}
railway_cli = ['npx', '--yes', '@railway/cli@5.71.0']
config = json.loads((Path.home()/'Library/Preferences/netlify/config.json').read_text())
token = config['users'][config['userId']]['auth']['token']
site_id = json.loads((root/'.netlify/state.json').read_text())['siteId']
def api(method, endpoint, value=None):
    req = urllib.request.Request('https://api.netlify.com/api/v1'+endpoint, data=None if value is None else json.dumps(value).encode(), method=method, headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as response: return json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit(f'Netlify environment configuration returned HTTP {error.code}; no secret response body is logged.')
site = api('GET','/sites/'+site_id)
assert site.get('ssl_url') == args.public_origin, 'Refusing to configure an unrelated Netlify site'
endpoint = '/accounts/'+site['account_id']+'/env'
query = '?site_id='+quote(site_id)
existing = {item['key'] for item in api('GET',endpoint+query)}
for name, value in variables.items():
    result = subprocess.run([*railway_cli,'variable','set',name,'--stdin','--skip-deploys','--project',args.project_id,'--service',args.service_id,'--environment',args.environment], input=value, text=True, capture_output=True)
    if result.returncode: raise SystemExit(f'Railway variable configuration failed for {name}; credentials and raw CLI output are withheld.')
print('Configured backend variable names: ' + ', '.join(variables), flush=True)
values = {'KLEROS_BACKEND_URL':args.backend_origin,'KLEROS_PUBLIC_ORIGIN':args.public_origin,'KLEROS_PROXY_SECRET':key}
for name, value in values.items():
    payload = {'key':name, 'values':[{'context':'production','value':value}], 'is_secret':name=='KLEROS_PROXY_SECRET'}
    if name in existing: api('PUT',endpoint+'/'+name+query,payload)
    else: api('POST',endpoint+query,[payload])
print('Configured Netlify runtime variable names: ' + ', '.join(values))
record = {'kind':'interactive-hosted-demo','publicOrigin':args.public_origin,'backendOrigin':args.backend_origin,'railwayProjectId':args.project_id,'railwayServiceId':args.service_id,'environment':args.environment,'netlifySiteId':site_id,'state':'configured-not-deployed'}
(root/'artifacts/hosted-deployment.json').write_text(json.dumps(record,indent=2)+'\n')
