; Template — scripts/setup-server.sh substitutes the __PLACEHOLDER__ tokens and
; installs the result as /etc/systemd/system/humboldt-upload.service.
[Unit]
Description=Humboldt image upload service
Documentation=https://github.com/SirVerzweiflung/Humboldt
After=network.target

[Service]
Type=simple
User=__USER__
Group=__USER__
WorkingDirectory=__APP_DIR__/repo
EnvironmentFile=/etc/humboldt/upload.env
ExecStart=/usr/bin/env node server/upload/index.mjs
Restart=on-failure
RestartSec=2

; The service writes uploaded images and nothing else, so give it nothing else.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6
ReadWritePaths=__UPLOAD_DIR__

[Install]
WantedBy=multi-user.target
