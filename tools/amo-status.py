#!/usr/bin/env python3
"""Where the AMO listing stands: add-on status and each version's channel + review state.
Reads the same ~/.config/ownfeed/amo.env as sign.sh."""
import base64, hashlib, hmac, json, os, random, time, urllib.request

env = dict(l.strip().split('=', 1) for l in open(os.environ.get('OWNFEED_AMO_ENV', os.path.expanduser('~/.config/ownfeed/amo.env'))) if '=' in l)
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b'=')
now = int(time.time())
head = b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())
body = b64(json.dumps({'iss': env['WEB_EXT_API_KEY'], 'jti': str(random.random()), 'iat': now, 'exp': now + 60}).encode())
sig = b64(hmac.new(env['WEB_EXT_API_SECRET'].encode(), head + b'.' + body, hashlib.sha256).digest())
auth = {'Authorization': 'JWT ' + (head + b'.' + body + b'.' + sig).decode()}

def get(path):
    return json.load(urllib.request.urlopen(urllib.request.Request('https://addons.mozilla.org/api/v5/' + path, headers=auth)))

a = get('addons/addon/ownfeed@h-3303/')
print('add-on :', a['status'], '·', a['url'])
for v in get('addons/addon/ownfeed@h-3303/versions/?filter=all_with_unlisted')['results']:
    print(f"  {v['version']:8} {v['channel']:9} {v['file']['status']}")
