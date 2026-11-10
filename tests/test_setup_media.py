"""Downloader unit tests; local HTTP fixture is not model inference evidence."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from tools.setup_media import download_file


class DownloadResume(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.target = Path(self.tmp.name) / 'weight'
        self.target.write_bytes(b'abc')

    def server(self, supports_range):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(inner):
                if supports_range:
                    self.assertEqual(inner.headers.get('Range'), 'bytes=3-')
                    inner.send_response(206)
                    inner.send_header('Content-Range', 'bytes 3-5/6')
                    payload = b'def'
                else:
                    inner.send_response(200)
                    payload = b'abcdef'
                inner.send_header('Content-Length', str(len(payload)))
                inner.end_headers()
                inner.wfile.write(payload)
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return 'http://127.0.0.1:' + str(server.server_port) + '/weight'

    def test_resume_preserves_existing_bytes(self):
        download_file(self.target, self.server(True), 6)
        self.assertEqual(self.target.read_bytes(), b'abcdef')

    def test_no_range_never_overwrites_partial(self):
        with self.assertRaises(subprocess.CalledProcessError):
            download_file(self.target, self.server(False), 6)
        self.assertEqual(self.target.read_bytes(), b'abc')

    def test_oversize_fails_without_network(self):
        with self.assertRaises(RuntimeError):
            download_file(self.target, 'http://127.0.0.1:1/no', 2)

    def test_complete_skips_network(self):
        download_file(self.target, 'http://127.0.0.1:1/no', 3)
        self.assertEqual(self.target.read_bytes(), b'abc')


if __name__ == '__main__':
    unittest.main()
