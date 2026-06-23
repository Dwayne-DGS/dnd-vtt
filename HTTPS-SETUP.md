# Setting up HTTPS (required for voice & video)

Browsers refuse to give a web page access to the microphone or camera unless the
page is served over a **secure** connection (`https://`). Your app currently runs
at `http://178.156.242.173:3000`, so voice/video will be blocked until you finish
these steps. This is a one-time setup; after it, voice "just works."

You'll end up with a real address like `https://yourtable.com` instead of an IP.

---

## Step 1 — Get a domain name

You need a domain (or subdomain) pointing at your server. Options:

- **Cheap domain (~$10/yr):** Namecheap, Porkbun, or Cloudflare Registrar. Buy
  something like `yourtable.com`.
- **Free subdomain:** services like DuckDNS (`yourtable.duckdns.org`) are free and
  work fine for this.

Then create a **DNS "A" record** pointing your domain at the server's IP:

```
Type: A
Name: @   (or a subdomain like "play")
Value: 178.156.242.173
```

Wait a few minutes for DNS to propagate. Test from your Mac:

```bash
ping yourtable.com      # should show 178.156.242.173
```

---

## Step 2 — Open ports 80 and 443

HTTPS uses ports 80 (for the certificate check) and 443 (for the secure site).

On the **server**:

```bash
ufw allow 80
ufw allow 443
```

And if you have a **Hetzner Cloud Firewall** (Console → Firewalls), add inbound
rules for TCP **80** and TCP **443**, source "Any IPv4".

---

## Step 3 — Install Nginx + Certbot

On the server:

```bash
apt update && apt install -y nginx certbot python3-certbot-nginx
```

---

## Step 4 — Point Nginx at the app (with WebSocket support)

Create the site config. Replace `yourtable.com` with your real domain:

```bash
cat > /etc/nginx/sites-available/dnd <<'EOF'
server {
    listen 80;
    server_name yourtable.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF
ln -sf /etc/nginx/sites-available/dnd /etc/nginx/sites-enabled/dnd
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

**Important — allow large uploads.** Nginx caps request bodies at 1 MB by default,
which makes map/portrait image uploads fail. Raise it once:

```bash
echo 'client_max_body_size 15M;' > /etc/nginx/conf.d/upload-size.conf
nginx -t && systemctl reload nginx
```

(The `Upgrade`/`Connection` headers are what let the live sync and voice signaling
work through Nginx — without them, real-time features break.)

---

## Step 5 — Get the free SSL certificate

```bash
certbot --nginx -d yourtable.com
```

Follow the prompts (enter an email, agree to terms, choose to redirect HTTP→HTTPS).
Certbot installs the certificate and auto-renews it.

---

## Done

Open **`https://yourtable.com`** — note the padlock. Now:

- Click **🎤 Join voice** and your browser will ask for mic/camera permission.
- Your husband opens the same `https://yourtable.com`, enters the same room, and
  joins voice too.

You can keep using port 3000 directly for testing, but share the `https://` address
for actual play so voice works.

---

## Troubleshooting voice

- **"Couldn't access mic/camera"** → you're still on `http://` or an IP. Use the
  `https://` domain.
- **You hear nothing / no video appears** → check both people clicked *Join voice*
  and granted browser permission. Refresh and rejoin.
- **Connects on same wifi but not across the internet** → some home routers use a
  strict NAT that a plain STUN server can't punch through. The fix is adding a
  **TURN relay** (e.g. `coturn`) on the server. Ask and I'll set it up — it's an
  extra ~15 min of config, only needed if you actually hit this.
