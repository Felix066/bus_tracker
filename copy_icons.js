const fs = require('fs');
const path = require('path');

const sourcePath = 'C:\\Users\\Asus\\.gemini\\antigravity-ide\\brain\\79b642d5-f45b-4b11-9274-1da009668c3a\\.user_uploaded\\media_1791094832218.jpg';
const targetDir = 'C:\\Users\\Asus\\OneDrive\\Desktop\\bus_track\\icons';

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

fs.copyFileSync(sourcePath, path.join(targetDir, 'icon-192.png'));
fs.copyFileSync(sourcePath, path.join(targetDir, 'icon-512.png'));
fs.copyFileSync(sourcePath, path.join(targetDir, 'apple-touch-icon.png'));

console.log('Icons copied successfully!');
