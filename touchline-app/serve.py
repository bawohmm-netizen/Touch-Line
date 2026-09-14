#!/usr/bin/env python3
"""
serve.py — run Touchline as a real website on this machine.

    python3 serve.py            # http://localhost:8000
    python3 serve.py 8080       # pick a different port

Serving over http://localhost counts as a secure origin, so the service
worker registers, offline mode works, and Chrome will offer to install it.

The address printed for your phone (http://192.168.x.x:8000) will load the
site fine, but browsers refuse service workers on a plain LAN address, so
there is no install prompt there. To install on a phone, deploy the folder —
see README.md.
"""
import http.server, os, socket, socketserver, sys, webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".json": "application/json",
        ".js": "text/javascript",
        ".css": "text/css",
    }

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        # never let the browser hold a stale service worker or data file
        if self.path.endswith(("sw.js", "data.json")):
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "304" not in (args[1] if len(args) > 1 else ""):
            sys.stderr.write("  %s\n" % (fmt % args))


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return None
    finally:
        s.close()


class Reuse(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    ip = lan_ip()
    print("\n  Touchline is running.\n")
    print(f"  On this computer   http://localhost:{PORT}")
    if ip:
        print(f"  On your phone      http://{ip}:{PORT}   (same Wi-Fi)")
    print("\n  Press Ctrl+C to stop.\n")
    try:
        webbrowser.open(f"http://localhost:{PORT}")
    except Exception:
        pass
    with Reuse(("", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Stopped.\n")
