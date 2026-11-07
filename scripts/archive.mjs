import { backupArchive, restoreArchive } from "../archive.js";
const [operation, source, destination] = process.argv.slice(2);
if (!source || !destination || !["backup", "restore"].includes(operation))
  throw new Error("Usage: archive.mjs backup|restore SOURCE_DIRECTORY NEW_DESTINATION_DIRECTORY");
const result = await (operation === "backup" ? backupArchive : restoreArchive)(source, destination);
console.log(JSON.stringify({ status: "ok", operation, ...result }));
