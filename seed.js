// Optional demo entries. Run with SEED=1 on first launch.
module.exports = function seed(db) {
  const ins = db.prepare('INSERT INTO objects(user_id,name,why,tags,url) VALUES(1,?,?,?,?)');
  const note = db.prepare('INSERT OR IGNORE INTO notes(user_id,object_id) VALUES(1,?)');
  const rows = [
    [
        "de Buyer carbon steel pan, 28 cm",
        "Seasoned once and it outcooks every nonstick pan I have owned. Made in Le Val-d'Ajol since 1830. Heavy in the right way.",
        "kitchen, carbon steel, france",
        "https://www.debuyer.com"
    ],
    [
        "Blenheim Forge Model 1 chef's knife",
        "Three friends who taught themselves to forge under a railway arch in Peckham. Blue paper steel, oak handle. The edge holds for months.",
        "kitchen, knives, london",
        "https://blenheimforge.co.uk"
    ],
    [
        "Jamieson's Shetland crewneck",
        "Wool spun on the islands from the islands' sheep. Fifteen winters in and it is still the one I reach for.",
        "wardrobe, knitwear, scotland",
        "https://www.jamiesonsofshetland.co.uk"
    ],
    [
        "Pilot Custom 823",
        "The vacuum filler holds a week of writing and the 14k nib never skips. Unremarkable to look at, which is the point.",
        "study, pens, japan",
        "https://www.pilotpen.com"
    ],
    [
        "Rimowa Original cabin",
        "Aluminium. Every dent is a trip. Buy it once.",
        "travel, luggage, germany",
        "https://www.rimowa.com"
    ],
    [
        "Mauviel M'250 copper saucepan",
        "Villedieu-les-Poêles has made copper pans since the 1200s. Responds to heat the second you touch the flame.",
        "kitchen, copper, france",
        "https://www.mauviel.com"
    ]
];
  const colls = { 'de Buyer': ['Kitchen'], 'Blenheim': ['Kitchen', 'Made in Britain'], "Jamieson's": ['Sartorial Matters', 'Made in Britain'], 'Pilot': ['Study'], 'Rimowa': ['Travel'], 'Mauviel': ['Kitchen'] };
  const ic = db.prepare('INSERT OR IGNORE INTO collections(user_id,name) VALUES(1,?)'); const gc = db.prepare('SELECT id FROM collections WHERE user_id=1 AND name=?'); const oc = db.prepare('INSERT OR IGNORE INTO object_collections(object_id,collection_id) VALUES(?,?)');
  for (const r of rows) { const id = ins.run(...r).lastInsertRowid; note.run(id); for (const [k, names] of Object.entries(colls)) if (r[0].startsWith(k)) for (const n of names) { ic.run(n); oc.run(id, gc.get(n).id); } }
};
