#!/usr/bin/env python3
"""Exercise release privacy checks without network access or real tokens."""
import importlib.util
from pathlib import Path
import unittest
import urllib.error

spec = importlib.util.spec_from_file_location("private_ghcr", Path(__file__).with_name("check-ghcr-private.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PrivacyChecks(unittest.TestCase):
    def check(self, responses, allow_missing=False):
        responses = iter(responses)
        return module.check_private("sinner351sdf/AIBuddy-Panel", "test-placeholder", allow_missing,
                                    lambda *args: next(responses))

    def test_private_denies_anonymous(self):
        self.assertIn("visibility=private", self.check([(200, {"visibility": "private"}), (403, None)]))

    def test_new_package_can_be_created(self):
        self.assertIn("首次发布", self.check([(404, None), (403, None)], True))

    def test_missing_package_fails_after_publish(self):
        with self.assertRaises(ValueError):
            self.check([(404, None)])

    def test_public_package_is_rejected(self):
        with self.assertRaises(ValueError):
            self.check([(200, {"visibility": "public"})], True)

    def test_inaccessible_api_is_rejected(self):
        with self.assertRaises(ValueError):
            self.check([(403, None)], True)

    def test_anonymous_pull_is_rejected_even_if_api_says_private(self):
        with self.assertRaises(ValueError):
            self.check([(200, {"visibility": "private"}), (200, {"token": "anonymous-placeholder"}), (200, {})])

    def test_anonymous_token_with_no_access_is_allowed(self):
        self.check([(200, {"visibility": "private"}), (200, {"token": "anonymous-placeholder"}), (401, None)])

    def test_registry_errors_fail_closed(self):
        with self.assertRaises(ValueError):
            self.check([(200, {"visibility": "private"}), (500, None)])

    def test_empty_token_response_fails_closed(self):
        with self.assertRaises(ValueError):
            self.check([(200, {"visibility": "private"}), (200, {})])

    def test_missing_credentials_fails_closed(self):
        with self.assertRaises(ValueError):
            module.check_private("sinner351sdf/AIBuddy-Panel", "")

    def test_workflow_bot_cannot_create_package(self):
        with self.assertRaises(ValueError):
            module.check_private("sinner351sdf/AIBuddy-Panel", "test-placeholder", True,
                                 fetch=lambda *args: (200, {"login": "github-actions[bot]"}), require_owner=True)

    def test_owner_token_targets_private_package_name(self):
        responses = iter([(200, {"login": "sinner351sdf"}), (200, {"visibility": "private"}), (403, None)])
        urls = []
        def fetch(url, *args):
            urls.append(url)
            return next(responses)
        module.check_private("sinner351sdf/AIBuddy-Panel", "test-placeholder", fetch=fetch,
                             package_name="aibuddy-panel-private", require_owner=True)
        self.assertTrue(urls[1].endswith("/aibuddy-panel-private"))

    def test_network_failure_is_not_treated_as_private(self):
        def failed(*args):
            raise urllib.error.URLError("test network failure")
        with self.assertRaises(urllib.error.URLError):
            module.check_private("sinner351sdf/AIBuddy-Panel", "test-placeholder", True, failed)


if __name__ == "__main__":
    unittest.main()
