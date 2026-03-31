/**
 * Minimal markdown-to-HTML converter with XSS sanitization.
 * Supports: headers, bold, italic, code blocks, inline code, lists, tables, links, line breaks.
 */

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch { /* invalid */ }
  return '#';
}

export function renderMarkdown(text) {
  if (!text) return '';

  let html = escapeHtml(text);

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    '<pre class="ai-code-block"><code>' + code.trim() + '</code></pre>'
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="ai-inline-code">$1</code>');

  // Tables
  html = html.replace(/((?:\|.+\|\n)+)/g, (table) => {
    const rows = table.trim().split('\n');
    if (rows.length < 2) return table;
    let out = '<table class="ai-table">';
    rows.forEach((row, i) => {
      if (/^\|[\s\-:|]+\|$/.test(row)) return;
      const cells = row.split('|').filter(c => c.trim() !== '');
      const tag = i === 0 ? 'th' : 'td';
      out += '<tr>' + cells.map(c => '<' + tag + '>' + c.trim() + '</' + tag + '>').join('') + '</tr>';
    });
    out += '</table>';
    return out;
  });

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Unordered lists
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.+<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Links (sanitized URLs)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
    '<a href="' + sanitizeUrl(url) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>'
  );

  // Paragraphs and line breaks
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  html = '<p>' + html + '</p>';

  // Clean up empty/nested paragraphs around block elements
  const blocks = ['h2', 'h3', 'h4', 'pre', 'table', 'ul'];
  for (const tag of blocks) {
    html = html.replace(new RegExp('<p>\\s*(<' + tag + '>)', 'g'), '$1');
    html = html.replace(new RegExp('(</' + tag + '>)\\s*</p>', 'g'), '$1');
  }
  html = html.replace(/<p>\s*<\/p>/g, '');

  return html;
}
