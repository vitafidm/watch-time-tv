import "./initFirebase";
import tmdbBackfillMissing from "./tmdbBackfill";
import tmdbSearch from "./tmdbSearch";
import tmdbFixMatch from "./tmdbFixMatch";
import tmdbManualSet from "./tmdbManualSet";
import tmdbMedia from "./tmdbMedia";
import materializeUserShows from "./materializeUserShows";


// CommonJS export so Firebase finds the function
exports.tmdbBackfillMissing = tmdbBackfillMissing;
exports.tmdbSearch = tmdbSearch;
exports.tmdbFixMatch = tmdbFixMatch;
exports.tmdbManualSet = tmdbManualSet;
exports.tmdbMedia = tmdbMedia;
exports.materializeUserShows = materializeUserShows;
