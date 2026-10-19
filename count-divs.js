const fs = require('fs');

const files = [
  'src/components/BonDAchatPrintModal.tsx',
  'src/components/BonDeLivraisonPrintModal.tsx',
  'src/components/BonDeSortiePrintModal.tsx'
];

for(const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  let body = content.substring(content.indexOf('<table className="w-full border-none">'), content.lastIndexOf('</td>'));
  let opens = (body.match(/<div[^>]*>/g) || []).length;
  let selfCloses = (body.match(/<div[^>]*\/>/g) || []).length;
  let closes = (body.match(/<\/div>/g) || []).length;

  console.log(file, 'Between <table> and </td>:');
  console.log('Opens:', opens);
  console.log('Self closes:', selfCloses);
  console.log('Closes:', closes);
  console.log('Difference:', opens - selfCloses - closes);
}
