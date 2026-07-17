const fs = require('fs');
const code = fs.readFileSync('frontend/src/App.jsx', 'utf8');
const buttons = code.match(/<button[\s\S]*?>/g);
buttons.forEach(b => {
  if (!b.includes('aria-label') && !b.includes('children') && !b.includes('>') && !b.includes('Actualizar ahora')) {
    // console.log(b);
  }
});
