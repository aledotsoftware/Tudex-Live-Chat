const fs = require('fs');
const code = fs.readFileSync('frontend/src/App.jsx', 'utf8');

const regex = /<article[\s\S]*?>/g;
let match;
while ((match = regex.exec(code)) !== null) {
  const tag = match[0];
  if (tag.includes('role=') && (!tag.includes('aria-label') && !tag.includes('aria-labelledby'))) {
    console.log(tag);
  } else if (tag.includes('role={') && !tag.includes('aria-label')) {
     console.log(tag);
  }
}
