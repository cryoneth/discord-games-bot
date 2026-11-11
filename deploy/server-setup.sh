#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu server. Run as root:
#   ssh root@SERVER 'bash -s' < deploy/server-setup.sh
# Safe to re-run.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "==> Installing Docker (official repository)"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git >/dev/null
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
systemctl enable --now docker >/dev/null 2>&1
docker --version

echo "==> Firewall: allow SSH, HTTP, HTTPS only"
ufw allow 22/tcp >/dev/null      # SSH first, so you can't lock yourself out
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status

echo "==> Read-only deploy key for the GitHub repo"
if [ ! -f /root/.ssh/discord_games_deploy ]; then
  ssh-keygen -t ed25519 -N "" -C "discord-games-bot deploy (read-only)" -f /root/.ssh/discord_games_deploy -q
fi
grep -q "Host github-discord-games" /root/.ssh/config 2>/dev/null || cat >> /root/.ssh/config <<'EOF'
Host github-discord-games
  HostName github.com
  User git
  IdentityFile /root/.ssh/discord_games_deploy
  IdentitiesOnly yes
EOF
ssh-keyscan -q github.com >> /root/.ssh/known_hosts 2>/dev/null || echo "(ssh-keyscan failed; git will accept the GitHub host key on first clone)"
echo "DEPLOY_PUBLIC_KEY: $(cat /root/.ssh/discord_games_deploy.pub)"
