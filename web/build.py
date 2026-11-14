#!/usr/bin/env python3
"""Assemble the md-whatever web reader into one self-contained HTML file.

    web/build.py --wasm engine.wasm --asm engine.wasm2js.mjs --out md-whatever.html [--asm-out engine.asm.js]

--wasm     the engine compiled to WebAssembly (web/engine.cpp + markdown.cpp + md4c)
--asm      wasm2js's translation of the same module (the JavaScript fallback)
--asm-out  also write the fallback as inlined in the page, for tests/web

Everything else comes from the repository: the page and its code in web/,
themes from src/themes and examples/themes, sample documents from
tests/fixtures and README.md. Standard library only.
"""
import argparse
import base64
import json
import mimetypes
import re
import subprocess
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent
REPO = WEB.parent

BUILTIN_THEMES = ['base', 'default', 'paper']  # src/themes; base is not offered in the menu
SAMPLES = {  # name shown in the page -> file in the repo
    'welcome.md': WEB / 'samples' / 'welcome.md',
    'kitchen-sink.md': REPO / 'tests' / 'fixtures' / 'kitchen-sink.md',
    'math.md': REPO / 'tests' / 'fixtures' / 'math.md',
    'README.md': REPO / 'README.md',
}
ASSET_DIR = REPO / 'tests' / 'fixtures'  # images the samples use, by path relative to here
ASSETS = ['images/diagram.svg', 'images/wide.png']


def fail(msg):
    sys.exit(f'web/build.py: {msg}')


def read(path):
    try:
        return Path(path).read_text(encoding='utf-8')
    except OSError as e:
        fail(f'cannot read {path}: {e.strerror}')


def commit_id():
    try:
        out = subprocess.run(['git', '-C', str(REPO), 'describe', '--always', '--dirty', '--abbrev=12'],
                             capture_output=True, text=True, check=True)
        return out.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return 'unknown'


def data_block():
    themes = {name: read(REPO / 'src' / 'themes' / f'{name}.css') for name in BUILTIN_THEMES}
    for css in sorted((REPO / 'examples' / 'themes').glob('*.css')):
        if css.stem in themes:
            fail(f'example theme {css.name} has the same name as a built-in theme')
        themes[css.stem] = read(css)
    assets = {}
    for rel in ASSETS:
        mime = mimetypes.guess_type(rel)[0] or fail(f'unknown image type: {rel}')
        raw = (ASSET_DIR / rel).read_bytes()
        assets[rel] = f'data:{mime};base64,' + base64.b64encode(raw).decode('ascii')
    data = {
        'themes': themes,
        'viewerCss': read(WEB / 'viewer.css'),
        'samples': {name: read(path) for name, path in SAMPLES.items()},
        'assets': assets,
    }
    # Inside <script type="application/json">, "<" must not appear raw ("</script>",
    # "<!--" would end or confuse the element). < is the same character to JSON.parse.
    return json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')


WASM2JS_IMPORT = "import * as wasi_snapshot_preview1 from 'wasi_snapshot_preview1';"
WASM2JS_INSTANCE = 'var retasmFunc = asmFunc({'


def wrap_asm(js):
    """Turn wasm2js output (an ES module) into a plain script defining
    `function mdwAsmEngine()`, which returns a fresh instance's exports.

    wasm2js writes: the import line, helper code and `function asmFunc(imports)`,
    then `var retasmFunc = asmFunc({...});` and one `export var` per export.
    Anything else means its format changed, so fail rather than guess.
    """
    lines = js.rstrip('\n').split('\n')
    if lines[0] != WASM2JS_IMPORT:
        fail(f'unexpected wasm2js output: first line is not {WASM2JS_IMPORT!r}')
    try:
        end = lines.index(WASM2JS_INSTANCE)
    except ValueError:
        fail(f'unexpected wasm2js output: no {WASM2JS_INSTANCE!r} line')
    tail = lines[end:]
    if [line.strip() for line in tail[1:3]] != ['"wasi_snapshot_preview1": wasi_snapshot_preview1,', '});'] \
            or not all(line.startswith('export var ') for line in tail[3:]):
        fail('unexpected wasm2js output after asmFunc()')
    body = lines[1:end]
    if any('`' in line or line.endswith('\\') or re.match(r'\s*(import|export)\b', line) for line in body):
        fail('unexpected wasm2js output: template literal, continued line, or import/export inside')
    # Indentation is a third of the size. Lines are kept whole, so no token or
    # string changes; without template literals or continued lines no string
    # spans lines either.
    body = [line.strip() for line in body if line.strip()]
    return '\n'.join([
        '// md-whatever\'s engine as plain JavaScript (wasm2js), for browsers that block WebAssembly.',
        'function mdwAsmEngine() {',
        '// The same no-op WASI stubs as the WebAssembly build: the engine does no I/O.',
        'var wasi_snapshot_preview1 = { fd_close: () => 0, fd_seek: () => 0, fd_write: () => 0 };',
        *body,
        'return asmFunc({ wasi_snapshot_preview1: wasi_snapshot_preview1 });',
        '}',
    ]) + '\n'


def script_safe(name, js):
    if re.search(r'</script', js, re.IGNORECASE):
        fail(f'{name} contains "</script", which would end its <script> element early')
    return js


def md4c_version():
    cmake = read(WEB / 'CMakeLists.txt')
    m = re.search(r'set\(MD4C_WEB_VERSION\s+([\w.]+)\)', cmake)
    return m.group(1) if m else 'unknown'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--wasm', required=True, type=Path)
    ap.add_argument('--asm', required=True, type=Path)
    ap.add_argument('--out', required=True, type=Path)
    ap.add_argument('--asm-out', type=Path)
    args = ap.parse_args()

    wasm = args.wasm.read_bytes()
    if wasm[:4] != b'\0asm':
        fail(f'{args.wasm} is not a WebAssembly module')

    asm = script_safe('the JavaScript engine', wrap_asm(read(args.asm)))
    if args.asm_out:
        args.asm_out.parent.mkdir(parents=True, exist_ok=True)
        args.asm_out.write_text(asm, encoding='utf-8')

    parts = {
        'COMMIT': commit_id(),
        'MD4C_VERSION': md4c_version(),
        'READER_CSS': read(WEB / 'reader.css').rstrip('\n'),
        'DATA': data_block(),
        'WASM': base64.b64encode(wasm).decode('ascii'),
        'ASM_ENGINE': asm.rstrip('\n'),
        'LIB_JS': script_safe('web/lib.js', read(WEB / 'lib.js')).rstrip('\n'),
        'READER_JS': script_safe('web/reader.js', read(WEB / 'reader.js')).rstrip('\n'),
    }
    template = read(WEB / 'reader.html')
    found = set(re.findall(r'@@([A-Z0-9_]+)@@', template))
    if found != set(parts):
        missing, unknown = set(parts) - found, found - set(parts)
        fail('web/reader.html placeholders do not match: '
             + '; '.join(filter(None, [missing and f'missing {sorted(missing)}', unknown and f'unknown {sorted(unknown)}'])))
    # One pass over the template, so text inside an inserted part is never substituted.
    page = re.sub(r'@@([A-Z0-9_]+)@@', lambda m: parts[m.group(1)], template)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(page, encoding='utf-8')
    print(f'web/build.py: wrote {args.out} ({len(page.encode()) // 1024} KB)')


if __name__ == '__main__':
    main()
