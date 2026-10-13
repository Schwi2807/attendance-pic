// Generates the FAKE sample participant lists in /samples.
// Every name, matric number and phone number here is invented.
//
//   npm run samples
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx-js-style');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Names are assembled from small invented pools so they look realistic but
// belong to nobody in particular.
const pools = {
  malayM: ['Aiman', 'Hakim', 'Farhan', 'Danial', 'Irfan', 'Amir', 'Syafiq', 'Haziq', 'Luqman', 'Ariff'],
  malayF: ['Nurul Ain', 'Siti Hajar', 'Aisyah', 'Hana', 'Zara', 'Balqis', 'Iman', 'Alya', 'Sofea', 'Damia'],
  malayFather: ['Rahman', 'Ismail', 'Abdullah', 'Hassan', 'Yusof', 'Kamal', 'Osman', 'Zainal', 'Rosli', 'Hamid'],
  chineseGiven: ['Wei Jie', 'Jun Hao', 'Kok Wai', 'Yi Ling', 'Xin Yi', 'Chee Keong', 'Mei Ling', 'Zi Xuan', 'Jia Hui', 'Kai Wen'],
  chineseFamily: ['Tan', 'Lim', 'Wong', 'Chong', 'Ong', 'Lee', 'Goh', 'Ng', 'Teh', 'Yap'],
  indianGiven: ['Kavitha', 'Priya', 'Arjun', 'Divya', 'Ravi', 'Meena', 'Suresh', 'Kiran', 'Deepa', 'Vikram'],
  indianFather: ['Subramaniam', 'Krishnan', 'Ramasamy', 'Pillai', 'Nair', 'Muthu', 'Raju', 'Selvam', 'Gopal', 'Naidu'],
};
const pick = (arr, i) => arr[i % arr.length];
const makeName = (i) => {
  const k = Math.floor(i / 6);
  switch (i % 6) {
    case 0: case 3: return `${pick(pools.malayM, k + i)} bin ${pick(pools.malayFather, k * 3 + i)}`;
    case 1: case 4: return `${pick(pools.malayF, k + i)} binti ${pick(pools.malayFather, k * 7 + i)}`;
    case 2: return `${pick(pools.chineseFamily, k * 3 + i)} ${pick(pools.chineseGiven, k + i)}`;
    default: {
      const given = pick(pools.indianGiven, k + i);
      const rel = ['Kavitha', 'Priya', 'Divya', 'Meena', 'Deepa'].includes(given) ? 'a/p' : 'a/l';
      return `${given} ${rel} ${pick(pools.indianFather, k * 3 + i)}`;
    }
  }
};
const programmes = ['Civil Engineering', 'Computer Science', 'Mechanical Engineering', 'Accounting', 'Architecture', 'Biotechnology'];
const groups = ['G1', 'G2', 'G3', 'G4'];

const rows = [];
for (let i = 0; i < 60; i++) {
  rows.push({
    No: i + 1,
    Name: makeName(i),
    'Matric No': `AD25${String(i + 1).padStart(4, '0')}`,
    Programme: programmes[i % programmes.length],
    Group: groups[Math.floor(i / 15)],
    Phone: `012-555 ${String(1000 + i * 37).slice(-4)}`,
  });
}

const headers = Object.keys(rows[0]);
const esc = (v, d) => {
  const s = String(v);
  return s.includes(d) || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
};

// CSV (comma)
writeFileSync(
  join(root, 'samples', 'participants_sample.csv'),
  [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h], ',')).join(','))].join('\r\n') + '\r\n',
);

// TXT (tab-delimited)
writeFileSync(
  join(root, 'samples', 'participants_sample.txt'),
  [headers.join('\t'), ...rows.map((r) => headers.map((h) => r[h]).join('\t'))].join('\n') + '\n',
);

// XLSX — also carries a "Remarks" column so the importer's column reuse can be seen.
const xRows = rows.map((r, i) => ({ ...r, Remarks: i === 4 ? 'Vegetarian meal' : i === 17 ? 'Motion sickness — front seat' : '' }));
const ws = XLSX.utils.json_to_sheet(xRows, { header: [...headers, 'Remarks'] });
ws['!cols'] = [{ wch: 5 }, { wch: 30 }, { wch: 12 }, { wch: 24 }, { wch: 8 }, { wch: 14 }, { wch: 28 }];
for (let c = 0; c < headers.length + 1; c++) {
  const ref = XLSX.utils.encode_cell({ r: 0, c });
  ws[ref].s = { font: { bold: true } };
}
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Participants');
XLSX.writeFile(wb, join(root, 'samples', 'participants_sample.xlsx'));

console.log(`Wrote ${rows.length} fake participants to samples/ (csv, txt, xlsx)`);
