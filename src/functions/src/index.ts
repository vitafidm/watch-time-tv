import "./initFirebase";
import tmdbBackfillMissing from "./tmdbBackfill";
import tmdbSearch from "./tmdbSearch";

// CommonJS export so Firebase finds the function
exports.tmdbBackfillMissing = tmdbBackfillMissing;
exports.tmdbSearch = tmdbSearch;
