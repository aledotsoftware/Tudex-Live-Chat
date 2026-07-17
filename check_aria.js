const fs = require('fs');
const code = fs.readFileSync('frontend/src/App.jsx', 'utf8');

let pos = 0;
while ((pos = code.indexOf('<button', pos)) !== -1) {
  const endPos = code.indexOf('</button>', pos);
  if (endPos === -1) break;
  const buttonStr = code.substring(pos, endPos + 9);

  if (!buttonStr.includes('aria-label')) {
    // Check if it has any text content
    const contentMatch = buttonStr.match(/>([^<]+)<\/button>/);
    let hasText = false;
    if (contentMatch) {
      const text = contentMatch[1].trim();
      if (text.length > 0 && !['❌', '✕', '✨', '😊'].includes(text)) {
        hasText = true;
      }
    }

    // Some buttons have icons and text, like `><SaveIcon /> Guardar IA</button>`
    const innerContentMatch = buttonStr.match(/>([\s\S]*?)<\/button>/);
    if (innerContentMatch) {
      const innerContent = innerContentMatch[1];
      // strip other tags
      const textOnly = innerContent.replace(/<[^>]+>/g, '').trim();
      if (textOnly.length > 0 && !['❌', '✕', '✨', '😊', '↓ Ir al último', 'Responder'].includes(textOnly)) {
        hasText = true;
      }
    }

    if (!hasText) {
      console.log('--- Needs aria-label:');
      console.log(buttonStr);
    }
  }
  pos = endPos + 9;
}
