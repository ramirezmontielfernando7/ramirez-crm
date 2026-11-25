"""MCP stdio adapter. Attach only to a trusted, authenticated tool host."""
import json
import os
import sys

from broker import GitHub, SIGN_KEYS, SOURCE_KEYS, handle, need

VERSION = "2025-06-18"
MAX_MESSAGE = 32768
OPERATIONS = {
    "request_build": ("Solicita una compilación Expo desde una rama y SHA revisados.", SOURCE_KEYS),
    "request_sign": ("Solicita firma del artefacto autorizado. Requiere revisión humana en GitHub.", SIGN_KEYS),
    "list_runs": ("Lista ejecuciones recientes del workflow móvil de tipo build o sign.", {"kind"}),
    "status": ("Consulta el estado de una ejecución móvil autorizada.", {"run_id"}),
    "artifacts": ("Devuelve enlaces y digest de artefactos del workflow móvil.", {"run_id"}),
    "cancel": ("Cancela una ejecución móvil todavía activa.", {"run_id"}),
}


def schema(name, description, keys):
    return {"name": name, "description": description, "inputSchema": {
        "type": "object", "required": sorted(keys), "additionalProperties": False,
        "properties": {key: {"type": "string", "maxLength": 180} for key in sorted(keys)}}}


def respond(api, message, *, can_cancel=False):
    need(isinstance(message, dict) and message.get("jsonrpc") == "2.0", "Mensaje inválido.")
    method = message.get("method")
    request = message.get("id")
    if request is None:
        return None
    envelope = {"jsonrpc": "2.0", "id": request}
    if method == "initialize":
        payload = {"protocolVersion": VERSION, "capabilities": {"tools": {}},
                   "serverInfo": {"name": "dashfort-mobile-requests", "version": "1.0"}}
    elif method == "ping":
        payload = {}
    elif method == "tools/list":
        payload = {"tools": [schema(name, description, keys) for name, (description, keys) in OPERATIONS.items()
                             if name != "cancel" or can_cancel]}
    elif method == "tools/call":
        try:
            params = message.get("params", {})
            need(isinstance(params, dict) and isinstance(params.get("name"), str), "Parámetros inválidos.")
            need(params["name"] != "cancel" or can_cancel, "La cancelación requiere un operador.")
            result = handle(api, params["name"], params.get("arguments", {}))
            payload = {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}
        except ValueError as error:
            payload = {"isError": True, "content": [{"type": "text", "text": str(error)}]}
        except (KeyError, TypeError, AttributeError):
            payload = {"isError": True, "content": [{"type": "text", "text": "Respuesta externa inválida."}]}
    else:
        return {**envelope, "error": {"code": -32601, "message": "Método no disponible."}}
    return {**envelope, "result": payload}


def main():
    api = GitHub(os.environ.pop("DASHFORT_DISPATCH_TOKEN", ""))
    while line := sys.stdin.buffer.readline(MAX_MESSAGE + 1):
        if len(line) > MAX_MESSAGE:
            return
        try:
            reply = respond(api, json.loads(line))
        except (ValueError, TypeError):
            reply = {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Solicitud inválida."}}
        if reply is not None:
            print(json.dumps(reply, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
