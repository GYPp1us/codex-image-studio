#!/usr/bin/env bash
set -euo pipefail
APP=/opt/image-studio
DATA=/var/lib/image-studio
sudo mkdir -p "$APP/current" "$APP/runtime" "$DATA" /var/backups/image-studio
if ! test -x "$APP/runtime/node_modules/.bin/codex"; then
  sudo npm install --prefix "$APP/runtime" @openai/codex@0.164.0
fi
sudo python3 -m venv "$APP/venv"
DEPS="$APP/current/requirements.txt"
if test -s "$APP/current/requirements.lock.txt"; then
  DEPS="$APP/current/requirements.lock.txt"
fi
sudo "$APP/venv/bin/pip" install --disable-pip-version-check -r "$DEPS"
if ! sudo test -s "$DATA/setup-token"; then
  sudo python3 -c "import secrets,pathlib;pathlib.Path('$DATA/setup-token').write_text(secrets.token_urlsafe(24)+'\n')"
fi
sudo chown -R www-data:www-data "$DATA"
sudo chmod 700 "$DATA"
sudo chmod 600 "$DATA/setup-token"
sudo install -m 644 "$APP/current/deploy/image-studio.service" /etc/systemd/system/image-studio.service
sudo systemctl daemon-reload
sudo systemctl enable --now image-studio.service
sudo systemctl restart image-studio.service
sudo systemctl is-active image-studio.service
