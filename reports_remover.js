// rm ./cookie-report*.md
const fs = require("fs");
const reportFiles = fs.readdirSync(".").filter(file => file.startsWith("cookie-report") && file.endsWith(".md"));
reportFiles.forEach(file => {
    fs.unlinkSync(file);
    console.log(`Removed file: ${file}`);
});
console.log("Existing reports removed.");