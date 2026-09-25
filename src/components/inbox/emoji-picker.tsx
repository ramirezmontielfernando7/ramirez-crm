"use client";

import { EmojiPicker } from "frimousse";

/**
 * Selector de emojis del compositor. frimousse no trae estilos: se viste con
 * los tokens de la marca, así respeta el tema claro/oscuro y el acento.
 *
 * Los datos (en español: buscar "corazón" funciona) los sirve la propia
 * instancia desde `/emojibase` — ver `src/app/emojibase/` —, nunca un CDN.
 * Este módulo se carga con `next/dynamic` solo al abrir el selector.
 */
export default function ComposerEmojiPicker({
  onPick,
}: {
  onPick: (emoji: string) => void;
}) {
  return (
    <EmojiPicker.Root
      locale="es"
      emojibaseUrl="/emojibase"
      columns={8}
      onEmojiSelect={({ emoji }) => onPick(emoji)}
      className="isolate flex h-[340px] w-[304px] flex-col"
    >
      <div className="flex items-center gap-1.5 p-2 pb-1.5">
        <EmojiPicker.Search
          placeholder="Buscar emoji…"
          aria-label="Buscar emoji"
          className="min-w-0 flex-1 rounded-md border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-text-3 focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
        />
        <EmojiPicker.SkinToneSelector
          aria-label="Cambiar tono de piel"
          className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-md text-lg transition-colors hover:bg-secondary"
        />
      </div>
      <EmojiPicker.Viewport className="relative flex-1 outline-none">
        <EmojiPicker.Loading className="absolute inset-0 flex items-center justify-center text-xs text-text-3">
          Cargando emojis…
        </EmojiPicker.Loading>
        <EmojiPicker.Empty className="absolute inset-0 flex items-center justify-center text-xs text-text-3">
          Ningún emoji coincide
        </EmojiPicker.Empty>
        <EmojiPicker.List
          className="select-none pb-1.5"
          components={{
            CategoryHeader: ({ category, ...props }) => (
              <div
                {...props}
                className="bg-popover px-3 pb-1 pt-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-3"
              >
                {category.label}
              </div>
            ),
            Row: ({ children, ...props }) => (
              <div {...props} className="scroll-my-1.5 px-1.5">
                {children}
              </div>
            ),
            Emoji: ({ emoji, ...props }) => (
              <button
                {...props}
                className="flex aspect-square flex-1 items-center justify-center rounded-md text-xl data-[active]:bg-secondary"
              >
                {emoji.emoji}
              </button>
            ),
          }}
        />
      </EmojiPicker.Viewport>
    </EmojiPicker.Root>
  );
}
