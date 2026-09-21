#!/bin/sh
# Submit the current version to addons.mozilla.org and fetch the signed .xpi.
#   tools/sign.sh unlisted   signed file for self-distribution, nothing appears on the AMO site
#   tools/sign.sh listed     public listing on AMO (uses amo-metadata.json), goes through review
# Credentials come from ~/.config/ownfeed/amo.env (never the repo):
#   WEB_EXT_API_KEY=user:12345:67
#   WEB_EXT_API_SECRET=…
# Generate them at https://addons.mozilla.org/developers/addon/api/key/
set -eu
channel="${1:-unlisted}"
env_file="${OWNFEED_AMO_ENV:-$HOME/.config/ownfeed/amo.env}"
[ -r "$env_file" ] || { echo "missing $env_file (see the header of this script)" >&2; exit 1; }
set -a; . "$env_file"; set +a
cd "$(dirname "$0")/.."
meta=""; [ "$channel" = listed ] && meta="--amo-metadata amo-metadata.json"
exec web-ext sign --channel "$channel" $meta \
  --ignore-files test site tools package.json vercel.json amo-metadata.json README.md LICENSE
