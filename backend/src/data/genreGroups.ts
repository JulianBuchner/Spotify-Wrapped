// ---------------------------------------------------------------------------
// Genre grouping rules: Spotify micro-genres -> readable groups for the "Eras"
// streamgraph and the "Genres" strip, on two levels: every group has a `parent`
// in BROAD_GROUPS, the coarse view that keeps the big scenes apart (hardstyle,
// EDM & dance, techno, bass, hip hop, pop, rock) and folds the rest together.
// Rules were FIRST DRAFTED from the real genre frequency table
// of this listener (2026-10-24, 209k plays, 4,693 primary artists, 3,009 of
// them with genres): the comment on each rule names the genres (with hours of
// listened time) it was written for. Review the names and assignments once,
// then `npm run enrich:catalog -- --reassign`.
//
// Semantics (groupForArtist): an ARTIST_OVERRIDES entry by name wins; else the
// FIRST rule in GENRE_GROUPS whose regex matches ANY of the artist's genres
// wins — so the order below is the priority, not the genre order Spotify
// gives. Specific scenes come first, broad ones (pop, catch-all) last.
// ---------------------------------------------------------------------------

export interface GenreGroup {
  key: string;
  label: string;
  match: RegExp;
  /** key in BROAD_GROUPS */
  parent: string;
}

export interface BroadGroup {
  key: string;
  label: string;
}

/** The coarse level: order = display order, also the colour order. */
export const BROAD_GROUPS: BroadGroup[] = [
  { key: "hard", label: "Hardstyle & hardcore" },
  { key: "dance", label: "EDM & dance" },
  { key: "techno", label: "Techno & house" },
  { key: "bass", label: "Bass music" },
  { key: "hiphop", label: "Hip hop & rap" },
  { key: "pop", label: "Pop & Schlager" },
  { key: "rock", label: "Rock & indie" },
  { key: "other", label: "World, soundtracks & other" },
];

