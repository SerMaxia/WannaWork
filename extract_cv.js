const fs = require('fs');
const path = require('path');

async function extractPDF(filePath) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  
  let fullText = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items.map(item => item.str).join(' ');
    fullText += text + '\n';
  }
  
  return fullText;
}

async function main() {
  const files = process.argv.slice(2);
  for (const file of files) {
    console.log('=== ' + path.basename(file) + ' ===');
    const text = await extractPDF(file);
    console.log(text);
    console.log('=== END ===\n');
  }
}

main().catch(console.error);
