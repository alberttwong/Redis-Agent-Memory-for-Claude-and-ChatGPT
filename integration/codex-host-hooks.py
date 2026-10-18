#!/usr/bin/env python3
"""Opt-in real Codex CLI hook dispatch and /compact check (Unix PTY required)."""
import errno
import fcntl
import struct
import termios
import json
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import subprocess
import tempfile
import time

if os.environ.get('RAM_RUN_HOST_HOOKS') != '1':
    raise SystemExit('Opt-in required: RAM_RUN_HOST_HOOKS=1 npm run test:e2e:codex-host')

root = Path(__file__).resolve().parent.parent
node = shutil.which('node')
codex = shutil.which('codex')
if not node or not codex:
    raise SystemExit('Install/authenticate Codex CLI and Node.js before this opt-in check.')

with tempfile.TemporaryDirectory(prefix='ram-codex-host-') as temporary:
    project = Path(temporary).resolve()
    os.chmod(project, 0o700)
    home = project / 'home'
    home.mkdir()
    (project / '.codex').mkdir()
    auth = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'auth.json'
    if auth.exists():
        (home / 'auth.json').symlink_to(auth.resolve())
    (home / 'config.toml').write_text('[projects.' + json.dumps(str(project)) + ']\ntrust_level = "trusted"\n')
    (project / '.memory-capture.json').write_text(json.dumps({
        'ownerId': 'host-test', 'namespace': 'host-test', 'promptRecall': False, 'recallLimit': 0,
    }))
    dispatch = project / 'dispatch.jsonl'
    cli = root / 'plugins/redis-agent-memory/server/capture-cli.js'
    wrapper = project / 'hook.mjs'
    # Only hooks are offline. The actual host and compaction use the installed
    # authenticated Codex CLI. No real memory credentials enter this fixture.
    wrapper.write_text('''import {appendFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
let raw=''; for await (const chunk of process.stdin) raw+=chunk;
const event=JSON.parse(raw);
appendFileSync(DISPATCH, JSON.stringify(event)+'\\n');
const env={...process.env};
for(const key of Object.keys(env)) if(key.startsWith('AGENT_MEMORY_') || key.startsWith('REDIS_CLOUD_') || key.startsWith('MEMORY_CAPTURE_')) delete env[key];
env.AGENT_MEMORY_CONFIG_FILE=PROJECT+'/absent.json';
env.AGENT_MEMORY_SHARED_SETTINGS_FILE=PROJECT+'/absent-shared.json';
const result=spawnSync(process.execPath,[CLI,'hook','codex','--project',PROJECT],{env,input:raw,encoding:'utf8'});
process.stdout.write(result.stdout ?? '{}');
'''.replace('DISPATCH', json.dumps(str(dispatch))).replace('PROJECT', json.dumps(str(project))).replace('CLI', json.dumps(str(cli))))
    manifest = json.loads((root / 'plugins/redis-agent-memory/hooks/hooks.json').read_text())
    import shlex
    for groups in manifest['hooks'].values():
        for group in groups:
            for hook in group['hooks']:
                hook['command'] = shlex.quote(node) + ' ' + shlex.quote(str(wrapper))
                hook.pop('commandWindows', None)
    (project / '.codex/hooks.json').write_text(json.dumps(manifest))
    env = dict(os.environ, CODEX_HOME=str(home), TERM='dumb')
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 100, 0, 0))
    process = subprocess.Popen([codex, '--dangerously-bypass-hook-trust', '--sandbox', 'read-only', '-C', str(project)],
                               cwd=project, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    os.close(slave)
    output = bytearray()

    def events():
        if not dispatch.exists():
            return []
        # A concurrent hook append may end with an unfinished line.
        return [json.loads(line) for line in dispatch.read_text().splitlines(keepends=True) if line.endswith('\n')]

    def pump():
        if select.select([master], [], [], 0.1)[0]:
            try:
                output.extend(os.read(master, 65536))
                # Keep synthetic terminal output local for failure diagnosis only.
                (project / "terminal-output.bin").write_bytes(output)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
        if process.poll() is not None:
            raise RuntimeError('Codex exited before host verification completed; inspect CLI authentication/configuration.')

    deadline = time.monotonic() + 120

    def until(predicate, label):
        while not predicate():
            if time.monotonic() > deadline:
                raise RuntimeError('Timed out waiting for ' + label)
            pump()

    try:
        until(lambda: b'Continue anyway?' in output, 'terminal confirmation')
        os.write(master, b'y\n')
        until(lambda: b'state=idle:app=codex' in output, 'ready interactive composer')
        # Separate paste and Enter so the host's paste protection does not keep
        # the synthetic prompt in the composer.
        os.write(master, b'This is a host hook dispatch integration test. Run exactly one command: printf RAM_HOST_COMPACT. Then reply RAM_HOST_COMPLETE. Do not read files or perform any other action.')
        time.sleep(0.3)
        os.write(master, b'\r')
        until(lambda: any(e.get('hook_event_name') == 'Stop' for e in events()), 'completed synthetic turn')
        os.write(master, b'/compact')
        time.sleep(0.3)
        os.write(master, b'\r')
        until(lambda: any(e.get('hook_event_name') == 'PreCompact' for e in events()), 'real /compact dispatch')
        until(lambda: b'Context' in output and b'compacted' in output, 'completed compaction')
        captured = events()
        expected = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'PreCompact']
        actual = [e.get('hook_event_name') for e in captured]
        assert all(name in actual for name in expected), 'Missing lifecycle event: ' + repr(actual)
        compact = next(e for e in captured if e.get('hook_event_name') == 'PreCompact')
        assert compact.get('trigger') == 'manual', 'Compaction must originate from the real manual command'
        assert len({e['session_id'] for e in captured}) == 1, 'Host session identity changed unexpectedly'
        tools = [e for e in captured if e.get('hook_event_name') in ('PreToolUse', 'PostToolUse')]
        assert len(tools) == 2, 'Expected exactly one tool invocation and its result'
        assert all(e.get('tool_name') == 'Bash' for e in tools), 'Unexpected tool contract'
        before = next(e for e in tools if e['hook_event_name'] == 'PreToolUse')
        assert before.get('tool_input', {}).get('command', '').strip() == 'printf RAM_HOST_COMPACT', 'Unexpected synthetic command'
        queue = project / '.memory-capture/queue'
        entries = [json.loads(path.read_text()) for path in queue.glob('*.json')]
        assert any(entry.get('checkpoint') for entry in entries), 'Packaged boundary did not durably queue a checkpoint'
        assert any(json.loads(memory['text']).get('eventType') == 'PreCompact'
                   for entry in entries for memory in entry['memories']), 'Packaged handler did not capture the boundary'
        version = subprocess.check_output([codex, '--version'], stderr=subprocess.DEVNULL, text=True).strip()
        print(json.dumps({'host': version, 'events': actual, 'compactionTrigger': compact['trigger'],
                          'packagedQueueVerified': True, 'desktopActivationVerified': False}))
    finally:
        if process.poll() is None:
            os.write(master, b'\x04')
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
        os.close(master)
