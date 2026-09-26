"""
style_mobile.css에서 파피루스·골드 하드코딩 색을 쓰는 '다크가 아닌' 규칙을 찾아
html[data-theme="light"] 로 범위를 좁힌 덮어쓰기 규칙을 만든다. 원본은 건드리지 않는다(다크 보호).
출력: 덮어쓰기 CSS 문자열(표준출력) + 통계(표준에러)
"""
import io, re, sys
SRC = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\jjang\Desktop\SJ아카이브\1. 아카이브_mobile\public\css\style_mobile.css'
css = io.open(SRC, encoding='utf-8').read()
MARK = '/* ══ LIGHT-INDIGO-OVERRIDES ══ */'
if MARK in css:
    css = css[:css.index(MARK)]           # 재실행 시 이전 생성분 제외
css_nc = re.sub(r'/\*.*?\*/', '', css, flags=re.S)

HEX = {
    '9A6F1B': '#5B5BD6', 'C5A059': '#8E7CE6', 'F4ECD8': '#F3F3FA', 'E5D3B8': '#E6E6EE',
    'FDFBF7': '#FFFFFF', 'F4F0EA': '#FAFAFA', 'FBF8F2': '#FFFFFF', 'F4EFE6': '#F4F3FB',
    'F9F6EE': '#FAFAFC', 'E3DBCB': '#EFEFEF', '5A4A32': '#737373', '8A7A62': '#A8A8A8',
    '16110A': '#262626', 'B8860B': '#5B5BD6', 'E2B65B': '#5B5BD6',
}
RGBA = {  # 골드 계열 반투명
    (154, 111, 27): '91,91,214', (197, 160, 89): '142,124,230', (212, 175, 55): '142,124,230',
    (226, 182, 91): '142,124,230',
}
hex_re = re.compile(r'#(' + '|'.join(HEX) + r')\b', re.I)
rgba_re = re.compile(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(,\s*[\d.]+\s*)?\)')

def recolor(val):
    changed = False
    def h(m):
        nonlocal changed; changed = True; return HEX[m.group(1).upper()]
    v = hex_re.sub(h, val)
    def r(m):
        nonlocal changed
        key = tuple(int(m.group(i)) for i in (1, 2, 3))
        if key not in RGBA: return m.group(0)
        changed = True
        alpha = m.group(4) or ''
        return f'rgba({RGBA[key]}{alpha})' if alpha else f'rgb({RGBA[key]})'
    v = rgba_re.sub(r, v)
    return v, changed

SKIP = ('.aep-', '.app-entrance', '.mode-card')   # 진입 스플래시는 항상 남색 배경의 브랜드 화면 — 골드 유지
def light_selector(sel):
    if any(k in sel for k in SKIP): return None
    out = []
    for part in sel.split(','):
        p = part.strip()
        if not p: continue
        if 'data-theme="dark"' in p or "data-theme='dark'" in p: return None
        if 'data-theme="light"' in p: out.append(p); continue
        if p == ':root' or p == 'html': out.append('html[data-theme="light"]'); continue
        if p.startswith('html'): out.append('html[data-theme="light"]' + p[4:]); continue
        out.append('html[data-theme="light"] ' + p)
    return ', '.join(out) if out else None

def parse(block, ctx, emit):
    i, n = 0, len(block)
    while i < n:
        j = block.find('{', i)
        if j < 0: break
        head = block[i:j].strip()
        # 짝 맞는 닫는 중괄호 찾기
        depth, k = 1, j + 1
        while k < n and depth:
            if block[k] == '{': depth += 1
            elif block[k] == '}': depth -= 1
            k += 1
        body = block[j + 1:k - 1]
        i = k
        if head.startswith('@media') or head.startswith('@supports'):
            if 'prefers-color-scheme' in head and 'dark' in head:   # 다크 미디어 블록은 건너뜀
                continue
            parse(body, ctx + [head], emit)
            continue
        if head.startswith('@'):   # @keyframes 등 — 색이 있어도 테마 분리 불가, 건너뜀
            continue
        sel = light_selector(head)
        if not sel: continue
        decls = []
        for d in body.split(';'):
            if ':' not in d or 'url(' in d: continue
            prop, val = d.split(':', 1)
            nv, ch = recolor(val)
            if ch: decls.append(f'{prop.strip()}:{nv.strip()}')
        if decls:
            emit(ctx, sel, decls)

rules = []
parse(css_nc, [], lambda ctx, sel, decls: rules.append((ctx, sel, decls)))

out = [MARK,
       '/* 라이트 테마를 연대기와 같은 톤(흰 바탕·인디고 포인트)으로 — 파피루스·골드 하드코딩 색의 라이트 전용 덮어쓰기.',
       '   scripts/gen_light_overrides.py 로 생성. 원본 규칙은 그대로 두어 다크에 영향 없음. */']
for ctx, sel, decls in rules:
    rule = f'{sel} {{ ' + '; '.join(decls) + '; }'
    for c in reversed(ctx):
        rule = f'{c} {{ {rule} }}'
    out.append(rule)
sys.stdout.reconfigure(encoding='utf-8')
print('\n'.join(out))
print(f'[생성] 덮어쓰기 규칙 {len(rules)}개', file=sys.stderr)
