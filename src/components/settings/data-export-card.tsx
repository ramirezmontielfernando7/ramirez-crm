"use client";

import { Download } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 049 — Descarga de todos los datos del negocio en un ZIP de CSV. */
export function DataExportCard() {
  return (
    <Card data-testid="data-export-card">
      <CardHeader>
        <CardTitle>Exportar todos mis datos</CardTitle>
        <CardDescription>
          Un archivo ZIP con tus contactos, tu embudo de ventas, tus conversaciones y todos los mensajes, en
          archivos CSV que abre Excel. Puede tardar unos minutos si tienes muchos chats.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <a
          href="/api/data-export"
          download
          className={cn(buttonVariants({ variant: "default" }), "inline-flex items-center gap-2")}
          data-testid="data-export-link"
        >
          <Download className="h-4 w-4" aria-hidden /> Descargar mis datos
        </a>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Solo el Propietario puede descargarlo.</li>
          <li>Las fotos, audios y documentos no van dentro (pesarían gigas). Si los necesitas, pídenos una copia aparte.</li>
          <li>No incluye los chats de prueba ni los del «Mi número» de cada persona.</li>
        </ul>
      </CardContent>
    </Card>
  );
}
