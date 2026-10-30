#!/usr/bin/env bash
# CotizÁgil · robot en la nube 24/7 (Ubuntu 22.04 / 24.04, como root)
#   curl -fsSL https://cotizagil.netlify.app/nube/instalar.sh | bash      (pide permiso: lo apruebas en la app)
#   curl -fsSL https://cotizagil.netlify.app/nube/instalar.sh | bash -s -- TU_CODIGO   (directo)
# Qué hace: instala el robot, una pantalla virtual con vista remota protegida (HTTPS + clave),
# lo deja encendido siempre (se reinicia solo si se cae o si se reinicia el servidor) y se
# actualiza solo cuando el PC sube una versión nueva. Se puede volver a correr sin problema.
set -euo pipefail
principal() {

TOKEN="${1:-${COTIZAGIL_TOKEN:-}}"
NUBE="${COTIZAGIL_URL:-https://cotizagil.netlify.app}"
DIR=/opt/cotizagil
APP="$DIR/robot"
USR=robot

[ "$(id -u)" = 0 ] || { echo "Corre esto como root (o con sudo)."; exit 1; }
paso() { echo; echo "==> $*"; }
if [ -z "$TOKEN" ]; then
  # sin código: el servidor pide permiso y el dueño lo aprueba con un toque en la app (💎 Planes → Robot en la nube)
  paso "0/8 Pidiendo permiso a CotizÁgil (apruébalo en tu celular)"
  SOL=$(curl -fsS -X POST "$NUBE/bot/nube-pedir?nombre=$(hostname)")
  ID=$(echo "$SOL" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
  echo "   Solicitud enviada desde la IP $(echo "$SOL" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("ip",""))'). Esperando tu aprobación…"
  for _ in $(seq 1 720); do
    R=$(curl -fsS "$NUBE/bot/nube-pedir?id=$ID" || echo '{}')
    EST=$(echo "$R" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("estado",""))' 2>/dev/null || true)
    if [ "$EST" = aprobado ]; then TOKEN=$(echo "$R" | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])'); break; fi
    if [ "$EST" = rechazado ] || [ "$EST" = no_existe ]; then echo "   Solicitud $EST."; exit 1; fi
    sleep 10
  done
  [ -n "$TOKEN" ] || { echo "   No llegó la aprobación en 2 horas. Vuelve a correr el comando."; exit 1; }
  echo "   ✅ Aprobado"
fi
export DEBIAN_FRONTEND=noninteractive

paso "1/8 Sistema y zona horaria de Chile"
timedatectl set-timezone America/Santiago 2>/dev/null || ln -sf /usr/share/zoneinfo/America/Santiago /etc/localtime
hostnamectl set-hostname cotizagil-nube 2>/dev/null || true
if [ "$(free -m | awk '/Mem:/{print $2}')" -lt 3500 ] && ! swapon --show | grep -q /swapfile; then
  fallocate -l 3G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

paso "2/8 Programas (navegador, pantalla virtual, vista remota, Office, OCR)"
apt-get update -q
apt-get install -y -q python3 python3-venv python3-pip curl unzip ca-certificates debian-keyring debian-archive-keyring apt-transport-https gnupg \
  xvfb x11vnc novnc websockify openbox tesseract-ocr tesseract-ocr-spa \
  fonts-dejavu fonts-liberation fonts-noto-color-emoji ufw >/dev/null
apt-get install -y -q --no-install-recommends libreoffice-writer-nogui >/dev/null 2>&1 || apt-get install -y -q --no-install-recommends libreoffice-writer >/dev/null
if ! command -v caddy >/dev/null; then
  apt-get install -y -q caddy >/dev/null 2>&1 || {
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -q && apt-get install -y -q caddy >/dev/null; }
fi

paso "3/8 Usuario del robot"
id -u $USR >/dev/null 2>&1 || useradd -r -m -d "$DIR" -s /bin/bash $USR
mkdir -p "$APP" && chown -R $USR:$USR "$DIR"

paso "4/8 Descargando tu robot desde CotizÁgil"
TMP=$(mktemp -d)
code=$(curl -sS -o "$TMP/p.zip" -w '%{http_code}' -H "x-robot-token: $TOKEN" "$NUBE/bot/paquete")
if [ "$code" = 200 ]; then
  unzip -oq "$TMP/p.zip" -d "$APP"
elif [ -f "$APP/conector_nube.py" ]; then
  echo "   (no hay paquete nuevo: uso el robot que ya estaba instalado)"
else
  echo "   No hay paquete ($code). En el PC haz doble clic en SUBIR_A_LA_NUBE y vuelve a correr este comando."; exit 1
fi
rm -rf "$TMP"
python3 - "$APP/nube.json" "$NUBE" "$TOKEN" <<'PY'
import json, sys, pathlib
p = pathlib.Path(sys.argv[1]); d = {}
try: d = json.loads(p.read_text(encoding="utf-8"))
except Exception: pass
d.update(url=sys.argv[2], token=sys.argv[3], activo=True); p.write_text(json.dumps(d), encoding="utf-8")
PY
mkdir -p "$APP/salida" "$APP/perfiles" && chown -R $USR:$USR "$DIR"

paso "5/8 Python, Playwright y Chromium (tarda unos minutos)"
sudo -u $USR bash -c "cd '$APP' && python3 -m venv .venv && .venv/bin/pip install -q --upgrade pip && .venv/bin/pip install -q -r requirements.txt"
"$APP/.venv/bin/python" -m playwright install-deps chromium >/dev/null
sudo -u $USR bash -c "cd '$APP' && .venv/bin/python -m playwright install chromium" >/dev/null

paso "6/8 Servicios 24/7"
cat > /etc/systemd/system/cotizagil-pantalla.service <<EOF
[Unit]
Description=CotizAgil pantalla virtual
[Service]
User=$USR
ExecStart=/usr/bin/Xvfb :99 -screen 0 1366x900x24 -nolisten tcp
Restart=always
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/cotizagil-escritorio.service <<EOF
[Unit]
Description=CotizAgil ventanas
After=cotizagil-pantalla.service
Requires=cotizagil-pantalla.service
[Service]
User=$USR
Environment=DISPLAY=:99
ExecStartPre=/bin/sleep 2
ExecStart=/usr/bin/openbox
Restart=always
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/cotizagil-vnc.service <<EOF
[Unit]
Description=CotizAgil vista remota (solo local; afuera va por HTTPS con clave)
After=cotizagil-pantalla.service
Requires=cotizagil-pantalla.service
[Service]
User=$USR
ExecStartPre=/bin/sleep 2
ExecStart=/usr/bin/x11vnc -display :99 -forever -shared -localhost -nopw -quiet -rfbport 5900
Restart=always
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/cotizagil-novnc.service <<EOF
[Unit]
Description=CotizAgil vista remota web
After=cotizagil-vnc.service
[Service]
User=$USR
ExecStart=/usr/bin/websockify --web=/usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900
Restart=always
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/cotizagil-robot.service <<EOF
[Unit]
Description=CotizAgil robot
After=network-online.target cotizagil-escritorio.service
Wants=network-online.target
[Service]
User=$USR
WorkingDirectory=$APP
Environment=DISPLAY=:99 CA_SIN_NAVEGADOR=1 PYTHONUTF8=1 PYTHONUNBUFFERED=1
ExecStartPre=/bin/rm -f $APP/salida/_detenido_a_mano
ExecStart=$APP/.venv/bin/python app.py
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
EOF
# 🔄 se actualiza solo: cada 10 min revisa si el PC subió una versión nueva
cat > "$DIR/actualizar.sh" <<EOF
#!/usr/bin/env bash
set -e
T=\$(mktemp -d)
code=\$(curl -sS -o "\$T/p.zip" -w '%{http_code}' -H "x-robot-token: $TOKEN" "$NUBE/bot/paquete" || echo 000)
if [ "\$code" = 200 ]; then
  unzip -oq "\$T/p.zip" -d "$APP" && chown -R $USR:$USR "$APP"
  python3 - "$APP/nube.json" "$NUBE" "$TOKEN" <<'PY'
import json, sys, pathlib
p = pathlib.Path(sys.argv[1]); d = json.loads(p.read_text(encoding="utf-8"))
d.update(url=sys.argv[2], token=sys.argv[3], activo=True); p.write_text(json.dumps(d), encoding="utf-8")
PY
  sudo -u $USR $APP/.venv/bin/pip install -q -r $APP/requirements.txt || true
  systemctl restart cotizagil-robot
  echo "\$(date) actualizado" >> $DIR/actualizaciones.log
fi
rm -rf "\$T"
EOF
chmod 700 "$DIR/actualizar.sh"
cat > /etc/systemd/system/cotizagil-actualizar.service <<EOF
[Unit]
Description=CotizAgil actualizar
[Service]
Type=oneshot
ExecStart=$DIR/actualizar.sh
EOF
cat > /etc/systemd/system/cotizagil-actualizar.timer <<EOF
[Unit]
Description=CotizAgil revisa actualizaciones cada 10 min
[Timer]
OnBootSec=5min
OnUnitActiveSec=10min
[Install]
WantedBy=timers.target
EOF

paso "7/8 Acceso seguro (HTTPS + clave) para iniciar sesión en Mercado Público desde el celular"
IP=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
DOM="$(echo "$IP" | tr . -).sslip.io"
CLAVE_F="$DIR/.clave_vista"
[ -s "$CLAVE_F" ] || (tr -dc 'A-Za-z0-9' </dev/urandom | head -c 14 > "$CLAVE_F")
chmod 600 "$CLAVE_F"; CLAVE=$(cat "$CLAVE_F")
HASH=$(caddy hash-password --plaintext "$CLAVE")
cat > /etc/caddy/Caddyfile <<EOF
vista.$DOM {
  basicauth {
    robot $HASH
  }
  reverse_proxy 127.0.0.1:6080
}
panel.$DOM {
  basicauth {
    robot $HASH
  }
  reverse_proxy 127.0.0.1:8610
}
EOF
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null

paso "8/8 Encendiendo"
systemctl daemon-reload
systemctl enable --now cotizagil-pantalla cotizagil-escritorio cotizagil-vnc cotizagil-novnc cotizagil-robot cotizagil-actualizar.timer >/dev/null
systemctl restart caddy cotizagil-robot
VISTA="https://vista.$DOM/vnc.html?autoconnect=1&resize=scale&reconnect=1"
curl -sS -X POST -H "x-robot-token: $TOKEN" -H 'content-type: application/json' "$NUBE/bot/nube-estado" \
  -d "{\"host\":\"$IP\",\"vista\":\"$VISTA\",\"panel\":\"https://panel.$DOM\",\"usuario\":\"robot\",\"clave\":\"$CLAVE\",\"version\":\"1\"}" >/dev/null || true
sleep 8
systemctl is-active --quiet cotizagil-robot && OK="✅ encendido" || OK="⚠ revisar: journalctl -u cotizagil-robot -n 50"
cat <<EOF

=====================================================================
  ☁️  CotizÁgil vive en la nube  ·  robot: $OK
  Vista remota (para iniciar sesión en Mercado Público una vez):
     $VISTA
  Panel del robot:  https://panel.$DOM
  Usuario: robot     Clave: $CLAVE
  (también aparece en la app: 💎 Planes → Robot en la nube)
=====================================================================
EOF
}
principal "$@"
