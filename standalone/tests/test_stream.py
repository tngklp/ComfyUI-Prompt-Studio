import io
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.models.contract import ModelError
from prompt_studio.external_backend import _stream_with_reasoning


class StandaloneStreamTests(unittest.TestCase):
    def test_partial_stream_without_terminal_is_rejected(self):
        backend = SimpleNamespace(
            _connection_lock=threading.Lock(), cancel_event=threading.Event(),
        )
        with patch("prompt_studio.external_backend.http.client.HTTPConnection") as connection:
            response = connection.return_value.getresponse.return_value
            response.status = 200
            response.readline.side_effect = io.BytesIO(
                b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
            ).readline
            with self.assertRaises(ModelError) as error:
                _stream_with_reasoning(backend, "http://127.0.0.1:8080", {}, ModelError, len)
            self.assertEqual(error.exception.code, "EXTERNAL_STREAM_INTERRUPTED")
            connection.return_value.close.assert_called_once()
