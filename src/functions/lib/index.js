"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("./initFirebase");
const tmdbBackfill_1 = __importDefault(require("./tmdbBackfill"));
const tmdbSearch_1 = __importDefault(require("./tmdbSearch"));
const tmdbFixMatch_1 = __importDefault(require("./tmdbFixMatch"));
const tmdbManualSet_1 = __importDefault(require("./tmdbManualSet"));
const tmdbMedia_1 = __importDefault(require("./tmdbMedia"));
const materializeUserShows_1 = __importDefault(require("./materializeUserShows"));
const tmdbFixShow_1 = __importDefault(require("./tmdbFixShow"));
// CommonJS export so Firebase finds the function
exports.tmdbBackfillMissing = tmdbBackfill_1.default;
exports.tmdbSearch = tmdbSearch_1.default;
exports.tmdbFixMatch = tmdbFixMatch_1.default;
exports.tmdbManualSet = tmdbManualSet_1.default;
exports.tmdbMedia = tmdbMedia_1.default;
exports.materializeUserShows = materializeUserShows_1.default;
exports.tmdbFixShow = tmdbFixShow_1.default;
//# sourceMappingURL=index.js.map