/** First matching rule wins — order = priority. Catch-alls stay last. */
export const GENRE_GROUPS: GenreGroup[] = [
  {
    // hardstyle 2480 h, frenchcore 1637 h, hardcore 1484 h, happy hardcore 354 h,
    // hardcore techno 141 h, gabber 75 h, speedcore 32 h (+ rawstyle, uptempo, jumpstyle,
    // terrorcore). "hardcore hip hop" / "hardcore punk" are excluded.
    key: "hardstyle",
    parent: "hard",
    label: "Hardstyle & hardcore",
    match: /hardstyle|rawstyle|frenchcore|hardcore(?! hip hop| punk)|uptempo|jumpstyle|gabber|speedcore|terrorcore|happy hardcore|hard dance/,
  },
  {
    // trance 450 h, progressive trance 353 h, psytrance 232 h (+ goa, uplifting, vocal trance).
    // Before EDM so Armin van Buuren (trance, …, edm) lands here — so does Tiësto (edm, trance).
    key: "trance",
    parent: "dance",
    label: "Trance & psytrance",
    match: /trance|psytrance|\bgoa\b/,
  },
  {
    // melbourne bounce 491 h, bounce 70 h. Before EDM: Timmy Trumpet (melbourne bounce, big room).
    key: "bounce",
    parent: "dance",
    label: "Melbourne bounce",
    match: /bounce/,
  },
  {
    // hypertechno 274 h (+ hyper techno). Split out of techno on request: it is its own scene
    // (pop-song hypertechno remixes), so it comes BEFORE the techno rule.
    key: "hypertechno",
    parent: "techno",
    label: "Hypertechno",
    match: /hypertechno|hyper techno/,
  },
  {
    // techno 179 h, hard techno 131 h, tekno 117 h, acid techno 40 h,
    // minimal techno 26 h, melodic techno 16 h; house 28 h, deep house 23 h, tech house 20 h,
    // g-house 32 h, afro/latin/french/melodic/hard house, uk garage, bassline. Before EDM so a
    // techno act that also carries the generic "edm" tag stays here. The EDM-flavoured houses
    // (future/slap/bass/tropical/electro/progressive/stutter house) are matched by the EDM rule
    // below because that rule lists them explicitly — but since THIS rule comes first, plain
    // `house` must not swallow them: the negative lookbehind keeps them out.
    key: "techno",
    parent: "techno",
    label: "Techno & house",
    match: /techno|tekno|schranz|\bacid\b|minimal|(?<!future |slap |bass |tropical |electro |progressive |stutter |big room )house|uk garage|bassline|rave/,
  },
  {
    // drum and bass 153 h, melodic bass 150 h, dubstep 146 h, drumstep 130 h, future bass 244 h,
    // chillstep 49 h, liquid funk 32 h, riddim 5 h, deathstep 5 h, bass music 7 h (+ jungle,
    // neurofunk, brostep). Before EDM: ILLENIUM (melodic bass, future bass, edm), Fox Stevenson.
    key: "bass",
    parent: "bass",
    label: "Drum & bass, dubstep & bass",
    match: /drum and bass|drum & bass|\bdnb\b|drumstep|dubstep|brostep|chillstep|deathstep|liquid funk|neurofunk|jungle|riddim|melodic bass|future bass|bass music|\bbass\b(?! house)/,
  },
  {
    // edm 1882 h, big room 1428 h, slap house 736 h, future house 337 h, progressive house 334 h,
    // electro house 254 h, tropical house 198 h, stutter house 83 h, bass house 69 h, edm trap
    // 53 h, brazilian bass 50 h, moombahton 18 h, dance pop 5 h, russelåter 6 h (Norwegian russ
    // party EDM). "electronica" (658 h) is only carried by big-room acts (KSHMR, DVLM, Hardwell,
    // Garrix) and is left to the catch-all.
    key: "edm",
    parent: "dance",
    label: "EDM & big room",
    match: /\bedm\b|big room|slap house|future house|progressive house|electro house|tropical house|stutter house|bass house|brazilian bass|moombahton|dance pop|festival|complextro|dutch house|russel/,
  },
  {
    // eurodance 88 h, italo dance 83 h, europop 24 h, nightcore 48 h, epadunk 18 h (Swedish
    // car-party dance) (+ hands up, hi-nrg). After EDM on purpose: Gabry Ponte (italo dance,
    // slap house) stays EDM.
    key: "eurodance",
    parent: "dance",
    label: "Eurodance & hands up",
    match: /eurodance|italo dance|italo disco|europop|hands up|nightcore|hi-nrg|hi nrg|epadunk/,
  },
  {
    // schlagerparty 318 h, schlager 114 h, polka 2 h, hollands 2 h (+ partyschlager, après-ski,
    // ballermann, volksmusik, volkstümlich). Before "german" so a schlager act with a german-pop
    // tag stays here (Fäaschtbänkler: schlagerparty, schlager).
    key: "schlager",
    parent: "pop",
    label: "Schlager & party",
    match: /schlager|apr[eè]s.?ski|ballermann|mallorca|volksmusik|volkst[uü]mlich|polka|hollands|carnaval|karneval/,
  },
  {
    // german hip hop 415 h (+ deutschrap, german trap, german drill, german cloud rap).
    // Before the generic hip hop rule so Deutschrap stays German.
    key: "germanrap",
    parent: "hiphop",
    label: "German rap",
    match: /german hip hop|deutschrap|german trap|german drill|german cloud rap|german rap/,
  },
  {
    // german pop 282 h, german indie 279 h, german indie pop 268 h, neue deutsche welle 46 h
    // (+ austropop, german rock, german singer-songwriter). CRO and GReeeN carry german hip hop
    // too and land in German rap above; everything else German lands here.
    key: "germanpop",
    parent: "pop",
    label: "German pop & indie",
    match: /german|deutsch|austropop|neue deutsche welle|\bndw\b/,
  },
  {
    // rap 36 h, hip hop 30 h, christian hip hop 28 h, emo rap 17 h, melodic rap 16 h, phonk 19 h,
    // brazilian/drift phonk 20 h, drill 10 h, uk drill 9 h, cloud rap 4 h, g-funk 3 h, trap 2 h
    // (+ grime, horrorcore, boom bap, gangster rap). "rap rock"/"rap metal"/"trap metal" fall
    // through to rock, "trap latino" to latin.
    key: "hiphop",
    parent: "hiphop",
    label: "Hip hop & rap",
    match: /hip hop|hip-hop|\brap\b(?! rock| metal)|drill|\btrap\b(?! latino| metal)|grime|phonk|g-funk|horrorcore|boom bap|crunk/,
  },
  {
    // glam metal 32 h (Bon Jovi), rap rock 19 h, christian rock 18 h, rock 17 h, emo 14 h,
    // pop punk 13 h, punk 10 h, nu metal 10 h, alternative metal 10 h, rap metal 9 h, trap metal
    // 9 h, skate punk 6 h, hard rock 3 h, classic rock 2 h, medieval metal 1 h (+ grunge,
    // screamo, metalcore). "emo rap" is matched by hiphop above.
    key: "rock",
    parent: "rock",
    label: "Rock & metal",
    match: /\brock\b|metal|punk|grunge|\bemo\b|screamo|hardcore punk|post-hardcore|industrial/,
  },
  {
    // indie 1 h, alternative rock 4 h, indie folk, folk pop 2 h, folk, britpop, singer-songwriter
    // 5 h, dream pop, shoegaze, country 2 h, acoustic/outlaw country 2 h, bluegrass, southern
    // gothic. After rock so "indie rock"/"alternative metal" count as rock.
    key: "indie",
    parent: "rock",
    label: "Indie & alternative",
    match: /indie|alternative|folk|britpop|shoegaze|singer-songwriter|bedroom|country|bluegrass|newgrass|americana|southern gothic/,
  },
  {
    // reggaeton 17 h, trap latino 15 h, latin pop 6 h, latin 3 h, corrido/banda/sierreño/música
    // mexicana 3 h, urbano latino 1 h, agronejo 4 h, bhangra 8 h, bollywood/hindi/kannada pop 5 h,
    // afrobeats, afropop, dancehall 3 h, soca 3 h, k-pop 8 h, anime 6 h (+ cumbia, bachata,
    // sertanejo, salsa, dembow, desi, punjabi, j-pop, turkish …). World = everything non-English
    // that is not German.
    key: "latin",
    parent: "other",
    label: "Latin & world",
    match: /reggaeton|latin|urbano|corrido|banda|sierre|mexican|cumbia|bachata|salsa|dembow|sertanejo|agronejo|brazilian|brasil|funk carioca|afrobeat|afropop|amapiano|dancehall|soca|bhangra|bollywood|hindi|kannada|punjabi|desi|tamil|telugu|k-pop|j-pop|anime|turkish|arab|russian|french|italian|spanish|swedish|norwegian|finnish|danish|dutch|polish|nederpop|hollands|reggae|zouk|kuduro|native american/,
  },
  {
    // pop 27 h, art pop 10 h, synthpop 9 h, soft pop 9 h, hyperpop 8 h, r&b 3 h, dark r&b 2 h,
    // doo-wop, disco 1 h, nu disco 5 h, electro swing 24 h, swing music 7 h, boy band, soul.
    // Last of the "real" genres: anything else that is pop-ish.
    key: "pop",
    parent: "pop",
    label: "Pop",
    match: /pop|r&b|soul|disco|swing|boy band|funk|adult standards|easy listening|oldies/,
  },
  {
    // soundtrack 1 h, score 1 h, orchestral 1 h, electronic classical 3 h, gregorian chant 1 h,
    // medieval 1 h, sea shanties 7 h, christmas 3 h, children's music 2 h, comedy 3 h, lounge
    // 16 h, chillwave 5 h, ambient, dark ambient, new age 1 h, lo-fi 1 h (+ piano, classical,
    // video game, epic, trailer, meditation, sleep).
    key: "soundtrack",
    parent: "other",
    label: "Soundtracks, classical & chill",
    match: /soundtrack|score|classical|orchestr|piano|gregorian|medieval|celtic|shant|christmas|children|comedy|lounge|chill|ambient|new age|lo-fi|lofi|downtempo|meditation|sleep|video game|epic|trailer|opera|choir|baroque/,
  },
  {
    // CATCH-ALL for electronic leftovers: electronica 658 h (big-room acts that also carry
    // edm/big room are already EDM), electronic 39 h, electro 5 h, witch house, synthwave,
    // darkwave 7 h, ebm 7 h, breakbeat, idm, glitch, dance. Must stay last.
    key: "electronic",
    parent: "dance",
    label: "Other electronic",
    match: /electro|dance|house|synth|wave|\bebm\b|breakbeat|breaks|big beat|trip hop|\bidm\b|glitch|\bdj\b|club|hardbass|hard bass|step|core\b/,
  },
];

