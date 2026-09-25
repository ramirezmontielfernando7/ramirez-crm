import type { Branding } from "@/lib/branding";
import {
  BRAND_BUBBLE,
  BRAND_BUBBLE_STROKE,
  BRAND_BYLINE,
  BRAND_NAME,
  BRAND_TEAL,
  BRAND_TEAL_LIGHT,
  isHouseName,
} from "@/lib/brand";
import { faviconHref, faviconInitial } from "@/lib/favicon";
import { cn } from "@/lib/utils";

/**
 * Lo que la marca necesita para dibujarse: el nombre, el acento y si hay
 * logo subido (el acento entra en la URL versionada del icono generado).
 */
export type BrandingMark = Pick<Branding, "name" | "accent" | "favicon">;

/** La burbuja de Dashfort: trazo en `currentColor` (blanco sobre el mosaico). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d={BRAND_BUBBLE}
        stroke="currentColor"
        strokeWidth={BRAND_BUBBLE_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Mosaico cuadrado: es el favicon en grande. Con un logo subido lleva el logo
 * (el MISMO archivo y la MISMA URL versionada que la pestaña, así lo que se
 * sube en Ajustes → Marca se ve en los dos sitios); sin él, la burbuja de
 * Dashfort sobre su teal o la inicial del nombre white-label sobre el acento.
 */
export function BrandTile({
  branding,
  className,
}: {
  branding: BrandingMark;
  className?: string;
}) {
  const house = !branding.favicon && isHouseName(branding.name);
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden",
        house ? "text-white" : "brand-tile text-brand-fg",
        className
      )}
      style={
        house
          ? {
              // El teal del logo, con el brillo suave del centro del original.
              background: `radial-gradient(circle at 45% 40%, ${BRAND_TEAL_LIGHT}, ${BRAND_TEAL} 70%)`,
            }
          : undefined
      }
      aria-hidden
    >
      {branding.favicon ? (
        // Sin next/image a propósito: es un archivo de una ruta propia, ya
        // pequeño; pasarlo por el optimizador sería trabajo para no ahorrar.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={faviconHref(branding)}
          alt=""
          className="h-full w-full object-contain"
        />
      ) : house ? (
        <BrandMark className="h-[56%] w-[56%]" />
      ) : (
        <span className="font-bold leading-none">{faviconInitial(branding.name)}</span>
      )}
    </span>
  );
}

const WORDMARK_SIZE = {
  md: "text-[18px]",
  lg: "text-[28px]",
} as const;

const BYLINE_SIZE = {
  md: "text-[10.5px]",
  lg: "text-[13px]",
} as const;

const TILE_SIZE = {
  md: "h-[32px] w-[32px] rounded-[9px] text-[15px]",
  lg: "h-[44px] w-[44px] rounded-[13px] text-[22px]",
} as const;

/**
 * La marca completa: mosaico + nombre. Con la marca de la casa, "Dashfort" y
 * debajo, chica y tenue, la firma "by Demfort". Una instancia rebautizada ve
 * su mosaico (inicial o logo subido) y su nombre (white-label).
 */
export function BrandLogo({
  branding,
  size = "md",
  className,
}: {
  branding: BrandingMark;
  size?: keyof typeof WORDMARK_SIZE;
  className?: string;
}) {
  const house = isHouseName(branding.name);
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5 text-foreground", className)}>
      <BrandTile branding={branding} className={TILE_SIZE[size]} />
      {/* text-left: en el login el contenedor centra, y la firma debe quedar
          alineada con el nombre, no centrada bajo él. */}
      <span className="flex min-w-0 flex-col text-left">
        <span
          className={cn(
            "truncate font-[800] leading-none tracking-[-0.035em]",
            WORDMARK_SIZE[size]
          )}
        >
          {house ? BRAND_NAME : branding.name}
        </span>
        {house && (
          <span
            className={cn(
              "mt-[3px] truncate font-medium leading-none tracking-[0.01em] opacity-55",
              BYLINE_SIZE[size]
            )}
          >
            {BRAND_BYLINE}
          </span>
        )}
      </span>
    </span>
  );
}
