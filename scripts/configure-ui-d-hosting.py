"""Configure only the explicitly isolated D hosting resources; never A/B."""
from pathlib import Path
from urllib.parse import urlparse, quote
import json
import os
import secrets
import subprocess
import urllib.error
import urllib.request

root = Path(__file__).resolve().parents[1]
record_path = root / '.runtime/testnet/ui-d-hosting.json'
record = json.loads(record_path.read_text())
assert record['kind'] == 'isolated-chiado-ui-d-test15m'
assert record['railwayProjectId'] == '23ab879a-90d0-4f8f-a56a-d63baa85eed5'
assert record['netlifySiteId'] == '17e7e27e-1c2a-4411-91a7-cb0da8fece90'
assert record['railwayServiceId'] not in ['127e805c-b341-45e5-8a6b-822e432ee134', 'd9178cc4-b1a5-4b80-af54-6c2b0aafe8f6', '44d00bdc-2d7e-46cb-aa9c-18f4d3fa2547']
assert record['railwayServiceId'] == '8f2ab191-3c3b-4033-ae43-77fcfdeb9a81'
assert record['railwayVolumeId'] == 'c4531d97-ea11-4fe6-a2a2-91bd4736d0b1'
assert record['volumeMount'] == '/data'
for name in ['publicOrigin', 'backendOrigin']:
    value = record[name]
    url = urlparse(value)
    assert url.scheme == 'https' and url.netloc and not url.username and not url.password
    assert not url.path and not url.query and not url.fragment
assert record['publicOrigin'] != 'https://kleros-event-workbench-preview.netlify.app'
assert record['backendOrigin'] != 'https://workbench-testnet-api-production.up.railway.app'

private_path = root / '.runtime/testnet/ui-d-hosting-private.json'
if private_path.exists():
    private = json.loads(private_path.read_text())
    assert private['purpose'] == 'D hosted testnet proxy only'
    assert all(private[key] == record[key] for key in ['publicOrigin', 'backendOrigin'])
    assert private_path.stat().st_mode & 0o777 == 0o600
else:
    private = {key: record[key] for key in ['publicOrigin', 'backendOrigin']}
    private.update(purpose='D hosted testnet proxy only', proxySecret=secrets.token_urlsafe(48))
    fd = os.open(private_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(json.dumps(private) + '\n')
key = private['proxySecret']
assert key != json.loads((root / '.runtime/hosted-deployment-private.json').read_text())['proxySecret']
assert key != json.loads((root / '.runtime/testnet/ui-c-hosting-private.json').read_text())['proxySecret']

variables = {
    'MODE': 'hosted-testnet', 'PUBLIC_ORIGIN': record['publicOrigin'],
    'BACKEND_ORIGIN': record['backendOrigin'], 'PROXY_SECRET': key,
    'PORT': '3000', 'RPC_PORT': '0', 'RUNTIME_ROOT': '/app/.runtime',
    'CONTRACT_VERSION': 'kleros-event-v8-test15m',
    'TESTNET_MANIFEST': '/app/registry/chiado-v8-ui-d.json',
    'TESTNET_STATE_FILE': '/data/workbench-state.json',
    'TESTNET_RPC_URL': 'https://rpc.chiado.gnosis.gateway.fm',
    'RAILWAY_RUN_UID': '0',
}
for name, value in variables.items():
    result = subprocess.run([
        'npx', '--yes', '@railway/cli@5.71.0', 'variable', 'set', name,
        '--stdin', '--skip-deploys', '--project', record['railwayProjectId'],
        '--service', record['railwayServiceId'], '--environment', 'production',
    ], input=value, text=True, capture_output=True)
    if result.returncode:
        raise SystemExit('D variable configuration failed for ' + name + '; sensitive output withheld.')
print('Configured D backend variable names: ' + ', '.join(variables), flush=True)

config = json.loads((Path.home() / 'Library/Preferences/netlify/config.json').read_text())
token = config['users'][config['userId']]['auth']['token']
def api(method, endpoint, value=None):
    request = urllib.request.Request('https://api.netlify.com/api/v1' + endpoint,
        data=None if value is None else json.dumps(value).encode(), method=method,
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit('D Netlify configuration returned HTTP ' + str(error.code) + '; response withheld.')
site = api('GET', '/sites/' + record['netlifySiteId'])
primary = api('GET', '/sites/f6b82f41-9e30-49b0-a836-40fedbab93a4')
assert site['ssl_url'] == record['publicOrigin'] and site['account_id'] == primary['account_id']
endpoint = '/accounts/' + site['account_id'] + '/env'
query = '?site_id=' + quote(record['netlifySiteId'])
existing = {item['key'] for item in api('GET', endpoint + query)}
for name, value in {'KLEROS_BACKEND_URL': record['backendOrigin'],
        'KLEROS_PUBLIC_ORIGIN': record['publicOrigin'], 'KLEROS_PROXY_SECRET': key}.items():
    payload = {'key': name, 'values': [{'context': 'production', 'value': value}]}
    if name in existing:
        api('PUT', endpoint + '/' + name + query, payload)
    else:
        api('POST', endpoint + query, [payload])
record['state'] = 'isolated-D-configured-not-deployed-no-contract-yet'
record_path.write_text(json.dumps(record, indent=2) + '\n')
print('Configured D Netlify gateway variables; no A/B setting changed and no deployment started.')