/**
 * Artists whose Spotify genres are empty or wrong: artist name (exactly as Spotify spells
 * it, = Artist.name) -> group key. An override always beats the rules.
 *
 * Written for the top 40 artists by listened time that had NO group after the rules above
 * (all of them have an empty `genres` array from Spotify; together 12.5 % of all listened
 * time, the top 30 alone 11.3 %). Hours = all-time listened time on the local copy.
 * `// TODO review` = a guess from the artist's name, known style or the tracks in the play
 * log (named in the comment); the others are well-known acts.
 */
export const ARTIST_OVERRIDES: Record<string, string> = {
  "Alan Walker": "edm", // 334 h — Faded/Alone; Spotify returns [] for him
  "HBz": "edm", // 149 h — TODO review: German duo, hardstyle/bounce-flavoured pop remixes ("All the Things She Said – HBz Version"); alternatives: bounce, hardstyle
  "Antrikc": "edm", // 59 h — TODO review: "Only Time", "Phase One" (hardstyle remixes)
  "NEFFEX": "hiphop", // 53 h — TODO review: rap-rock ("Numb", "Rumors", "Fight Back"); alternative: rock
  "We Rabbitz": "hardstyle", // 45 h — TODO review: "Alone" (hardstyle remix of Alan Walker), pop-song hardstyle remixes
  "Unknown Brain": "edm", // 42 h — NCS act ("Perseus", "Superhero")
  "The Chainsmokers": "edm", // 39 h
  "K-391": "edm", // 37 h — Alan Walker's co-producer
  "DJ Johnny SA": "edm", // 35 h — TODO review: "Reality", "Dreamland" (hardstyle remixes of pop songs)
  "Rene Rodrigezz": "edm", // 32 h — Austrian DJ ("Replay")
  "Benjamin Zane": "hardstyle", // 31 h — TODO review: 508 of 510 plays are "Winter Night – Chris Cage Hardstyle Mix Edit"
  "Lost Sky": "edm", // 29 h — NCS act ("Fearless", "Dreams pt. II")
  "AJR": "pop", // 28 h — TODO review: indie pop; alternative: indie
  "Snakehips": "edm", // 24 h — "Don't Leave – Gryffin Remix" (411 of 411 plays)
  "Matzx": "edm", // 23 h — TODO review: "Waves", "Unseen World" (euphoric hardstyle)
  "Halsey": "pop", // 22 h
  "Ellie Goulding": "pop", // 21 h
  "Toby Romeo": "edm", // 21 h — Austrian DJ (slap house)
  "Kid Cudi": "hiphop", // 20 h
  "Tujamo": "edm", // 20 h
  "Unlike Pluto": "edm", // 19 h — TODO review: electronic/alt ("Worst in Me", "Ladida"); alternative: pop
  "SHAED": "pop", // 19 h — TODO review: indie pop ("Trampoline"); alternative: indie
  "Carnage": "edm", // 17 h — festival trap / big room ("Toca", "Psy Or Die")
  "Sub Urban": "pop", // 16 h — TODO review: alt pop ("Cradles")
  "Arden Jones": "pop", // 16 h — TODO review: pop/hip-hop crossover
  "Imagine Dragons": "rock", // 15 h
  "Hi-Rez": "hiphop", // 14 h — "3 Foot Tall"
  "PABLO BENDR": "hardstyle", // 14 h — TODO review: "Apologize (Remix)" (hardstyle/hypertechno remix); alternative: techno
  "OneRepublic": "pop", // 14 h
  "Sia": "pop", // 14 h
  "Tream": "schlager", // 14 h — TODO review: Austrian party pop ("LEBENSLANG – HBz Remix", "EURODANCE"); alternative: german
  "Axel Thesleff": "bass", // 14 h — TODO review: "Bad Karma" (trap/bass); alternative: edm
  "Arman Cekin": "edm", // 14 h — TODO review: "You Don't Know Me" (tropical house)
  "DJ Selecta": "hardstyle", // 13 h — TODO review: "Irish Voices" (hardstyle)
  "Matthew Koma": "pop", // 13 h
  "Meiko": "bounce", // 13 h — TODO review: only "Leave The Lights On – Will Sparks Remix" (Melbourne bounce)
  "Leony": "pop", // 13 h — TODO review: German dance pop ("I Can Feel"); alternative: edm
  "Twenty One Pilots": "rock", // 13 h — TODO review: alternative; alternative: indie
  "Diamond Eyes": "bass", // 12 h — TODO review: NCS melodic dubstep/future bass ("Flutter", "23")
  "Axwell /\\ Ingrosso": "edm", // 12 h
};

/** Parent (broad) key of a group key; unknown keys map to "other". */
export function broadFor(groupKey: string): string {
  return GENRE_GROUPS.find((g) => g.key === groupKey)?.parent ?? "other";
}

/** Override by name first; else the first rule (in order) that matches ANY genre; else null. */
export function groupForArtist(name: string, genres: string[]): string | null {
  const override = ARTIST_OVERRIDES[name];
  if (override) return override;
  for (const rule of GENRE_GROUPS) {
    for (const g of genres) {
      if (rule.match.test(g)) return rule.key;
    }
  }
  return null;
}
