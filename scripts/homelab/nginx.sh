#!/usr/bin/env bash
SCRIPT_NAME=homelab-nginx
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/lib.sh"
require_command nginx
require_command sudo
require_command curl

host=$(homelab_host) || exit 1
site=/etc/nginx/sites-available/homelab
enabled=/etc/nginx/sites-enabled/homelab
template="$ROOT/scripts/homelab/nginx.conf"
rendered="$RUN_DIR/homelab/nginx.conf"

mkdir -p "$(dirname "$rendered")" || die "cannot create $(dirname "$rendered")"
sed -e "s/@HOST@/$host/" -e "s/@HOMELAB_PORT@/$HOMELAB_PORT/" "$template" >"$rendered" || die "cannot render $template"

log "installing $site for $host"
sudo install -m 644 "$rendered" "$site" || die "cannot install $site"
sudo ln -sfn "$site" "$enabled" || die "cannot enable $site"
sudo nginx -t || die "nginx -t failed. Fix the reported site, then rerun"
sudo systemctl enable nginx || die "cannot enable nginx"
sudo systemctl reload-or-restart nginx || die "nginx did not start. Read journalctl -u nginx"

status=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $host" http://127.0.0.1/)
[ "$status" = "200" ] || die "http://127.0.0.1/ for $host answers $status, not 200"
log "nginx serves $host on 127.0.0.1:80"
