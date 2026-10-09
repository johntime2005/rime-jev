"""Apply the reviewable GPL patch to the pinned upstream checkout; no system edits."""
from pathlib import Path
import subprocess
import shutil

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'upstream' / 'weasel'
REVISION = '9cc96e20dc71b80876b12f689bb5863c76c2a7ed'
PATCH = ROOT / 'native' / 'weasel-jev.patch'

if not (SOURCE / '.git').exists():
    subprocess.run(['git', 'clone', '--depth', '1', '--branch', '0.17.4',
                    'https://github.com/rime/weasel.git', str(SOURCE)], check=True)
head = subprocess.check_output(['git', '-C', str(SOURCE), 'rev-parse', 'HEAD'], text=True).strip()
if head != REVISION:
    raise SystemExit('Unexpected upstream revision; refusing to patch.')
reverse = subprocess.run(['git', '-C', str(SOURCE), 'apply', '--reverse', '--check', str(PATCH)],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
if reverse.returncode == 0:
    print('Patch already applied.')
else:
    subprocess.run(['git', '-C', str(SOURCE), 'apply', '--check', str(PATCH)], check=True)
    subprocess.run(['git', '-C', str(SOURCE), 'apply', str(PATCH)], check=True)
    print('Pinned Weasel patch applied.')

for header in ('JevContext.h', 'JevTsfContext.h', 'JevEditSession.h'):
    shutil.copyfile(ROOT / 'native' / 'include' / header, SOURCE / 'include' / header)
