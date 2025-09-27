"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getShowFromCache = getShowFromCache;
exports.getShowFromCacheOrTMDB = getShowFromCacheOrTMDB;
const initFirebase_1 = require("./initFirebase");
const tmdbClient_1 = require("./tmdbClient");
const admin = __importStar(require("firebase-admin"));
async function getShowFromCache(tmdbShowId) {
    const ref = initFirebase_1.db.doc(`shows/${tmdbShowId}`);
    const snap = await ref.get();
    if (!snap.exists)
        return null;
    const data = snap.data();
    // ensure id is present
    return { ...data, tmdbShowId, updatedAt: data.updatedAt };
}
async function getShowFromCacheOrTMDB(tmdbShowId) {
    const cached = await getShowFromCache(tmdbShowId);
    if (cached) {
        return cached;
    }
    const details = await (0, tmdbClient_1.tvDetails)(tmdbShowId);
    if (!details) {
        return null;
    }
    const showData = {
        tmdbShowId: details.id,
        title: details.name,
        overview: details.overview,
        genres: (details.genres || []).map((g) => g.name),
        posterUrl: (0, tmdbClient_1.posterUrl)(details.poster_path, 'w500'),
        backdropUrl: (0, tmdbClient_1.backdropUrl)(details.backdrop_path, 'original'),
        firstAirDate: details.first_air_date,
    };
    const newDoc = {
        ...showData,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await initFirebase_1.db.doc(`shows/${tmdbShowId}`).set(newDoc);
    return newDoc;
}
