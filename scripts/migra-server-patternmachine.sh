#!/usr/bin/env bash
# Trasloco una tantum sul Server HP: Drum Machine Lab -> PatternMachine (2026-09-25).
# Si lancia dal Mac, chiede la password sudo sul server:
#   ssh -t hp-ubuntu 'sudo bash -s' < scripts/migra-server-patternmachine.sh
#
# 1. record DNS patternmachine.tongatron.org -> tunnel Cloudflare (come giovanni, che ha cert.pem)
# 2. ferma drummachine, sposta /srv/apps/drummachine(-backups) in /srv/apps/patternmachine(-backups)
# 3. nuovo servizio systemd "patternmachine" (stessa porta 8095), il vecchio viene disattivato
# 4. tunnel: aggiunge patternmachine.tongatron.org; drummachine.tongatron.org resta per il trasloco dei dati
# Ogni passo gia' fatto viene saltato, quindi si puo' rilanciare.
set -euo pipefail
OLD=/srv/apps/drummachine NEW=/srv/apps/patternmachine
CFG=/etc/cloudflared/config.yml
HOSTNAME_NEW=patternmachine.tongatron.org

echo "== DNS"
tunnel=$(sed -n 's/^tunnel: *//p' "$CFG")
sudo -u giovanni -H cloudflared tunnel route dns "$tunnel" "$HOSTNAME_NEW" 2>&1 | tail -1 || true

echo "== cartelle"
if [ -d "$OLD" ] && [ ! -e "$NEW" ]; then
  systemctl stop drummachine || true
  mv "$OLD" "$NEW"
  if [ -d "$OLD-backups" ] && [ ! -e "$NEW-backups" ]; then mv "$OLD-backups" "$NEW-backups"; fi
fi
ls -ld "$NEW" "$NEW-backups"

echo "== servizio"
if [ ! -f /etc/systemd/system/patternmachine.service ]; then
  sed -e "s#$OLD#$NEW#g" \
      -e 's#^Description=.*#Description=PatternMachine (drum machine a step, patternmachine.tongatron.org)#' \
      /etc/systemd/system/drummachine.service > /etc/systemd/system/patternmachine.service
fi
if [ -f /etc/systemd/system/drummachine.service ]; then
  systemctl disable --now drummachine || true
  mv /etc/systemd/system/drummachine.service /etc/systemd/system/drummachine.service.disattivato
fi
systemctl daemon-reload
systemctl enable patternmachine
systemctl restart patternmachine

echo "== tunnel"
if ! grep -q "hostname: $HOSTNAME_NEW" "$CFG"; then
  cp -a "$CFG" "$CFG.bak-patternmachine-$(date +%Y%m%d%H%M%S)"
  sed -i "s#^  - hostname: drummachine.tongatron.org#  - hostname: $HOSTNAME_NEW\n    service: http://127.0.0.1:8095\n  - hostname: drummachine.tongatron.org#" "$CFG"
  cloudflared --config "$CFG" tunnel ingress validate
  systemctl restart cloudflared
fi

echo "== verifica"
sleep 3
systemctl is-active patternmachine cloudflared
curl -s -o /dev/null -w "locale: %{http_code}\n" http://127.0.0.1:8095/login
echo "fatto"
