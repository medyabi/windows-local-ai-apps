import os
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mock_openai.py')
s = open(p, encoding='utf-8').read()
if 'def agent_plan' not in s:
    helper = r'''
def agent_plan(msgs, tools_present):
    """Scripted tool-calling behaviour. Returns a list of (name, args) tool calls, or None for a final text answer."""
    users = [i for i, m in enumerate(msgs) if m.get('role') == 'user']
    if not users:
        return None
    lu = msgs[users[-1]]
    txt = lu['content'] if isinstance(lu['content'], str) else ''
    tool_msgs = [m for m in msgs[users[-1]:] if m.get('role') == 'tool']
    n = len(tool_msgs)
    sysm = next((m['content'] for m in msgs if m.get('role') == 'system'), '')
    root = ''
    if 'Readable folders:' in sysm:
        root = sysm.split('Readable folders:')[1].strip().splitlines()[0].lstrip('- ').strip()
    if not tools_present:
        return None
    if 'AGENT-REPORT' in txt:
        if n == 0: return [('list_folder', {})]
        if n == 1: return [('find_files', {'pattern': '*.md'})]
        if n == 2:
            try: first = json.loads(tool_msgs[1]['content'])[0]['path']
            except Exception: first = ''
            return [('read_file', {'path': first})]
        if n == 3:
            body = '# Summary\n\nSummarised from the notes.'
            if '[EMAIL_1]' in txt: body += '\n\nContact: [EMAIL_1]'
            return [('write_file', {'path': 'reports/summary.md', 'content': body})]
        return None
    if 'AGENT-ATTACK' in txt:
        plan = [('read_file', {'path': 'C:\\Windows\\win.ini'}),
                ('read_file', {'path': root + '\\..\\outside.txt'}),
                ('read_file', {'path': root + '\\.env'}),
                ('list_folder', {'path': 'C:\\Users'}),
                ('write_file', {'path': '..\\evil.txt', 'content': 'x'}),
                ('write_file', {'path': 'C:\\evil.txt', 'content': 'x'}),
                ('write_file', {'path': 'run.bat', 'content': 'echo hi'}),
                ('write_file', {'path': 'notes.txt', 'content': 'this one needs approval'})]
        return [plan[n]] if n < len(plan) else None
    if 'AGENT-LONG' in txt:
        return [('list_folder', {})]
    if 'AGENT-PARALLEL' in txt:
        return [('current_datetime', {}), ('calculate', {'expression': '(1250*1.2)/4'})] if n == 0 else None
    return None
'''
    s = s.replace('class H(BaseHTTPRequestHandler):', helper + '\n\nclass H(BaseHTTPRequestHandler):', 1)

    old = "        msgs = body.get('messages', [])\n"
    new = r'''        msgs = body.get('messages', [])
        plan = agent_plan(msgs, bool(body.get('tools'))) if body.get('stream') else None
        is_agent = any('AGENT-' in (m.get('content') or '') for m in msgs if m.get('role') == 'user' and isinstance(m.get('content'), str))
        if body.get('stream') and is_agent:
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Transfer-Encoding', 'chunked')
            self.end_headers()

            def chunk(x):
                d = x.encode()
                self.wfile.write(('%x\r\n' % len(d)).encode() + d + b'\r\n')
                self.wfile.flush()
            if plan:
                for i, (name, args) in enumerate(plan):
                    a = json.dumps(args)
                    half = len(a) // 2
                    chunk('data: ' + json.dumps({'choices': [{'delta': {'tool_calls': [{'index': i, 'id': 'call_%d_%d' % (len(msgs), i), 'type': 'function', 'function': {'name': name, 'arguments': ''}}]}}]}) + '\n\n')
                    chunk('data: ' + json.dumps({'choices': [{'delta': {'tool_calls': [{'index': i, 'function': {'arguments': a[:half]}}]}}]}) + '\n\n')
                    chunk('data: ' + json.dumps({'choices': [{'delta': {'tool_calls': [{'index': i, 'function': {'arguments': a[half:]}}]}}]}) + '\n\n')
                chunk('data: ' + json.dumps({'choices': [{'delta': {}, 'finish_reason': 'tool_calls'}], 'usage': {'prompt_tokens': 200, 'completion_tokens': 30}}) + '\n\n')
            else:
                nt = sum(1 for m in msgs if m.get('role') == 'tool')
                final = 'AGENT-DONE after %d tool results.' % nt
                for w in final.split(' '):
                    chunk('data: ' + json.dumps({'choices': [{'delta': {'content': w + ' '}}]}) + '\n\n')
                chunk('data: ' + json.dumps({'choices': [{'delta': {}, 'finish_reason': 'stop'}], 'usage': {'prompt_tokens': 250, 'completion_tokens': 12}}) + '\n\n')
            chunk('data: [DONE]\n\n')
            self.wfile.write(b'0\r\n\r\n')
            return
'''
    assert old in s
    s = s.replace(old, new, 1)
    open(p, 'w', encoding='utf-8').write(s)
print('mock patched')
