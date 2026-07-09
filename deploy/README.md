# Running the daemon

The daemon serves the API + web UI and must run on the host (not in a
container) so it can spawn Windows terminals for the launch action.

## systemd user service (preferred, when available)

```bash
mkdir -p ~/.config/systemd/user
cp deploy/aylith-tickets.service ~/.config/systemd/user/
loginctl enable-linger "$USER"          # start at boot without a login session
systemctl --user daemon-reload
systemctl --user enable --now aylith-tickets
systemctl --user status aylith-tickets
```

On some WSL setups the per-user systemd/dbus session is unavailable
(`systemctl --user` reports "Failed to connect to bus" and `enable-linger`
fails). Use the fallback below there.

## Fallback: background process

```bash
make serve-bg     # nohup + pidfile, logs to daemon.log
make stop
```

To survive a WSL restart without user-systemd, add a Windows Task Scheduler
task at logon that runs:

```
wsl.exe -d Ubuntu -- bash -lc "cd ~/projects/aylith-labs/tickets && make serve-bg"
```

## Reverse proxy

`~/.config/local-proxy/routes.yaml` routes `tickets.lvh.me` to the daemon:

```yaml
routes:
  - host: tickets.lvh.me
    target: http://host.wsl.internal:<port>
```
