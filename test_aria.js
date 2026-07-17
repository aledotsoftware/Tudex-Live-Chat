const fs = require('fs');
const code = fs.readFileSync('frontend/src/App.jsx', 'utf8');

const regex = /<button[\s\S]*?>[\s\S]*?<\/button>/g;
let match;
while ((match = regex.exec(code)) !== null) {
  const buttonTag = match[0];
  if (buttonTag.includes('title="Eliminar"') && !buttonTag.includes('aria-label')) {
     console.log("Found title=Eliminar but no aria-label? " + buttonTag.includes('aria-label'));
     console.log(buttonTag);
  }
}
