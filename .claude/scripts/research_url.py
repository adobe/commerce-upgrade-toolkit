#!/usr/bin/env python3
# Copyright 2026 Adobe. All rights reserved.
# Licensed under the Apache License, Version 2.0.
# https://www.apache.org/licenses/LICENSE-2.0
# SPDX-License-Identifier: Apache-2.0
"""Validate research URLs and fetch without following unchecked redirects."""
import argparse
import hashlib
import json
import os
import re
import ssl
import sys
from http.client import responses
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, build_opener

PATHS = {
    "developer.adobe.com": r"/commerce(?:/.*)?",
    "experienceleague.adobe.com": r"/(?:(?:[a-z]{2}/)?docs/commerce-[A-Za-z0-9-]+(?:/.*)?|en/browse/commerce)",
    "devdocs.magento.com": r"/(?:guides/v?[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:/.*)?|index\.html)",
    "repo.magento.com": r"/.*",
    "github.com": r"/(?:magento|adobe-commerce)(?:/[A-Za-z0-9_.-]+)*",
}


def validate(url):
    if not isinstance(url, str) or not url.isascii() or re.search(r"[\s\\%<>\"'`]", url):
        raise ValueError("invalid URL characters or encoding")
    parts = urlsplit(url)
    if (parts.scheme != "https" or parts.username is not None or parts.password is not None
            or parts.port is not None or parts.netloc != parts.hostname
            or parts.query or parts.fragment):
        raise ValueError("HTTPS exact host without credentials, port, query or fragment required")
    if parts.hostname not in PATHS or not re.fullmatch(PATHS[parts.hostname], parts.path):
        raise ValueError("unapproved host or path")
    if not re.fullmatch(r"/[A-Za-z0-9_./-]*", parts.path):
        raise ValueError("unexpected path characters")
    if any(segment in (".", "..") for segment in parts.path.split("/")) or "//" in parts.path:
        raise ValueError("ambiguous path")
    return url


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def tls_context():
    if os.environ.get("SSL_CERT_FILE") or os.environ.get("SSL_CERT_DIR"):
        return ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE"),
                                          capath=os.environ.get("SSL_CERT_DIR"))
    context = ssl.create_default_context()
    if context.get_ca_certs():
        return context
    # Some standalone Python installations do not discover the OS trust bundle.
    for bundle in ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt",
                   "/etc/pki/tls/certs/ca-bundle.crt"):
        if os.path.isfile(bundle):
            context.load_verify_locations(cafile=bundle)
            if context.get_ca_certs():
                return context
    raise ssl.SSLError("No trusted CA certificates found; configure SSL_CERT_FILE "
                       "or SSL_CERT_DIR with your approved CA trust store.")


def fetch(url):
    validate(url)
    opener = build_opener(NoRedirect(), HTTPSHandler(context=tls_context()))
    for _ in range(6):
        validate(url)
        try:
            with opener.open(url, timeout=20) as response:
                validate(response.geturl())
                data = response.read(2_000_001)
                if len(data) > 2_000_000:
                    raise ValueError("research response exceeds size limit")
                return {"url": url, "sha256": hashlib.sha256(data).hexdigest(),
                        "retrieval_method": "controlled-http",
                        "untrusted_data": data.decode("utf-8", errors="strict")}
        except HTTPError as error:
            if error.code not in (301, 302, 303, 307, 308):
                raise
            location = error.headers.get("Location")
            if not location:
                raise ValueError("redirect without target")
            # Validate before the next network request, not after fetching.
            url = validate(urljoin(url, location))
    raise ValueError("too many redirects")


def escaped_json(value):
    return (json.dumps(value, ensure_ascii=True).replace("<", "\\u003c")
            .replace(">", "\\u003e").replace("&", "\\u0026"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("validate", "fetch"))
    parser.add_argument("url")
    args = parser.parse_args()
    try:
        result = {"url": validate(args.url)} if args.action == "validate" else fetch(args.url)
        print(escaped_json(result))
        return 0
    except (ValueError, OSError, UnicodeError, URLError) as error:
        cause = error.reason if isinstance(error, URLError) else error
        if isinstance(error, HTTPError):
            diagnostic = {"error": "HTTPError", "status": error.code,
                          "message": responses.get(error.code, "HTTP request rejected")}
        else:
            diagnostic = {"error": type(cause).__name__, "message": str(cause)}
        diagnostic["research_status"] = "unverified"
        print(escaped_json(diagnostic), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
