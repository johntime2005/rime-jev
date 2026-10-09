"""Export the pinned native checkout without normalizing upstream BOM/EOLs.

This only updates the reviewable patch and the isolated upstream checkout.
It never modifies an installed input method.
"""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
source = root / 'upstream/weasel'
revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
if revision != '9cc96e20dc71b80876b12f689bb5863c76c2a7ed':
    raise SystemExit('Unexpected upstream revision; refusing export.')
names = subprocess.check_output(['git', '-C', str(source), 'diff', '--name-only'], text=True).splitlines()
for name in names:
    original = subprocess.check_output(['git', '-C', str(source), 'show', 'HEAD:' + name])
    path = source / name
    content = path.read_bytes().decode('utf-8-sig').replace('\r\n', '\n')
    if b'\r\n' in original:
        content = content.replace('\n', '\r\n')
    path.write_bytes((b'\xef\xbb\xbf' if original.startswith(b'\xef\xbb\xbf') else b'') + content.encode('utf-8'))
patch = subprocess.check_output(['git', '-C', str(source), 'diff', '--binary', 'HEAD', '--'])
(root / 'native/weasel-jev.patch').write_bytes(patch)
print('Exported tracked native edits; native/include headers are packaged separately.')
