import "./initFirebase";
import tmdbBackfillMissing from "./tmdbBackfill";
import tmdbSearch from "./tmdbSearch";
import tmdbFixMatch from "./tmdbFixMatch";
import tmdbManualSet from "./tmdbManualSet";

// CommonJS export so Firebase finds the function
exports.tmdbBackfillMissing = tmdbBackfillMissing;
exports.tmdbSearch = tmdbSearch;
exports.tmdbFixMatch = tmdbFixMatch;
exports.tmdbManualSet = tmdbManualSet;
