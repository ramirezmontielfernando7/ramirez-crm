"""Stateless MCP Streamable HTTP entry point for an owner-authorized TLS host."""
import hashlib
import hmac
import json
import os
import re

from broker import GitHub, need
from mcp_server import MAX_MESSAGE, respond


def enrolled_clients(raw):
    rows = json.loads(raw)
    need(isinstance(rows, list) and 0 < len(rows) <= 64, "Registro de clientes inválido.")
    unique = set()
    for row in rows:
        need(isinstance(row, dict) and set(row) == {"token_sha256", "role"} and
             isinstance(row["token_sha256"], str) and re.fullmatch("[0-9a-f]{64}", row["token_sha256"]) and
             row["role"] in ("agent", "operator") and row["token_sha256"] not in unique, "Cliente inválido.")
        unique.add(row["token_sha256"])
    return tuple(rows)


def client_role(authorization, clients):
    token = re.fullmatch(r"Bearer ([A-Za-z0-9._~-]{32,256})", authorization)
    if not token:
        return None
    digest = hashlib.sha256(token.group(1).encode()).hexdigest()
    matches = [row["role"] for row in clients if hmac.compare_digest(row["token_sha256"], digest)]
    return matches[0] if matches else None


def app(env, start):
    def reply(status, data=None, headers=()):
        payload = b"" if data is None else json.dumps(data, ensure_ascii=False).encode()
        start(status, [("Content-Type", "application/json"), ("Content-Length", str(len(payload))),
                       ("Cache-Control", "no-store"), *headers])
        return [payload]

    if env.get("PATH_INFO") != "/mcp":
        return reply("404 Not Found")
    if env.get("HTTP_ORIGIN"):
        return reply("403 Forbidden")
    if env.get("REQUEST_METHOD") != "POST":
        return reply("405 Method Not Allowed", headers=(("Allow", "POST"),))
    try:
        clients = enrolled_clients(os.environ.get("DASHFORT_MCP_CLIENTS", "[]"))
    except (ValueError, TypeError, KeyError):
        return reply("503 Service Unavailable")
    role = client_role(env.get("HTTP_AUTHORIZATION", ""), clients)
    if role is None:
        return reply("401 Unauthorized", headers=(("WWW-Authenticate", "Bearer"),))
    if env.get("CONTENT_TYPE", "").split(";", 1)[0].strip().lower() != "application/json":
        return reply("415 Unsupported Media Type")
    try:
        length = int(env.get("CONTENT_LENGTH", ""))
    except ValueError:
        return reply("411 Length Required")
    if not 0 < length <= MAX_MESSAGE:
        return reply("413 Content Too Large")
    try:
        api = GitHub(os.environ.get("DASHFORT_DISPATCH_TOKEN", ""))
        message = json.loads(env["wsgi.input"].read(length))
        result = respond(api, message, can_cancel=(role == "operator"))
    except (ValueError, TypeError, UnicodeError):
        return reply("400 Bad Request", {"error": "Solicitud o configuración inválida."})
    return reply("202 Accepted") if result is None else reply("200 OK", result)
