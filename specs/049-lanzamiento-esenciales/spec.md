# 049 — Funciones esenciales para lanzar (sin IA)

Fase 7 del masterplan de lanzamiento. Tres funciones baratas que la competencia ya trae:

1. **Mensajes automáticos**: bienvenida (primer mensaje de un chat nuevo, una vez) y fuera de horario (como mucho 1 cada 12 h por chat). Horario por día y zona. Fuera de horario gana a la bienvenida. No salen si la IA va a contestar, si el chat nació de una campaña, si el contacto dio de baja, ni en Laboratorio / «Mi número». Apagados de fábrica.
2. **Chats olvidados**: aviso (toast) al asesor asignado y a quien ve todo cuando un cliente lleva 1/2/4/8/24 h sin respuesta, solo dentro del horario, un aviso por mensaje del cliente. Lista «Esperando respuesta» en Resultados → Ventas. «Atención del equipo» en Resultados → Atención: mediana de primera respuesta de personas, % en 5 min y 1 h, chats sin ninguna respuesta.
3. **Exportar todos mis datos**: ZIP con contactos, embudo, conversaciones y mensajes (CSV UTF-8) + LEEME. Solo Propietario. Sin archivos multimedia.

Los mensajes automáticos (`message.auto_kind`) no cuentan como respuesta.

Reversa: `scripts/sql/0079-reversa.sql`.
