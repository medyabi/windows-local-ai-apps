"""Tiny OpenAI-compatible mock for testing HybridMind's cloud path. Logs every request body it receives to mock_log.jsonl.
Model names select behaviours: fail500, slow, filter, 404model."""
import json, re, sys, time, base64, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mock_log.jsonl')
PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
KEY = 'test-key-123'
NOAUTH = '--noauth' in sys.argv



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
        import time; time.sleep(0.6)
        return [('list_folder', {})]
    if 'AGENT-PARALLEL' in txt:
        return [('current_datetime', {}), ('calculate', {'expression': '(1250*1.2)/4'})] if n == 0 else None
    return None


class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path.endswith('/models'):
            return self._json(200, {'data': [{'id': 'mock-local-model'}, {'id': 'phi-4-mini-instruct-openvino-npu'}]})
        return self._json(404, {'error': {'message': 'not found'}})

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(n) or b'{}')
        auth = self.headers.get('Authorization', '') or ('Bearer ' + self.headers.get('api-key', ''))
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(json.dumps({'path': self.path, 'auth_ok': auth == 'Bearer ' + KEY, 'body': body}) + '\n')
        if auth != 'Bearer ' + KEY and not NOAUTH:
            return self._json(401, {'error': {'message': 'Incorrect API key provided'}})
        model = body.get('model', '') or self.path
        if '/deployments/' in self.path:
            ver = self.path.split('api-version=')[-1] if 'api-version=' in self.path else ''
            if ver not in ('2024-10-21', '2025-04-01-preview'):
                return self._json(400, {'error': {'code': 'BadRequest', 'message': 'API version not supported'}})
        if '/openai/v1/' in self.path and 'nov1' in model:
            return self._json(404, {'error': {'code': '404', 'message': 'Resource not found'}})
        if 'fail500' in model:
            return self._json(500, {'error': {'message': 'upstream exploded'}})
        if '404model' in model:
            return self._json(404, {'error': {'message': 'The model does not exist'}})
        if self.path.endswith('/images/generations'):
            return self._json(200, {'data': [{'b64_json': PNG}]})
        msgs = body.get('messages', [])
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
        last = msgs[-1]['content'] if msgs else ''
        if isinstance(last, list):
            last = ' '.join(p.get('text', '') for p in last if p.get('type') == 'text') + ' [+%d image]' % sum(1 for p in last if p.get('type') == 'image_url')
        ph = re.findall(r'\[[A-Z_]+_\d+\]', last)
        text = 'CLOUD-REPLY (%d msgs). You wrote: %s' % (len(msgs), last[-160:].replace('\n', ' '))
        if ph:
            text += ' | I saw placeholders: ' + ' '.join(ph)
        if not body.get('stream') and body.get('tools') and 'calculate tool' in json.dumps(msgs):
            return self._json(200, {'choices': [{'message': {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'c1', 'type': 'function', 'function': {'name': 'calculate', 'arguments': '{"expression":"17*23"}'}}]}}]})
        if not body.get('stream'):
            return self._json(200, {'choices': [{'message': {'role': 'assistant', 'content': 'OK'}}]})
        if 'slow' in model:
            time.sleep(3)
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Transfer-Encoding', 'chunked')
        self.end_headers()

        def chunk(s):
            d = s.encode()
            self.wfile.write(('%x\r\n' % len(d)).encode() + d + b'\r\n')
            self.wfile.flush()

        words = text.split(' ')
        for i in range(0, len(words), 3):
            chunk('data: ' + json.dumps({'choices': [{'delta': {'content': ' '.join(words[i:i + 3]) + ' '}}]}) + '\n\n')
            time.sleep(0.03)
        fr = 'content_filter' if 'filter' in model else 'stop'
        chunk('data: ' + json.dumps({'choices': [{'delta': {}, 'finish_reason': fr}], 'usage': {'prompt_tokens': 123, 'completion_tokens': 45}}) + '\n\n')
        chunk('data: [DONE]\n\n')
        self.wfile.write(b'0\r\n\r\n')


if __name__ == '__main__':
    open(LOG, 'w').close()
    ThreadingHTTPServer(('127.0.0.1', int([a for a in sys.argv[1:] if a.isdigit()][0]) if [a for a in sys.argv[1:] if a.isdigit()] else 8790), H).serve_forever()
