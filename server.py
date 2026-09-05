import http.server
import socketserver
import os
import sys

# Ensure UTF-8 output encoding for Windows terminal
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

PORT = 3000

REWRITES = {
    "/": "/index.html",
    "/saudia": "/saudia/index.html",
    "/etiket": "/saudia/etiket.html",
    "/e-ticket": "/saudia/etiket.html",
    "/azharuna": "/ifdony/index.html",
    "/ifdony": "/ifdony/index.html",
    "/logo-azharuna": "/ifdony/index.html",
    "/barber": "/barber/index.html",
    "/underrated": "/barber/index.html",
    "/markazfiqih": "/markazfiqih/index.html",
    "/abdurrahman": "/abdurrahman/index.html",
    "/dreammecca-umrahme": "/dreammecca-umrahme/index.html",
    "/haramain-capture": "/haramain-capture/index.html",
    "/qohiroh": "/qohiroh/index.html",
    "/zaky": "/zaky/index.html",
    "/sidi": "/hamasahlaundry/index.html",
    "/hamasahlaundry": "/hamasahlaundry/index.html",
    "/umiatiyah": "/umiatiyah/index.html",
    "/umi": "/umiatiyah/index.html",
    "/kolohaga": "/kolohaga/index.html",
    "/azzam": "/kolohaga/index.html",
    "/zalvice": "/zalvice/index.html",
    "/azhariyah": "/azhariyah/index.html",
    "/umielly": "/azhariyah/index.html"
}

class InvoiceRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        url_path = self.path.split("?")[0].rstrip("/")
        if not url_path:
            url_path = "/"
        
        if url_path in REWRITES:
            target = REWRITES[url_path]
            self.path = target
        elif not os.path.exists("." + url_path) and os.path.exists("." + url_path + ".html"):
            self.path = url_path + ".html"
        elif not os.path.exists("." + url_path) and os.path.exists("." + url_path + "/index.html"):
            self.path = url_path + "/index.html"
            
        return super().do_GET()

if __name__ == "__main__":
    handler = InvoiceRequestHandler
    socketserver.TCPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("", PORT), handler) as httpd:
        print(f"[SERVER] Localhost server running at http://localhost:{PORT}")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
