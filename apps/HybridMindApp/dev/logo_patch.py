p = r'C:\Users\MohamedDYABI\HybridMindApp\www\index.html'
s = open(p, encoding='utf-8').read()
a = s.index('    <symbol id="logo" viewBox="0 0 64 64">')
b = s.index('</symbol>', a) + len('</symbol>')
new = '''    <linearGradient id="lgc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5ad2f5"/><stop offset="1" stop-color="#3c82f0"/></linearGradient>
    <linearGradient id="lgv" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a08cff"/><stop offset="1" stop-color="#6e5aeb"/></linearGradient>
    <symbol id="logo" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="16" fill="#12162a"/>
      <path d="M27 16a9.5 9.5 0 0 1 17.6-3.4A8.4 8.4 0 0 1 49 28.5H31a7.5 7.5 0 0 1-4-13.7z" fill="url(#lgc)" transform="translate(2 6)"/>
      <rect x="9" y="29" width="28" height="28" rx="6" fill="#12162a"/>
      <g fill="#c8beff"><rect x="15" y="26" width="2.4" height="5" rx="1"/><rect x="22" y="26" width="2.4" height="5" rx="1"/><rect x="29" y="26" width="2.4" height="5" rx="1"/><rect x="15" y="55" width="2.4" height="5" rx="1"/><rect x="22" y="55" width="2.4" height="5" rx="1"/><rect x="29" y="55" width="2.4" height="5" rx="1"/><rect x="6" y="36" width="5" height="2.4" rx="1"/><rect x="6" y="43" width="5" height="2.4" rx="1"/><rect x="6" y="50" width="5" height="2.4" rx="1"/><rect x="35" y="36" width="5" height="2.4" rx="1"/><rect x="35" y="43" width="5" height="2.4" rx="1"/><rect x="35" y="50" width="5" height="2.4" rx="1"/></g>
      <rect x="11" y="31" width="24" height="24" rx="5" fill="url(#lgv)"/>
      <path d="M23 36.2l1.7 4.1 4.1 1.7-4.1 1.7L23 47.8l-1.7-4.1-4.1-1.7 4.1-1.7z" fill="#12162a"/>
    </symbol>'''
s = s[:a] + new + s[b:]
open(p, 'w', encoding='utf-8').write(s)
print('logo updated')
