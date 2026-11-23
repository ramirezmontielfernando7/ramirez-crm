const emojiSequence = /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F)?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F)?\p{Emoji_Modifier}?)*(?:[\u{E0020}-\u{E007E}]+\u{E007F})?)$/u;

export function validCustomerReaction(value: string): boolean {
  return value === "" || (value.length <= 48 && emojiSequence.test(value));
}

const labels: Record<string, string> = {
  image: "Foto",
  sticker: "Sticker",
  audio: "Audio",
  video: "Video",
  document: "Documento",
  location: "Ubicación",
  contacts: "Contacto",
};

export function quotePreview(text: string | null, type: string): string {
  const summary = text?.trim();
  return summary ? Array.from(summary).slice(0, 120).join("") : (Object.hasOwn(labels, type) ? labels[type]! : "Mensaje");
}
