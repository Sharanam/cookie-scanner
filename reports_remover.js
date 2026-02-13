// rm ./<cookie-report>*.md
const fs = require("fs");
require("dotenv").config();
const output = process.env.OUTPUT || "cookie-report";
const reportFiles = fs.readdirSync(".").filter(file => file.startsWith(output) && file.endsWith(".md"));
let totalRemoved = 0;
reportFiles.forEach(file => {
    fs.unlinkSync(file);
    console.log(`Removed file: ${file}`);
    totalRemoved += 1;
});
console.log(`Existing reports removed: ${totalRemoved} file(s).`);