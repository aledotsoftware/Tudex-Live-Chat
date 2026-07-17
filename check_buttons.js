const fs = require('fs');
const code = fs.readFileSync('frontend/src/App.jsx', 'utf8');

const matches = [];
let regex = /<button[^>]*>[\s\S]*?<\/button>/g;
let match;
while ((match = regex.exec(code)) !== null) {
  matches.push(match[0]);
}

matches.forEach(b => {
  if (b.includes('title=') && !b.includes('aria-label')) {
    console.log(b);
    console.log("-----------------------");
  }
});
