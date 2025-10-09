from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
import os

class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add headers to disable browser caching
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

def main():
    port = int(os.environ.get("PORT", "8000"))
    root = os.environ.get("ROOT_DIR", "./")  # serve current directory by default
    handler = partial(NoCacheHandler, directory=root)

    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Serving {os.path.abspath(root)} on http://127.0.0.1:{port} with no-cache headers")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down...")
        finally:
            httpd.server_close()

if __name__ == "__main__":
    main()