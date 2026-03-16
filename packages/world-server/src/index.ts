import { startServer } from "./app.js";

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
startServer(port);
console.log(`world-server listening on ${port}`);
