const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', '..', 'CFYL2026.xlsx');
const workbook = XLSX.readFile(filePath);

console.log('=== Sheet Names ===');
console.log(workbook.SheetNames);

workbook.SheetNames.forEach((sheetName) => {
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet);

  console.log(`\n=== ${sheetName} (${data.length} rows) ===`);

  if (data.length > 0) {
    console.log('Columns:', Object.keys(data[0]));
    console.log('First 2 rows:');
    console.log(JSON.stringify(data.slice(0, 2), null, 2));
  }
});
