// src/lib/resolveShowPlay.ts
import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    where,
  } from "firebase/firestore";
  import { db } from "@/lib/firebase";
  
  /**
   * Resolve what to play for a show poster click.
   * Decision order:
   *  1) nextUpEpisodeId -> start at 0
   *  2) lastPlayedEpisodeId (+ lastPlayedPosition) if >= 10s
   *  3) first episode by (season asc, episode asc)
   *
   * Returns mediaId + startTime (seconds) + display title for the play dialog.
   */
  export async function resolveShowPlayTargetByRef(showRefPath: string) {
    // 0) Load the show doc
    const showRef = doc(db, showRefPath);
    const showSnap = await getDoc(showRef);
    if (!showSnap.exists()) {
      throw new Error("Show not found");
    }
    const s: any = showSnap.data() || {};
    const showTitle: string =
      (typeof s.showTitle === "string" && s.showTitle.trim()) ||
      (typeof s.title === "string" && s.title.trim()) ||
      "Untitled Show";
  
    // 1) nextUpEpisodeId
    if (typeof s.nextUpEpisodeId === "string" && s.nextUpEpisodeId.trim()) {
      const epId = s.nextUpEpisodeId as string;
      const epRef = doc(db, showRefPath.replace("/shows/", "/media/").replace(/\/[^/]+$/, `/${epId}`));
      const epSnap = await getDoc(epRef);
      const ep = epSnap.exists() ? (epSnap.data() as any) : null;
      const title =
        (ep?.title && String(ep.title).trim()) ||
        `${showTitle} S${ep?.season ?? "?"}E${ep?.episode ?? "?"}`;
      return { mediaId: epId, startTime: 0, title };
    }
  
    // 2) lastPlayedEpisodeId (only if we have a meaningful position)
    const lastPlayedEpisodeId: string | null =
      typeof s.lastPlayedEpisodeId === "string" && s.lastPlayedEpisodeId.trim()
        ? s.lastPlayedEpisodeId
        : null;
    const lastPlayedPosition: number =
      typeof s.lastPlayedPosition === "number" ? s.lastPlayedPosition : 0;
  
    if (lastPlayedEpisodeId && lastPlayedPosition >= 10) {
      const epRef = doc(db, showRefPath.replace("/shows/", "/media/").replace(/\/[^/]+$/, `/${lastPlayedEpisodeId}`));
      const epSnap = await getDoc(epRef);
      const ep = epSnap.exists() ? (epSnap.data() as any) : null;
      const title =
        (ep?.title && String(ep.title).trim()) ||
        `${showTitle} S${ep?.season ?? "?"}E${ep?.episode ?? "?"}`;
      return { mediaId: lastPlayedEpisodeId, startTime: Math.floor(lastPlayedPosition), title };
    }
  
    // 3) First episode (season, episode asc)
    // users/{uid}/media where showRef == showRefPath AND type == "episode"
    const mediaCol = collection(db, showRefPath.replace("/shows/", "/media/").replace(/\/[^/]+$/, ""));
    const q = query(
      mediaCol,
      where("type", "==", "episode"),
      where("showRef", "==", showRefPath),
      orderBy("season", "asc"),
      orderBy("episode", "asc"),
      limit(1)
    );
  
    const firstSnap = await getDocs(q);
    const first = firstSnap.docs[0];
    if (!first) throw new Error("No episodes found for show");
  
    const m = first.data() as any;
    const epMediaId: string = (typeof m.mediaId === "string" && m.mediaId) || first.id;
    const title =
      (m?.title && String(m.title).trim()) ||
      `${showTitle} S${m?.season ?? "?"}E${m?.episode ?? "?"}`;
    return { mediaId: epMediaId, startTime: 0, title };
  }
  