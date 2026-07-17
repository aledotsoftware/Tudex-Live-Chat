const fs = require('fs');
const code = fs.readFileSync('frontend/src/App.jsx', 'utf8');
const buttons = code.match(/<button[\s\S]*?<\/button>/g);
if (buttons) {
  buttons.forEach((b, i) => {
    if (!b.includes('aria-label') && !b.match(/>[^<]*[a-zA-Z0-9]+[^<]*<\/button>/)) {
      console.log('--- Missing text and aria-label:');
      console.log(b);
    }
  });
}
