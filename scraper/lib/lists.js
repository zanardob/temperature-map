// Parses the main ranking table from
// "List of European cities by population within city limits".
import { load } from 'cheerio';

const FOOTNOTE = /\[[^\]]*\]/g;

function cellText(cell) {
  const clone = cell.clone();
  clone.find('sup').remove();
  return clone.text().replace(/\s+/g, ' ').replace(FOOTNOTE, '').trim();
}

export function parsePopulationList(html) {
  const $ = load(html);
  let table = null;
  $('table.wikitable').each((_, candidate) => {
    if (table) return;
    const header = $(candidate).find('tr').first().text().replace(/\s+/g, ' ');
    if (/city/i.test(header) && /country/i.test(header)) table = $(candidate);
  });
  if (!table) return [];

  const rows = [];
  table.find('tr').slice(1).each((_, row) => {
    const cells = $(row).children('td,th');
    if (cells.length < 2) return;
    const name = cellText($(cells[0]));
    const country = cellText($(cells[1]));
    if (!name || !country) return;
    const article = $(cells[0]).find('a').first().attr('title') || name;
    rows.push({ name, article, country });
  });
  return rows;
}
