#!/usr/bin/env python3
"""wda.py - drive a real iPhone or iPad through WebDriverAgent (no dependencies).

WDA runs on each device as a long-lived `xcodebuild ... test` in tmux (`wda-claudia` for my iPhone,
`wda-ipad` for my iPad; see the driving-test-devices skill), reachable over Tailscale on port 8100.
Coordinates are POINTS (screenshot pixels / scale: 3 on iPhone 15, 2 on the iPad).

Pick the device with WDA_DEVICE=iphone|ipad (default iphone) or WDA_HOST=http://host:8100.

  wda.py status                     is WDA up?
  wda.py shot <out.png>             screenshot (no automation banner, unlike devicectl's)
  wda.py tree [regex]               elements (type, label, frame) whose label matches
  wda.py tap <x> <y>                tap a point
  wda.py hold <x> <y> [ms]          press and hold (default 150 ms): alert buttons, Pressables in ScrollViews
  wda.py taplabel <label> [type]    tap the centre of the highest element with that exact label
  wda.py type <text>                type into the focused field
  wda.py swipe <x1> <y1> <x2> <y2>  drag
  wda.py launch <bundle-id>         bring an app to the front
  wda.py rotate <portrait|landscape> turn the INTERFACE (the device stays physically where it is)
"""
import base64, json, os, re, sys, urllib.request

DEVICES = {
    'iphone': 'http://claudias-iphone-15:8100',
    'ipad': 'http://claudias-ipad:8100',
}
HOST = os.environ.get('WDA_HOST') or DEVICES[os.environ.get('WDA_DEVICE', 'iphone')]
# One session per host, kept out of the skill directory.
SESSION_FILE = os.path.join(
    os.path.expanduser('~/.cache/wda'), re.sub(r'[^A-Za-z0-9]+', '_', HOST) + '.session'
)


def call(method, path, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(HOST + path, data=data, method=method, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b'{}')


def session():
    if os.path.exists(SESSION_FILE):
        sid = open(SESSION_FILE).read().strip()
        try:
            call('GET', f'/session/{sid}')
            return sid
        except Exception:
            pass
    sid = call('POST', '/session', {'capabilities': {'alwaysMatch': {}}})['sessionId']
    os.makedirs(os.path.dirname(SESSION_FILE), exist_ok=True)
    open(SESSION_FILE, 'w').write(sid)
    return sid


def pointer(actions):
    call('POST', f'/session/{session()}/actions', {'actions': [{'type': 'pointer', 'id': 'finger', 'parameters': {'pointerType': 'touch'}, 'actions': actions}]})


def tap(x, y):
    pointer([{'type': 'pointerMove', 'duration': 0, 'x': x, 'y': y}, {'type': 'pointerDown'}, {'type': 'pause', 'duration': 80}, {'type': 'pointerUp'}])


def elements():
    tree = call('GET', '/source?format=json', timeout=90)['value']
    out = []

    def walk(n):
        r = n.get('rect') or {}
        out.append({'type': n.get('type'), 'label': (n.get('label') or n.get('name') or '').strip(), 'rect': r})
        for c in n.get('children') or []:
            walk(c)

    walk(tree)
    return out


def main(argv):
    cmd = argv[0] if argv else 'status'
    if cmd == 'status':
        v = call('GET', '/status')['value']
        print('WDA', v['build']['version'], 'iOS', v['os']['version'], 'ready' if v.get('ready', True) else 'not ready')
    elif cmd == 'shot':
        png = base64.b64decode(call('GET', '/screenshot')['value'])
        open(argv[1], 'wb').write(png)
        print('saved', argv[1])
    elif cmd == 'tree':
        pat = re.compile(argv[1]) if len(argv) > 1 else None
        for e in elements():
            if e['label'] and (pat is None or pat.search(e['label'])):
                r = e['rect']
                print(f"{e['type']:24} {e['label'][:40]:40} x {r.get('x')} y {r.get('y')}..{r.get('y', 0) + r.get('height', 0)}")
    elif cmd == 'tap':
        tap(float(argv[1]), float(argv[2]))
        print('tapped', argv[1], argv[2])
    elif cmd == 'hold':
        x, y = float(argv[1]), float(argv[2])
        ms = int(argv[3]) if len(argv) > 3 else 150
        pointer([{'type': 'pointerMove', 'duration': 0, 'x': x, 'y': y}, {'type': 'pointerDown'}, {'type': 'pause', 'duration': ms}, {'type': 'pointerUp'}])
        print('held', argv[1], argv[2], ms, 'ms')
    elif cmd == 'taplabel':
        kind = argv[2] if len(argv) > 2 else None
        hits = [e for e in elements() if e['label'] == argv[1] and (kind is None or e['type'] == kind) and e['rect'].get('height', 0) > 4]
        if not hits:
            sys.exit(f'no element labelled {argv[1]!r}')
        r = min(hits, key=lambda e: e['rect']['y'])['rect']
        tap(r['x'] + r['width'] / 2, r['y'] + r['height'] / 2)
        print('tapped', argv[1], round(r['x'] + r['width'] / 2), round(r['y'] + r['height'] / 2))
    elif cmd == 'type':
        call('POST', f'/session/{session()}/wda/keys', {'value': list(' '.join(argv[1:]))})
        print('typed')
    elif cmd == 'swipe':
        x1, y1, x2, y2 = map(float, argv[1:5])
        pointer([{'type': 'pointerMove', 'duration': 0, 'x': x1, 'y': y1}, {'type': 'pointerDown'}, {'type': 'pointerMove', 'duration': 300, 'x': x2, 'y': y2}, {'type': 'pointerUp'}])
        print('swiped')
    elif cmd == 'launch':
        call('POST', f'/session/{session()}/wda/apps/launch', {'bundleId': argv[1]})
        print('launched', argv[1])
    elif cmd == 'rotate':
        orientation = {'portrait': 'PORTRAIT', 'landscape': 'LANDSCAPE'}[argv[1]]
        call('POST', f'/session/{session()}/orientation', {'orientation': orientation})
        print('rotated', argv[1])
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
