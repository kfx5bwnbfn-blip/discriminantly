// The no-orphan invariant, read straight from the database (for tests that
// cannot call into the server). Mirrors unadoptedExplanation() and
// independentRelationship() in server.js: a Note, Mark or Itinerary outside
// its member's corpus must be explained by a truthful relationship -- a
// pending Ensemble, a Recommendation, a recommended plan it sits in, or an
// explicit relationship the member recorded (Owned, Warrant, Check-in, a
// place in an ensemble or on a stop). None of these makes it Kept.
module.exports = function orphans(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const recPlan = (itinUid, userId) => !!itinUid && !one('SELECT 1 FROM adopted_itineraries WHERE uid=?', itinUid)
    && !!one("SELECT 1 FROM recommendations WHERE target_type='itinerary' AND target_uid=? AND user_id=?", itinUid, userId);
  const explained = (type, r) => {
    if (one('SELECT 1 FROM recommendations WHERE target_type=? AND target_uid=? AND user_id=?', type, r.uid, r.user_id)) return true;
    if (type === 'object') {
      if (one(`SELECT 1 FROM provenance p JOIN ensembles e ON e.uid=p.source_ref WHERE p.entity_type='object' AND p.entity_uid=?
               AND p.action='created' AND p.source_kind='ensemble' AND e.status='pending_review' AND e.user_id=?`, r.uid, r.user_id)) return true;
      if (db.prepare(`SELECT DISTINCT i.uid FROM itinerary_stop_notes a JOIN itinerary_stops s ON s.id=a.stop_id JOIN itineraries i ON i.id=s.itinerary_id
               JOIN objects o ON o.id=a.note_id WHERE o.uid=?`).all(r.uid).some((i) => recPlan(i.uid, r.user_id))) return true;
      return !!(one(`SELECT 1 FROM ownership_assertions a WHERE a.note_uid=? AND a.user_id=? AND a.state IN ('owned','released')
               AND NOT EXISTS (SELECT 1 FROM ownership_assertions b WHERE b.supersedes=a.uid)`, r.uid, r.user_id)
        || one("SELECT 1 FROM warrants WHERE subject_type='object' AND subject_uid=? AND user_id=?", r.uid, r.user_id)
        || one('SELECT 1 FROM ensemble_components c JOIN ensembles e ON e.id=c.ensemble_id WHERE c.note_uid=? AND e.user_id=?', r.uid, r.user_id)
        || one('SELECT 1 FROM itinerary_stop_notes a JOIN objects o ON o.id=a.note_id WHERE o.uid=?', r.uid)
        || one('SELECT 1 FROM note_collections nc JOIN objects o ON o.id=nc.note_id WHERE o.uid=?', r.uid));
    }
    if (type === 'mark') {
      if (db.prepare('SELECT DISTINCT i.uid FROM itinerary_stops s JOIN itineraries i ON i.id=s.itinerary_id WHERE s.mark_uid=?').all(r.uid).some((i) => recPlan(i.uid, r.user_id))) return true;
      const c = one("SELECT source_ref FROM provenance WHERE entity_type='mark' AND entity_uid=? AND action='created' AND source_kind='itinerary'", r.uid);
      if (c && recPlan(c.source_ref, r.user_id)) return true;
      if (c && one(`SELECT 1 FROM provenance p JOIN recommendations x ON x.uid=p.entity_uid WHERE p.entity_type='recommendation'
               AND p.action='de_resolved' AND p.source_ref=? AND p.fields LIKE 'target:itinerary%' AND x.user_id=?`, c.source_ref, r.user_id)) return true;
      return !!(one("SELECT 1 FROM warrants WHERE subject_type='mark' AND subject_uid=? AND user_id=?", r.uid, r.user_id)
        || one('SELECT 1 FROM visits v JOIN marks m ON m.id=v.mark_id WHERE m.uid=? AND v.user_id=?', r.uid, r.user_id)
        || one('SELECT 1 FROM itinerary_stops WHERE mark_uid=?', r.uid));
    }
    return false;
  };
  return [['object', 'objects', 'adopted_objects'], ['mark', 'marks', 'adopted_marks'], ['itinerary', 'itineraries', 'adopted_itineraries']]
    .flatMap(([t, tab, v]) => db.prepare(`SELECT uid, user_id FROM ${tab} r WHERE NOT EXISTS (SELECT 1 FROM ${v} x WHERE x.id=r.id)`).all()
      .filter((r) => !explained(t, r)).map((r) => `${t} ${r.uid}`));
};
