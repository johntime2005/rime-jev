"""Verify source rollback in a disposable local clone, never in a user worktree."""
import argparse
from pathlib import Path
import subprocess
import uuid

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', default='b632d04b2ac60de19292d83ecd44d45bd82fa244',
                    help='First-parent ancestor to restore (use the merge first parent to retain other work).')
args = parser.parse_args()
base = subprocess.check_output(['git', '-C', str(root), 'rev-parse', f'{args.base}^{{commit}}'], text=True).strip()
head = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
history = subprocess.check_output(['git', '-C', str(root), 'rev-list', '--first-parent', head], text=True).splitlines()
if base not in history:
    raise SystemExit('Rollback base must be on the first-parent history; no checkout created.')
target = root / 'runtime' / ('rollback-check-' + uuid.uuid4().hex[:8])
subprocess.run(['git', 'clone', '--no-hardlinks', '--no-checkout', str(root), str(target)], check=True)
def git(*args):
    return subprocess.check_output(['git', '-C', str(target), *args], text=True).strip()
git('switch', '--detach', head)
# A merge must be reversed relative to main, not by replaying both histories.
for commit in history[:history.index(base)]:
    parents = git('show', '-s', '--format=%P', commit).split()
    mainline = ['-m', '1'] if len(parents) > 1 else []
    git('-c', 'user.name=Rollback Test', '-c', 'user.email=rollback@example.invalid',
        'revert', '--no-commit', *mainline, commit)
subprocess.run(['git', '-C', str(target), 'diff', '--exit-code', base, '--'], check=True)
assert git('write-tree') == git('rev-parse', f'{base}^{{tree}}')
print(f'Rollback PASS: reversing first-parent changes restores base tree {base}.')
print(f'Disposable checkout retained for inspection: {target}')
