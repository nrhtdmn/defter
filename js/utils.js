/** Lightweight markdown → HTML for preview */

export function renderMarkdown(src) {
  if (!src) return "";
  let text = escapeHtml(src);

  text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  text = text.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  text = text.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  text = text.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");

  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" />');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  text = text.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");

  return renderNestedLists(text);
}

function parseListLine(line) {
  const m = line.match(/^([ \t]*)(?:- \[([ xX])\]\s+(.*)|-\s+(.*)|(\d+)([.)])\s+(.*)|([a-zA-Z])([.)])\s+(.*))$/);
  if (!m) return null;
  const indent = m[1].replace(/\t/g, "  ");
  const level = Math.min(6, Math.floor(indent.length / 2));

  if (m[2] !== undefined) {
    return { level, type: "ul", style: "task", content: m[3], task: true, done: m[2].toLowerCase() === "x" };
  }
  if (m[4] !== undefined) {
    return { level, type: "ul", style: "bullet", content: m[4], task: false };
  }
  if (m[5] !== undefined) {
    return { level, type: "ol", style: m[6] === ")" ? "paren" : "dot", content: m[7], task: false };
  }
  return { level, type: "ol", style: "alpha", content: m[10], task: false };
}

function listOpenTag(type, style) {
  if (type === "ol" && style === "paren") return '<ol class="list-paren">';
  if (type === "ol" && style === "alpha") return '<ol class="list-alpha" type="a">';
  if (type === "ol") return "<ol>";
  return "<ul>";
}

function renderNestedLists(text) {
  const lines = text.split("\n");
  const html = [];
  /** @type {{ type: string, style: string }[]} */
  const stack = [];

  const flush = (toLevel) => {
    while (stack.length > toLevel) {
      html.push(`</li></${stack.pop().type}>`);
    }
  };

  for (const line of lines) {
    const item = parseListLine(line);
    if (!item) {
      flush(0);
      if (line.startsWith("<h") || line.startsWith("<pre") || line.startsWith("<blockquote") || line.startsWith("<img")) {
        html.push(line);
      } else if (line.trim() === "") {
        html.push("");
      } else {
        html.push(`<p>${line}</p>`);
      }
      continue;
    }

    const target = item.level;

    flush(target + 1);

    if (stack.length === target + 1) {
      const cur = stack[stack.length - 1];
      if (cur.type !== item.type || cur.style !== item.style) {
        html.push(`</li></${cur.type}>`);
        stack.pop();
      } else {
        html.push("</li>");
      }
    }

    while (stack.length <= target) {
      html.push(listOpenTag(item.type, item.style));
      stack.push({ type: item.type, style: item.style });
    }

    if (item.task) {
      html.push(
        `<li class="task${item.done ? " done" : ""}"><input type="checkbox" disabled ${item.done ? "checked" : ""} /><span>${item.content}</span>`
      );
    } else {
      html.push(`<li>${item.content}`);
    }
  }

  flush(0);
  return html.join("\n");
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function plainSnippet(body, max = 120) {
  return String(body || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`\[\]()!-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function wordCount(text) {
  const t = String(text || "").trim();
  if (!t) return { words: 0, chars: 0 };
  const words = t.split(/\s+/).filter(Boolean).length;
  return { words, chars: t.length };
}

export function formatRelative(ts) {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "şimdi";
  if (min < 60) return `${min} dk`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} sa`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} g`;
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function debounce(fn, ms = 350) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Detect list marker on a line */
export function getListInfo(line) {
  const s = String(line);
  let m = s.match(/^([ \t]*)- \[([ xX])\]\s?(.*)$/);
  if (m) {
    const indent = m[1].replace(/\t/g, "  ");
    return { kind: "check", indent, level: Math.floor(indent.length / 2), marker: `- [${m[2]}] `, body: m[3], raw: line };
  }
  m = s.match(/^([ \t]*)- (.*)$/);
  if (m) {
    const indent = m[1].replace(/\t/g, "  ");
    return { kind: "ul", indent, level: Math.floor(indent.length / 2), marker: "- ", body: m[2], raw: line };
  }
  m = s.match(/^([ \t]*)(\d+)([.)]) (.*)$/);
  if (m) {
    const indent = m[1].replace(/\t/g, "  ");
    return {
      kind: "ol",
      indent,
      level: Math.floor(indent.length / 2),
      num: +m[2],
      sep: m[3],
      marker: `${m[2]}${m[3]} `,
      body: m[4],
      raw: line,
    };
  }
  m = s.match(/^([ \t]*)([a-zA-Z])([.)]) (.*)$/);
  if (m) {
    const indent = m[1].replace(/\t/g, "  ");
    return {
      kind: "alpha",
      indent,
      level: Math.floor(indent.length / 2),
      letter: m[2],
      sep: m[3],
      marker: `${m[2]}${m[3]} `,
      body: m[4],
      raw: line,
    };
  }
  return null;
}

export function nextListMarker(info, stylePref = "paren") {
  if (!info) {
    if (stylePref === "alpha") return "a) ";
    if (stylePref === "ul") return "- ";
    if (stylePref === "check") return "- [ ] ";
    const sep = stylePref === "dot" ? "." : ")";
    return `1${sep} `;
  }
  if (info.kind === "ul") return `${info.indent}- `;
  if (info.kind === "check") return `${info.indent}- [ ] `;
  if (info.kind === "alpha") {
    const next = String.fromCharCode(info.letter.charCodeAt(0) + 1);
    return `${info.indent}${next}${info.sep} `;
  }
  return `${info.indent}${info.num + 1}${info.sep} `;
}

export function makeListPrefix(style, n = 1, indent = "") {
  if (style === "ul") return `${indent}- `;
  if (style === "check") return `${indent}- [ ] `;
  if (style === "alpha") {
    const ch = String.fromCharCode(96 + n);
    return `${indent}${ch}) `;
  }
  const sep = style === "dot" ? "." : ")";
  return `${indent}${n}${sep} `;
}
