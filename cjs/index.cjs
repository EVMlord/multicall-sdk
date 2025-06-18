// Re-export everything from the ESM build
module.exports = require("../dist/index.js");
module.exports.default = module.exports; // so `require().default` also works
