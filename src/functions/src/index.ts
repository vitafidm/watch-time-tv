import "./initFirebase";
import tmdbBackfillMissing from "./tmdbBackfill";
import tmdbSearch from "./tmdbSearch";
import tmdbFixMatch from "./tmdbFixMatch";

// CommonJS export so Firebase finds the function
exports.tmdbBackfillMissing = tmdbBackfillMissing;
exports.tmdbSearch = tmdbSearch;
exports.tmdbFixMatch = tmdbFixMatch;
