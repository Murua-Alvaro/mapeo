from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os

PORT = 8000
ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)

print(f"Servidor local: http://localhost:{PORT}")
print("Presiona Ctrl+C para detenerlo.")
ThreadingHTTPServer(("127.0.0.1", PORT), SimpleHTTPRequestHandler).serve_forever()
