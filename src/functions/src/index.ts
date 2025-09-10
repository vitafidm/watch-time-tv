import "./initFirebase";
import tmdbBackfillMissing from "./tmdbBackfill";

// CommonJS export so Firebase finds the function
exports.tmdbBackfillMissing = tmdbBackfillMissing;
