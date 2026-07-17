const fs = require('fs');
const code = fs.readFileSync('frontend/src/App.jsx', 'utf8');

const regex = /<button[\s\S]*?>[\s\S]*?<\/button>/g;
let match;
while ((match = regex.exec(code)) !== null) {
  const buttonTag = match[0];
  const innerContentMatch = buttonTag.match(/>([\s\S]*?)<\/button>/);
  if (!innerContentMatch) continue;

  const innerContent = innerContentMatch[1].trim();

  // A button might have an icon component like <PlusIcon /> inside it.
  const hasIconTag = /<[A-Z][a-zA-Z]*Icon[\s\S]*?>/.test(innerContent) || /<svg/.test(innerContent);
  const textOnly = innerContent.replace(/<[^>]+>/g, '').trim();

  const hasAriaLabel = buttonTag.includes('aria-label');

  // If it has an icon and no text, it should have an aria-label
  if (hasIconTag && textOnly === '' && !hasAriaLabel) {
    console.log('--- Missing aria-label for icon button:');
    console.log(buttonTag);
  }
}
