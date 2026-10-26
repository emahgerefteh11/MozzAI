export interface Section { id: string; title: string; content: string; category: 'confirmed' | 'unknown' | 'uncertain' }
export interface Guide { title: string; status: 'draft'; version: string; sections: Section[] }

export function parseGuide(markdown: string, version: string): Guide {
  const text = markdown.replace(/\r\n/g, '\n');
  const sections: Section[] = [];
  let current: Section | undefined;
  let category: Section['category'] = 'confirmed';
  let collecting = false;
  for (const line of text.split('\n')) {
    if (/^## (Ten realistic|Approval|Handoff)/i.test(line)) { collecting = false; current = undefined; continue; }
    if (/^## Confirmed care/i.test(line)) { collecting = true; category = 'confirmed'; current = undefined; continue; }
    if (/^## Unanswered/i.test(line)) { collecting = true; category = 'unknown'; current = undefined; }
    if (/^## Corrections/i.test(line)) { collecting = true; category = 'uncertain'; current = undefined; }
    if (!collecting) continue;
    if (/^#{2,3} /.test(line)) {
      const title = line.replace(/^#+ /, '').trim();
      const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      current = { id, title, content: '', category };
      sections.push(current);
    } else if (current) current.content += line + '\n';
  }
  for (const section of sections) section.content = section.content.trim();
  if (!sections.some(section => section.category === 'confirmed' && section.content)) throw new Error('Guide has no confirmed care sections.');
  return { title: text.match(/^# (.+)/m)?.[1]?.trim() ?? 'Sitter care guide', status: 'draft', version, sections };
}

export function guideContext(guide: Guide): string {
  return guide.sections.map(s => `[${s.id}] ${s.title} — ${s.category}\n${s.content}`).join('\n\n');
}
