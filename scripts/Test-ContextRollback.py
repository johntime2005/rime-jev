"""Verify source rollback in a disposable local clone, never in a user worktree."""
from pathlib import Path
import subprocess
import uuid

root = Path(__file__).resolve().parents[1]
base = 'b632d04b2ac60de19292d83ecd44d45bd82fa244'
head = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
target = root / 'runtime' / ('rollback-check-' + uuid.uuid4().hex[:8])
subprocess.run(['git', 'clone', '--no-hardlinks', '--no-checkout', str(root), str(target)], check=True)
def git(*args):
    return subprocess.check_output(['git', '-C', str(target), *args], text=True).strip()
git('switch', '--detach', head)
git('-c', 'user.name=Rollback Test', '-c', 'user.email=rollback@example.invalid',
    'revert', '--no-commit', f'{base}..{head}')
subprocess.run(['git', '-C', str(target), 'diff', '--exit-code', base, '--'], check=True)
assert git('write-tree') == git('rev-parse', f'{base}^{{tree}}')
print(f'Rollback PASS: reversing feature commits restores base tree {base}.')
print(f'Disposable checkout retained for inspection: {target}')
