import { Fragment, useState } from 'react';
import { Button, Icon } from './ui';

function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/g);
  return <>{parts.map((part, index) => {
    if (/^`[^`]+`$/.test(part)) return <code key={index}>{part.slice(1, -1)}</code>;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
    if (link) { const safe = /^(https?:\/\/|mailto:)/i.test(link[2]); return safe ? <a key={index} href={link[2]} target="_blank" rel="noreferrer noopener">{link[1]} <span aria-label="opens in a new tab">↗</span></a> : <Fragment key={index}>{link[1]}</Fragment>; }
    return <Fragment key={index}>{part}</Fragment>;
  })}</>;
}
function CodeBlock({ language, code }: { language: string; code: string }) { const [copied, setCopied] = useState(false); const copy = async () => { await navigator.clipboard?.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }; return <div className="code-block"><div><span>{language || 'text'}</span><Button variant="ghost" onClick={copy} aria-label="Copy code"><Icon name="copy" size={15} /> {copied ? 'Copied' : 'Copy'}</Button></div><pre><code>{code}</code></pre></div>; }

export function SafeMarkdown({ content }: { content: string }) {
  const nodes: JSX.Element[] = []; const lines = content.replace(/\r/g, '').split('\n'); let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const fence = line.match(/^```([^\s]*)\s*$/);
    if (fence) { const language = fence[1]; const code: string[] = []; index++; while (index < lines.length && !lines[index].startsWith('```')) code.push(lines[index++]); if (index < lines.length) index++; nodes.push(<CodeBlock key={`c-${index}`} language={language} code={code.join('\n')} />); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { const Tag = `h${heading[1].length}` as 'h1' | 'h2' | 'h3'; nodes.push(<Tag key={`h-${index}`}><Inline text={heading[2]} /></Tag>); index++; continue; }
    if (line.includes('|') && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])) {
      const cells = (value: string) => value.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
      const headers = cells(line); index += 2; const rows: string[][] = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) rows.push(cells(lines[index++]));
      nodes.push(<div className="markdown-table" key={`t-${index}`}><table><thead><tr>{headers.map((header, col) => <th key={col}><Inline text={header} /></th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, col) => <td key={col}><Inline text={row[col] ?? ''} /></td>)}</tr>)}</tbody></table></div>); continue;
    }
    if (/^[-*]\s+/.test(line)) { const list: string[] = []; while (index < lines.length && /^[-*]\s+/.test(lines[index])) list.push(lines[index++].replace(/^[-*]\s+/, '')); nodes.push(<ul key={`l-${index}`}>{list.map((item, i) => <li key={i}><Inline text={item} /></li>)}</ul>); continue; }
    if (/^\d+\.\s+/.test(line)) { const list: string[] = []; while (index < lines.length && /^\d+\.\s+/.test(lines[index])) list.push(lines[index++].replace(/^\d+\.\s+/, '')); nodes.push(<ol key={`o-${index}`}>{list.map((item, i) => <li key={i}><Inline text={item} /></li>)}</ol>); continue; }
    if (line.trim() === '') { index++; continue; }
    const paragraph: string[] = [line]; index++; while (index < lines.length && lines[index].trim() && !/^```|^(#{1,3})\s|^[-*]\s+|^\d+\.\s+/.test(lines[index])) paragraph.push(lines[index++]); nodes.push(<p key={`p-${index}`}><Inline text={paragraph.join(' ')} /></p>);
  }
  return <div className="markdown">{nodes}</div>;
}
