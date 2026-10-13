"""Package independently authored source and safe execution evidence; exclude private/runtime data."""
import hashlib, json, pathlib, re, zipfile
root=pathlib.Path(__file__).resolve().parents[1]
output=root/'deliverables'
output.mkdir(exist_ok=True)
required=['PRD.md','REFERENCE_PARITY.csv','ROLES_PERMISSIONS.md','ERD.md','SYSTEM_ARCHITECTURE.md','DYNAMIC_FORM_SPEC.md','BILLING_AND_LEDGER.md','CERTIFICATE_STATE_MACHINE.md','THREAT_MODEL.md','DELIVERY_BACKLOG.md','TEST_MATRIX.md','EXECUTION_RESULTS.md']
assert all((root/'docs'/name).is_file() for name in required)
assert len(list((root/'handoff').iterdir()))==9
folders=['apps','packages','db','data','scripts','docs','handoff','execution','deployment','.github']
files=[root/name for name in ['README.md','LICENSE','THIRD_PARTY_NOTICES.md','package.json','package-lock.json','tsconfig.json','.gitignore','.gitattributes','.dockerignore','.env.example','Dockerfile','compose.yaml']]
historical_evidence={'backend-expansion.log','backend-full.log','backend-integration.log','build.log','form-engine.log','frontend-browser.log','frontend-render.log','demo-permanent-resident.pdf','demo-permanent-resident.png','service-2-expanded-demo-page2.png','service-42-expanded-demo-page2.png','trade-renewal-demo-page2.png'}
for folder in folders:
    files.extend(p for p in (root/folder).rglob('*') if p.is_file() and not p.name.startswith('package-verification') and not (folder=='execution' and p.name in historical_evidence) and not {'node_modules','dist','__pycache__','.runtime','.git'}.intersection(p.relative_to(root).parts))
files=sorted(set(files))
secrets=set()
def add_secret(value):
    if isinstance(value,str) and value:
        secrets.add(value.encode('utf8'))
        # JSON logs can escape otherwise literal credentials. Check both forms.
        secrets.add(json.dumps(value,ensure_ascii=True)[1:-1].encode('utf8'))
        secrets.add(json.dumps(value,ensure_ascii=False)[1:-1].encode('utf8'))
settings_file=root/'.runtime/postgres.json'
settings=json.loads(settings_file.read_text(encoding='utf-8-sig')) if settings_file.exists() else {}
from urllib.parse import urlparse, unquote
for key in ('adminUrl','appUrl'):
    secret=unquote(urlparse(settings.get(key,'')).password or '')
    add_secret(secret)
secret_file=root/'.runtime/webhook-secret'
if secret_file.exists():add_secret(secret_file.read_text(encoding='utf-8-sig').strip())

def sensitive_key(key):
    normalized=re.sub(r'[^a-z0-9]','',str(key).lower())
    return normalized.endswith(('password','passwd','passphrase','secret','token','tokenhash','apikey','privatekey','encryptionkey','accesskey')) or normalized in ('authorization','cookie','setcookie')

def collect_hosted_secrets(value,key=''):
    if isinstance(value,dict):
        # Also support environment entries represented as {key/name, value}.
        label=value.get('key',value.get('name',''))
        if sensitive_key(label):add_secret(value.get('value'))
        for child_key,child in value.items():collect_hosted_secrets(child,child_key)
    elif isinstance(value,list):
        for child in value:collect_hosted_secrets(child,key)
    elif isinstance(value,str):
        if sensitive_key(key):add_secret(value)
        # Connection URLs may occur under provider-specific keys. Inspect every string.
        if value.startswith(('postgres://','postgresql://')):
            parsed=urlparse(value)
            if parsed.password:
                add_secret(value)
                add_secret(parsed.password)
                add_secret(unquote(parsed.password))

hosted_secret_files=[]
for name in ('credentials.json','render-database.json','qa-credentials.json'):
    private_file=root/'.runtime/hosted'/name
    if private_file.exists():
        collect_hosted_secrets(json.loads(private_file.read_text(encoding='utf-8-sig')))
        hosted_secret_files.append(name)
manifest=[]
for p in files:
    name=p.relative_to(root).as_posix()
    assert not {'audit','.runtime','.git','node_modules','deliverables'}.intersection(p.relative_to(root).parts)
    assert p.name!='audit.zip' and (not p.name.startswith('.env') or p.name=='.env.example')
    data=p.read_bytes()
    assert not any(secret in data for secret in secrets if secret), f'Runtime secret detected in {name}'
    manifest.append({'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
archive=output/'Astra_Fullstack_Website_Source.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for p in files:z.write(p,p.relative_to(root).as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert len(z.infolist())==len(manifest)
    for item in manifest:assert hashlib.sha256(z.read(item['path'])).hexdigest()==item['sha256']
summary={'release':json.loads((root/'package.json').read_text(encoding='utf8'))['version'],'archive':archive.name,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'bytes':archive.stat().st_size,'fileCount':len(manifest),'requiredDocs':len(required),'curatedHandoffFiles':9,'excluded':['private audit/ and audit.zip','.runtime/ credentials, encryption keys, backups and DB clusters','node_modules and downloaded runtime binaries','.git and built dist assets','superseded Phase 1 logs and orphaned PDF page renders'],'runtimeSecretScan':'PASS' if secrets else 'NO_LOCAL_RUNTIME_SECRETS_AVAILABLE','hostedSecretSourcesScanned':hosted_secret_files,'zipIntegrity':'PASS','manifestHashes':'PASS','files':manifest}
(output/'WEBSITE_SOURCE_MANIFEST.json').write_text(json.dumps(summary,indent=2),encoding='utf8')
(root/'execution/package-verification-current.json').write_text(json.dumps({k:v for k,v in summary.items() if k!='files'},indent=2),encoding='utf8')
print(json.dumps({k:v for k,v in summary.items() if k!='files'},indent=2))
