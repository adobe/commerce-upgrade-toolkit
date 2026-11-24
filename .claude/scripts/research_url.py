#!/usr/bin/env python3
# Copyright 2026 Adobe. All rights reserved.
# Licensed under the Apache License, Version 2.0.
# https://www.apache.org/licenses/LICENSE-2.0
# SPDX-License-Identifier: Apache-2.0
"""Validate research URLs and fetch without following unchecked redirects."""
import argparse
import hashlib
import io
import json
import os
import re
import ssl
import subprocess
import sys
import tempfile
from http.client import parse_headers, responses
from html.parser import HTMLParser
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
    for attempt in range(6):
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
            if error.code == 403:
                result = fetch_curl(url, max_requests=6 - attempt)
                result["fallback_reason"] = {"error": "HTTPError", "status": 403}
                return result
            if error.code not in (301, 302, 303, 307, 308):
                raise
            location = error.headers.get("Location")
            if not location:
                raise ValueError("redirect without target")
            # Validate before the next network request, not after fetching.
            url = validate(urljoin(url, location))
    raise ValueError("too many redirects")


def fetch_curl(url, *, max_requests=6):
    for _ in range(max_requests):
        validate(url)
        with tempfile.TemporaryDirectory(prefix="ccua-research-") as directory:
            body_path = os.path.join(directory, "body")
            headers_path = os.path.join(directory, "headers")
            command = [
                "curl", "--disable", "--silent", "--show-error", "--proto", "=https",
                "--max-time", "20", "--max-filesize", "2000000", "--max-redirs", "0",
                "--output", body_path, "--dump-header", headers_path,
                "--write-out", "%{http_code}",
            ]
            for variable, flag in (("SSL_CERT_FILE", "--cacert"), ("SSL_CERT_DIR", "--capath")):
                if os.environ.get(variable):
                    command.extend([flag, os.environ[variable]])
            command.extend(["--url", url])
            try:
                completed = subprocess.run(command, capture_output=True, timeout=25, check=False)
            except subprocess.TimeoutExpired as error:
                raise TimeoutError("Controlled curl retrieval timed out.") from error
            if completed.returncode:
                raise OSError(f"Controlled curl retrieval failed (exit {completed.returncode}): "
                              f"{completed.stderr.decode('utf-8', errors='replace')[:1000]}")
            status_text = completed.stdout.decode("ascii", errors="strict")
            if not re.fullmatch(r"[0-9]{3}", status_text):
                raise ValueError("Invalid HTTP status from controlled curl retrieval.")
            status = int(status_text)
            if status in (301, 302, 303, 307, 308):
                with open(headers_path, "rb") as stream:
                    headers_data = stream.read(65_537)
                if len(headers_data) > 65_536:
                    raise ValueError("Research response headers exceed size limit.")
                blocks = [block for block in headers_data.split(b"\r\n\r\n") if block.strip()]
                if not blocks:
                    raise ValueError("Redirect without response headers.")
                status_line, separator, header_lines = blocks[-1].partition(b"\r\n")
                if not separator or not re.match(rb"HTTP/\S+ " + str(status).encode() + rb"(?: |$)",
                                                 status_line):
                    raise ValueError("Invalid redirect response headers.")
                headers = parse_headers(io.BytesIO(header_lines + b"\r\n\r\n"))
                locations = headers.get_all("Location", [])
                if len(locations) != 1:
                    raise ValueError("Redirect requires exactly one target.")
                url = validate(urljoin(url, locations[0]))
                continue
            if status != 200:
                raise HTTPError(url, status, responses.get(status, "HTTP request rejected"), {}, None)
            with open(body_path, "rb") as stream:
                data = stream.read(2_000_001)
            if len(data) > 2_000_000:
                raise ValueError("Research response exceeds size limit.")
            return {"url": url, "sha256": hashlib.sha256(data).hexdigest(),
                    "retrieval_method": "controlled-curl",
                    "untrusted_data": data.decode("utf-8", errors="strict")}
    raise ValueError("Too many redirects in controlled curl retrieval.")


class OfficialLinks(HTMLParser):
    def __init__(self, source_url):
        super().__init__()
        self.source_url = validate(source_url)
        self.links = []
        self.seen = set()

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag != "a" and not (tag == "link" and
                              "canonical" in (attributes.get("rel") or "").lower().split()):
            return
        href = attributes.get("href")
        if not href:
            return
        try:
            candidate = validate(urljoin(self.source_url, href))
        except ValueError:
            # Navigation can contain off-list links; never fetch or expose those candidates.
            return
        if candidate not in self.seen:
            self.seen.add(candidate)
            self.links.append(candidate)


def discover_links(url):
    evidence = fetch(url)
    parser = OfficialLinks(evidence["url"])
    parser.feed(evidence["untrusted_data"])
    parser.close()
    return {**{key: value for key, value in evidence.items() if key != "untrusted_data"},
            "links": parser.links}


def escaped_json(value):
    return (json.dumps(value, ensure_ascii=True).replace("<", "\\u003c")
            .replace(">", "\\u003e").replace("&", "\\u0026"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("validate", "fetch", "links"))
    parser.add_argument("url")
    args = parser.parse_args()
    try:
        if args.action == "validate":
            result = {"url": validate(args.url)}
        elif args.action == "links":
            result = discover_links(args.url)
        else:
            result = fetch(args.url)
        print(escaped_json(result))
        return 0
    except (ValueError, OSError, UnicodeError, URLError) as error:
        cause = error.reason if isinstance(error, URLError) else error
        if isinstance(error, HTTPError):
            diagnostic = {"error": "HTTPError", "status": error.code,
                          "message": responses.get(error.code, "HTTP request rejected")}
            diagnostic["failure_kind"] = ("http-not-found" if error.code == 404 else
                                          "http-access-denied" if error.code in (401, 403) else
                                          "http-error")
        else:
            diagnostic = {"error": type(cause).__name__, "message": str(cause)}
        diagnostic["research_status"] = "unverified"
        print(escaped_json(diagnostic), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
