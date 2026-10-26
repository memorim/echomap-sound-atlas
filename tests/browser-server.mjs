process.env.NODE_ENV="test";
const {createApp,createDb}=await import("../server.js");
createApp(createDb(":memory:")).listen(4701,"127.0.0.1");
