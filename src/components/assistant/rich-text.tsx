import { Fragment, type ReactNode } from "react";

/**
 * Formato ligero de las respuestas del asistente, sin HTML crudo (todo sale
 * como nodos de React): **negritas**, *cursiva*, `código`, listas con «- » o
 * «1. », títulos con «#» y párrafos. Lo demás (emojis, símbolos) pasa tal cual.
 */

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={key} className="font-semibold">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={key} className="rounded bg-subtle px-1 py-0.5 font-mono text-[0.85em]">{tok.slice(1, -1)}</code>);
    else out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text, testId }: { text: string; testId?: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  let n = 0;

  const flushPara = () => {
    if (para.length === 0) return;
    const key = `p${n++}`;
    blocks.push(
      <p key={key} className="break-words">
        {para.map((l, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {inline(l, `${key}-${i}`)}
          </Fragment>
        ))}
      </p>
    );
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const key = `l${n++}`;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={key} className={list.ordered ? "ml-5 list-decimal space-y-1" : "ml-5 list-disc space-y-1"}>
        {list.items.map((it, i) => (
          <li key={i}>{inline(it, `${key}-${i}`)}</li>
        ))}
      </Tag>
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const head = /^#{1,4}\s+(.*)$/.exec(line);
    if (bullet || num) {
      flushPara();
      const ordered = !!num;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? num)![1] ?? "");
    } else if (head) {
      flushPara();
      flushList();
      blocks.push(
        <p key={`h${n++}`} className="font-semibold">
          {inline(head[1] ?? "", `h${n}`)}
        </p>
      );
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return (
    <div className="space-y-2 text-sm leading-relaxed" data-testid={testId}>
      {blocks}
    </div>
  );
}
