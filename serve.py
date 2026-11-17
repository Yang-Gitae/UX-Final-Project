"""
Little Bean local server (used by start-server.bat).

Serves this folder on a free localhost port and opens the browser once the
server is ready. Voice input only works from http://localhost, not from a
page opened as a file. It skips ports that another program is already using
(port 8000 is often taken on Windows).

Run:  python serve.py      (or: py serve.py)
Stop: close the window or press Ctrl+C
"""
import functools
import http.server
import os
import socket
import threading
import webbrowser

PORTS = [8765, 8766, 8767, 8768, 5173, 4173]
HERE = os.path.dirname(os.path.abspath(__file__))


def port_in_use(port):
    """True if something already answers on this port (IPv4 or IPv6 localhost)."""
    for family, host in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
        try:
            with socket.socket(family, socket.SOCK_STREAM) as s:
                s.settimeout(0.3)
                if s.connect_ex((host, port)) == 0:
                    return True
        except OSError:
            pass
    return False


class Server(http.server.ThreadingHTTPServer):
    # Never share a port with another program.
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):  # Windows only
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class Handler(http.server.SimpleHTTPRequestHandler):
    # Windows can map .js to text/plain in the registry; force the right type.
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".css": "text/css", ".html": "text/html"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # always load the latest edits
        super().end_headers()

    def log_message(self, *args):
        pass  # keep the window readable


def main():
    for port in PORTS:
        if port_in_use(port):
            continue
        try:
            httpd = Server(("127.0.0.1", port), functools.partial(Handler, directory=HERE))
        except OSError:
            continue
        url = f"http://localhost:{port}/"
        print(f"\n  Little Bean is running at {url}")
        print("  Open it in Chrome or Edge and allow the microphone when asked.")
        print("  Keep this window open while you use the site. Close it to stop.\n")
        threading.Timer(0.6, webbrowser.open, [url]).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
        return
    print("\n  Could not find a free port (tried " + ", ".join(map(str, PORTS)) + ").")
    print("  Close other local servers and try again.\n")
    input("  Press Enter to close...")


if __name__ == "__main__":
    main()
