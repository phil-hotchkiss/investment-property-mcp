import os
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))
import secrets as store  # noqa: E402  (local module; shadows stdlib `secrets` only in this process)


def done(code=0, out=""):
    return subprocess.CompletedProcess([], code, stdout=out, stderr="")


@patch.object(store, "_mac", return_value=True)
class StoreTest(unittest.TestCase):
    @patch("subprocess.run", return_value=done(0, "sk-abc\n"))
    def test_get_hit(self, run, _):
        self.assertEqual(store.get("K"), "sk-abc")
        self.assertEqual(
            run.call_args.args[0],
            ["security", "find-generic-password", "-s", "rental-deal-math", "-a", "K", "-w"],
        )

    @patch("subprocess.run", return_value=done(44))
    def test_get_miss(self, run, _):
        self.assertIsNone(store.get("K"))

    @patch("subprocess.run", return_value=done())
    def test_set(self, run, _):
        store.set("K", "v")
        self.assertEqual(
            run.call_args.args[0],
            ["security", "add-generic-password", "-U", "-s", "rental-deal-math", "-a", "K", "-w", "v"],
        )

    @patch("subprocess.run", return_value=done())
    def test_delete(self, run, _):
        store.delete("K")
        self.assertEqual(
            run.call_args.args[0],
            ["security", "delete-generic-password", "-s", "rental-deal-math", "-a", "K"],
        )

    @patch("builtins.print")
    @patch("subprocess.run", return_value=done(0, "a b'c\n"))
    def test_env_format(self, run, pr, _):
        self.assertEqual(store.main(["env", "K"]), 0)
        pr.assert_called_once_with("export K='a b'\"'\"'c'")


class FallbackTest(unittest.TestCase):
    @patch.object(store, "_mac", return_value=False)
    def test_non_mac(self, _):
        with patch.dict(os.environ, {"K": "fromenv"}):
            self.assertEqual(store.get("K"), "fromenv")
        self.assertEqual(store.main(["set", "K"]), 2)
        self.assertEqual(store.main(["delete", "K"]), 2)


if __name__ == "__main__":
    unittest.main()
