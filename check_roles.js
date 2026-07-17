const fs = require('fs');
const code = fs.readFileSync('frontend/src/App.jsx', 'utf8');

const regex = /role="button"[\s\S]*?>/g;
let match;
while ((match = regex.exec(code)) !== null) {
  const tag = match[0];
  if (!tag.includes('aria-label') && !tag.includes('aria-labelledby')) {
    console.log("Missing aria-label on element with role=button:");
    console.log(tag);
  }
}
