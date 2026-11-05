import os
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mock_openai.py')
s = open(p, encoding='utf-8').read()
if 'NOAUTH' not in s:
    s = s.replace("KEY = 'test-key-123'", "KEY = 'test-key-123'\nNOAUTH = '--noauth' in sys.argv", 1)
    s = s.replace("        if auth != 'Bearer ' + KEY:\n            return self._json(401", "        if auth != 'Bearer ' + KEY and not NOAUTH:\n            return self._json(401", 1)
    # GET /models
    s = s.replace("    def do_POST(self):", """    def do_GET(self):
        if self.path.endswith('/models'):
            return self._json(200, {'data': [{'id': 'mock-local-model'}, {'id': 'phi-4-mini-instruct-openvino-npu'}]})
        return self._json(404, {'error': {'message': 'not found'}})

    def do_POST(self):""", 1)
    # tool-calling probe (non-stream request with tools)
    s = s.replace("        if not body.get('stream'):\n            return self._json(200, {'choices': [{'message': {'role': 'assistant', 'content': 'OK'}}]})",
                  """        if not body.get('stream') and body.get('tools') and 'calculate tool' in json.dumps(msgs):
            return self._json(200, {'choices': [{'message': {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'c1', 'type': 'function', 'function': {'name': 'calculate', 'arguments': '{"expression":"17*23"}'}}]}}]})
        if not body.get('stream'):
            return self._json(200, {'choices': [{'message': {'role': 'assistant', 'content': 'OK'}}]})""", 1)
    s = s.replace("ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8790), H)", "ThreadingHTTPServer(('127.0.0.1', int([a for a in sys.argv[1:] if a.isdigit()][0]) if [a for a in sys.argv[1:] if a.isdigit()] else 8790), H)", 1)
    open(p, 'w', encoding='utf-8').write(s)
print('mock local patched')
