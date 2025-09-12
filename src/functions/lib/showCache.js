"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getShowFromCache = getShowFromCache;
const initFirebase_1 = require("./initFirebase");
async function getShowFromCache(tmdbShowId) {
    const ref = initFirebase_1.db.doc(`shows/${tmdbShowId}`);
    const snap = await ref.get();
    if (!snap.exists)
        return null;
    const data = snap.data();
    // ensure id is present
    return { ...data, tmdbShowId };
}
//# sourceMappingURL=showCache.js.map