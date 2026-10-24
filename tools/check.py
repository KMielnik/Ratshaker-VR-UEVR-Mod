"""Run public, portable checks; never reads the installed game/profile."""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
commands = [
    ('generated entry', [sys.executable, 'tools/build.py', '--check']),
    ('packaging', [sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py']),
]
commands += [(p.name, ['node', str(p.relative_to(root))]) for p in sorted((root / 'tests').glob('*.cjs'))]
failed = []
for name, command in commands:
    try:
        result = subprocess.run(command, cwd=root, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=180)
        print(('PASS ' if result.returncode == 0 else 'FAIL ') + name, flush=True)
        if result.returncode:
            failed.append(name)
            print(result.stdout + result.stderr, flush=True)
    except subprocess.TimeoutExpired:
        failed.append(name)
        print('FAIL ' + name + ' (180-second timeout)', flush=True)
print(f'{len(commands)-len(failed)}/{len(commands)} checks passed. Lua host is simulated; headset testing is separate.')
sys.exit(bool(failed))
