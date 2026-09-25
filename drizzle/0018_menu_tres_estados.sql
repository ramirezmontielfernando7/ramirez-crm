-- 022 - Menu lateral de tres estados (expandido, solo iconos, oculto).
--
-- Aditiva y RE-EJECUTABLE (Constitucion IV): una columna nueva y nullable.
-- `nav_collapsed` se conserva y se sigue escribiendo en paralelo; una fila
-- sin `nav_mode` se lee desde `nav_collapsed` como antes.

ALTER TABLE "user_preference" ADD COLUMN IF NOT EXISTS "nav_mode" text;
