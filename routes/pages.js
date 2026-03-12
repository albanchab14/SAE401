const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../src/config/database');

// --- FONCTIONS OUTILS ---
async function getRealArtistImage(artistName) {
    try {
        const cleanName = artistName.split(',')[0].split('&')[0].trim();
        const resp = await axios.get(`https://api.deezer.com/search/artist?q=${encodeURIComponent(cleanName)}`);
        if (resp.data && resp.data.data && resp.data.data.length > 0) {
            let img = resp.data.data[0].picture_xl;
            if (img && !img.includes('/images/artist//')) return img;
        }
    } catch (e) {}
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(artistName)}&background=d946ef&color=fff&size=500`;
}

function timeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return "Il y a " + Math.floor(interval) + " an" + (Math.floor(interval) > 1 ? "s" : "");
    interval = seconds / 2592000;
    if (interval > 1) return "Il y a " + Math.floor(interval) + " mois";
    interval = seconds / 86400;
    if (interval > 1) return "Il y a " + Math.floor(interval) + " jour" + (Math.floor(interval) > 1 ? "s" : "");
    interval = seconds / 3600;
    if (interval > 1) return "Il y a " + Math.floor(interval) + " h";
    interval = seconds / 60;
    if (interval > 1) return "Il y a " + Math.floor(interval) + " min";
    return "À l'instant";
}

function formatNumber(numStr) {
    let num = parseInt(numStr, 10);
    if (isNaN(num)) return "0";
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace('.', ',') + " M";
    return num.toLocaleString('fr-FR');
}

async function getItemComments(itemId, itemType, userId) {
    try {
        const [comments] = await db.query(`
            SELECT c.*, u.pseudo, u.avatar, 
                   (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id) as total_likes,
                   (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id AND user_id = ?) as user_liked
            FROM commentaires c 
            JOIN users u ON c.user_id = u.id 
            WHERE c.music_item_id = ? AND c.item_type = ? 
            ORDER BY c.date_commentaire DESC
        `, [userId || 0, itemId, itemType]);
        comments.forEach(c => c.time_ago = timeAgo(c.date_commentaire));
        return comments;
    } catch (e) { return []; }
}

function getRatingStats(comments) {
    let total = comments.length;
    if (total === 0) return { avg: 0, counts: {1:0, 2:0, 3:0, 4:0, 5:0}, pct: {1:0, 2:0, 3:0, 4:0, 5:0}, total: 0 };
    let sum = 0; let counts = {1:0, 2:0, 3:0, 4:0, 5:0};
    comments.forEach(c => {
        let n = parseInt(c.note) || 0;
        if (n >= 1 && n <= 5) { counts[n]++; sum += n; }
    });
    let avg = (sum / total).toFixed(1);
    let pct = {
        5: total > 0 ? Math.round((counts[5]/total)*100) : 0,
        4: total > 0 ? Math.round((counts[4]/total)*100) : 0,
        3: total > 0 ? Math.round((counts[3]/total)*100) : 0,
        2: total > 0 ? Math.round((counts[2]/total)*100) : 0,
        1: total > 0 ? Math.round((counts[1]/total)*100) : 0
    };
    return { avg, counts, pct, total };
}

// --- ROUTES ---

router.get('/', async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;
        const [dbArtists] = await db.query("SELECT * FROM featured_artists ORDER BY rang ASC LIMIT 6");
        let topArtists = [];
        
        for (let a of dbArtists) {
            let listenersFormatted = "0";
            try {
                const infoResp = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=artist.getInfo&artist=${encodeURIComponent(a.api_artist_id)}&api_key=${API_KEY}&format=json`);
                if (infoResp.data.artist) {
                    listenersFormatted = formatNumber(infoResp.data.artist.stats.listeners);
                }
            } catch(e) {}
            topArtists.push({
                name: a.api_artist_id, listeners: listenersFormatted, image: await getRealArtistImage(a.api_artist_id),
                accroche: a.accroche || `Découvrez l'univers de ${a.api_artist_id}.`
            });
        }

        const heroArtist = topArtists.length > 0 ? topArtists[0] : null;

        let initialMatch = [];
        try {
            const matchTags = ['pop', 'rock', 'hip-hop', 'electronic', 'indie', 'alternative', 'rnb', 'jazz'];
            const randTag = matchTags[Math.floor(Math.random() * matchTags.length)];
            const randPage = Math.floor(Math.random() * 10) + 1;
            const respMatch = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=tag.gettopalbums&tag=${randTag}&api_key=${API_KEY}&format=json&limit=20&page=${randPage}`);
            let matchAlbums = respMatch.data.albums.album || [];
            matchAlbums = matchAlbums.filter(a => a.image && a.image[3]['#text'] && !a.image[3]['#text'].includes('2a96cbd8'));
            initialMatch = matchAlbums.sort(() => 0.5 - Math.random()).slice(0, 3).map(alb => ({
                title: alb.name, artist: alb.artist.name, image: alb.image[3]['#text']
            }));
        } catch(e) {}

        res.render('index.njk', { topArtists, heroArtist, initialMatch, page: 'home' });
    } catch (e) { res.status(500).send("Erreur Accueil"); }
});

router.get('/search', async (req, res) => {
    try {
        const { q, type, tag, years } = req.query;
        const API_KEY = process.env.LASTFM_API_KEY;
        const searchQuery = q ? q.trim() : "";
        const currentType = type || "Album";
        let results = [];

        if (searchQuery !== "") {
            if (currentType === "Artiste") {
                const resp = await axios.get(`https://api.deezer.com/search/artist?q=${encodeURIComponent(searchQuery)}&limit=15`);
                let rawArtists = resp.data.data || [];
                rawArtists = rawArtists.filter(a => !((a.name.toLowerCase().includes('&') || a.name.toLowerCase().includes(' feat')) && !searchQuery.toLowerCase().includes('&')));
                
                results = await Promise.all(rawArtists.map(async a => {
                    let img = a.picture_xl;
                    if (!img || img.includes('/images/artist//')) img = `https://ui-avatars.com/api/?name=${encodeURIComponent(a.name)}&background=d946ef&color=fff&size=300`;
                    let rating = null;
                    try {
                        const [avgRow] = await db.query("SELECT AVG(note) as avgNote FROM commentaires WHERE music_item_id = ? AND item_type = 'artist'", [a.name]);
                        if(avgRow[0].avgNote) rating = parseFloat(avgRow[0].avgNote).toFixed(1);
                    } catch(e) {}
                    return { title: a.name, artist: "Artiste", image: img, type: "Artiste", year: "...", rating: rating };
                }));
            } else {
                let method = currentType === "Musique" ? "track.search&track=" : "album.search&album=";
                const resp = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=${method}${encodeURIComponent(searchQuery)}&api_key=${API_KEY}&format=json&limit=15`);
                let rawResults = currentType === "Musique" ? resp.data.results.trackmatches.track : resp.data.results.albummatches.album;
                rawResults = rawResults.filter((v, i, a) => a.findIndex(t => t.name.toLowerCase() === v.name.toLowerCase()) === i).slice(0, 15);
                
                results = await Promise.all(rawResults.map(async (item) => {
                    let img = item.image ? item.image[3]['#text'] : "";
                    if (currentType === "Musique" && (!img || img.includes("2a96cbd8"))) img = await getRealArtistImage(item.artist);
                    else if (!img) img = "https://via.placeholder.com/300?text=No+Cover";
                    let dbItemId = currentType === 'Album' ? `${item.artist}::${item.name}` : item.name;
                    let dbItemType = currentType === 'Musique' ? 'track' : 'album';
                    let rating = null;
                    try {
                        const [avgRow] = await db.query("SELECT AVG(note) as avgNote FROM commentaires WHERE music_item_id = ? AND item_type = ?", [dbItemId, dbItemType]);
                        if(avgRow[0].avgNote) rating = parseFloat(avgRow[0].avgNote).toFixed(1);
                    } catch(e) {}
                    return { title: item.name, artist: item.artist, image: img, type: currentType, year: "...", rating: rating };
                }));
            }
        }
        res.render('search.njk', { results, query: searchQuery, currentTag: tag || "Tous", currentType, currentYears: years || "Toutes" });
    } catch (e) { res.render('search.njk', { results: [], query: "Erreur" }); }
});

router.get('/details/:name', async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;
        const trackName = req.params.name;
        const searchResp = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=track.search&track=${encodeURIComponent(trackName)}&api_key=${API_KEY}&format=json&limit=1`);
        const found = searchResp.data.results.trackmatches.track[0];
        const infoResp = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${API_KEY}&artist=${encodeURIComponent(found.artist)}&track=${encodeURIComponent(found.name)}&format=json`);
        const t = infoResp.data.track;

        let duration = "3:45";
        if (t.duration && t.duration !== "0") {
            const min = Math.floor(t.duration / 60000);
            const sec = ((t.duration % 60000) / 1000).toFixed(0);
            duration = `${min}:${sec.padStart(2, '0')}`;
        }

        // VRAIE RECHERCHE DE L'ANNÉE DE SORTIE VIA DEEZER
        let realYear = "Inconnue";
        try {
            const dzResp = await axios.get(`https://api.deezer.com/search/track?q=${encodeURIComponent(found.artist + ' ' + found.name)}&limit=1`);
            if (dzResp.data && dzResp.data.data.length > 0) {
                const dzTrackDetails = await axios.get(`https://api.deezer.com/track/${dzResp.data.data[0].id}`);
                if (dzTrackDetails.data && dzTrackDetails.data.release_date) {
                    realYear = dzTrackDetails.data.release_date.split('-')[0];
                }
            }
        } catch(e) {}

        const trackData = {
            name: t.name, artist: t.artist.name, album: t.album?.title || "Single",
            image: t.album?.image[3]['#text'] || t.image?.[3]['#text'] || "https://via.placeholder.com/300",
            duration, playcount: formatNumber(t.playcount), listeners: formatNumber(t.listeners),
            wiki: t.wiki?.summary || "Aucune description.", tags: t.toptags?.tag?.slice(0, 5) || [], year: realYear
        };

        const userId = req.session.user ? req.session.user.id : 0;
        const comments = await getItemComments(trackName, 'track', userId);
        const ratingStats = getRatingStats(comments);
        let isFavorite = false;
        if (userId) {
            const compositeId = `${trackData.name}||${trackData.artist}||${trackData.image}`;
            const [fav] = await db.query("SELECT * FROM favorites WHERE user_id = ? AND music_id = ?", [userId, compositeId]);
            isFavorite = fav.length > 0;
        }

        res.render('details.njk', { track: trackData, comments, ratingStats, itemId: trackName, itemType: 'track', isFavorite });
    } catch (e) { res.status(500).send("Erreur détails"); }
});

router.get('/artiste/:name', async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;
        const artistName = req.params.name;
        const [infoResp, albumsResp, tracksResp] = await Promise.all([
            axios.get(`https://ws.audioscrobbler.com/2.0/?method=artist.getInfo&artist=${encodeURIComponent(artistName)}&api_key=${API_KEY}&format=json`),
            axios.get(`https://ws.audioscrobbler.com/2.0/?method=artist.getTopAlbums&artist=${encodeURIComponent(artistName)}&api_key=${API_KEY}&format=json&limit=4`),
            axios.get(`https://ws.audioscrobbler.com/2.0/?method=artist.getTopTracks&artist=${encodeURIComponent(artistName)}&api_key=${API_KEY}&format=json&limit=5`)
        ]);

        const a = infoResp.data.artist;
        let finalImage = `https://ui-avatars.com/api/?name=${encodeURIComponent(artistName)}&background=d946ef&color=fff&size=500`;
        let strictAlbumCount = 4;

        try {
            const cleanName = artistName.split(',')[0].split('&')[0].trim();
            const dzResp = await axios.get(`https://api.deezer.com/search/artist?q=${encodeURIComponent(cleanName)}`);
            if (dzResp.data && dzResp.data.data && dzResp.data.data.length > 0) {
                const dzArtist = dzResp.data.data[0];
                if (dzArtist.picture_xl && !dzArtist.picture_xl.includes('/images/artist//')) finalImage = dzArtist.picture_xl;
                const dzAlbumsResp = await axios.get(`https://api.deezer.com/artist/${dzArtist.id}/albums?limit=100`);
                if (dzAlbumsResp.data && dzAlbumsResp.data.data) {
                    let vraisAlbums = dzAlbumsResp.data.data.filter(alb => alb.record_type === 'album');
                    let titresUniques = new Set();
                    let albumsPurifies = [];
                    const motsInterdits = ['live', 'remix', 'tour', 'essential', 'hits', 'best of', 'collection', 'anthology', 'number ones', 'remaster', 'edition', 'deluxe', 'greatest', 'ultimate', 'trilogy'];
                    
                    vraisAlbums.forEach(alb => {
                        let titreBasique = alb.title.toLowerCase();
                        let contientMotInterdit = motsInterdits.some(mot => titreBasique.includes(mot));
                        let titrePropre = titreBasique.replace(/\s*\(.*?\)\s*/g, '').replace(/\[.*?\]/g, '').trim();
                        if (!titresUniques.has(titrePropre) && !contientMotInterdit) {
                            titresUniques.add(titrePropre);
                            albumsPurifies.push(alb);
                        }
                    });
                    strictAlbumCount = albumsPurifies.length;
                }
            }
        } catch (e) {}

        const artistData = {
            name: a.name, image: finalImage,
            listeners: formatNumber(a.stats.listeners), 
            totalAlbums: strictAlbumCount > 0 ? strictAlbumCount : albumsResp.data.topalbums.album.length,
            bio: a.bio.summary ? a.bio.summary.split('<a')[0] : "Pas de bio disponible.",
            tags: a.tags.tag.slice(0, 6),
            albums: albumsResp.data.topalbums.album.map(alb => ({ title: alb.name, image: alb.image[3]['#text'] || 'https://via.placeholder.com/150' })),
            topTracks: tracksResp.data.toptracks.track.map((t, index) => ({ rank: index + 1, title: t.name, listeners: formatNumber(t.listeners) }))
        };

        const userId = req.session.user ? req.session.user.id : 0;
        const comments = await getItemComments(artistName, 'artist', userId);
        const ratingStats = getRatingStats(comments);

        res.render('artist.njk', { artist: artistData, comments, ratingStats, itemId: artistName, itemType: 'artist' });
    } catch (error) { res.status(500).send("Artiste introuvable"); }
});

router.get('/album/:artist/:album', async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;
        const { artist, album } = req.params;
        const response = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=album.getInfo&api_key=${API_KEY}&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}&format=json`);
        const alb = response.data.album;
        if (!alb) return res.status(404).send("Album introuvable");

        let totalMs = 0;
        let tracks = [];
        if (alb.tracks && alb.tracks.track) {
            const trackList = Array.isArray(alb.tracks.track) ? alb.tracks.track : [alb.tracks.track];
            tracks = trackList.map(t => {
                const duration = parseInt(t.duration || 0);
                totalMs += duration;
                const mockPlays = Math.floor(Math.random() * 4500000) + 150000; 
                return { 
                    name: t.name, 
                    duration: duration > 0 ? Math.floor(duration / 60) + ":" + (duration % 60).toString().padStart(2, '0') : "--:--", 
                    rank: t['@attr']?.rank || 1, 
                    playcount: formatNumber(mockPlays)
                };
            });
        }
        const totalHours = Math.floor(totalMs / 3600);
        const totalMins = Math.floor((totalMs % 3600) / 60);

        // VRAIE RECHERCHE DU LABEL ET DE L'ANNÉE DE SORTIE VIA DEEZER
        let realYear = alb.wiki ? alb.wiki.published.split(',')[0].split(' ').pop() : "Inconnue";
        let realLabel = "Indépendant";

        try {
            const dzResp = await axios.get(`https://api.deezer.com/search/album?q=${encodeURIComponent(artist + ' ' + album)}&limit=1`);
            if (dzResp.data && dzResp.data.data.length > 0) {
                const dzAlbDetails = await axios.get(`https://api.deezer.com/album/${dzResp.data.data[0].id}`);
                if (dzAlbDetails.data) {
                    if (dzAlbDetails.data.release_date) realYear = dzAlbDetails.data.release_date.split('-')[0];
                    if (dzAlbDetails.data.label) realLabel = dzAlbDetails.data.label;
                }
            }
        } catch(e) {}

        const albumData = {
            title: alb.name, artist: alb.artist, image: alb.image[3]['#text'] || 'https://via.placeholder.com/300?text=No+Cover',
            year: realYear,
            label: realLabel, // <-- NOUVELLE VRAIE INFO
            trackCount: tracks.length, totalDuration: `${totalHours > 0 ? totalHours + 'h ' : ''}${totalMins}min`, tracks: tracks
        };

        const itemId = `${artist}::${album}`; 
        const userId = req.session.user ? req.session.user.id : 0;
        const comments = await getItemComments(itemId, 'album', userId);
        const ratingStats = getRatingStats(comments);

        res.render('album.njk', { album: albumData, comments, ratingStats, itemId: itemId, itemType: 'album' });
    } catch (error) { res.status(500).send("Erreur album"); }
});

router.get('/notifications', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    try {
        const [rawNotifications] = await db.query(`
            SELECT n.*, u.pseudo as actor_pseudo, u.avatar as actor_avatar 
            FROM notifications n
            JOIN users u ON n.actor_id = u.id
            WHERE n.user_id = ? AND n.is_read = 0
            ORDER BY n.date_creation DESC
        `, [req.session.user.id]);

        const notifications = rawNotifications.map(n => {
            let icon, color, bgColor, actionText;
            if (n.type === 'like') {
                icon = 'heart'; color = '#e12afb'; bgColor = 'rgba(225, 42, 251, 0.1)';
                actionText = `a aimé votre commentaire sur <a href="/album/${encodeURIComponent(n.reference)}" class="notif-link">${n.reference}</a>`;
            } else if (n.type === 'follow') {
                icon = 'user-plus'; color = '#3b82f6'; bgColor = 'rgba(59, 130, 246, 0.1)';
                actionText = 'a commencé à vous suivre';
            } else if (n.type === 'rating') {
                icon = 'star'; color = '#eab308'; bgColor = 'rgba(234, 179, 8, 0.1)';
                actionText = `a noté 5 étoiles un album que vous avez aimé`; 
            }
            return {
                id: n.id, type: n.type, icon: icon, color: color, bgColor: bgColor,
                user: n.actor_pseudo, action: actionText, is_read: n.is_read, time: timeAgo(n.date_creation) 
            };
        });

        res.render('notifications.njk', { notifications, page: 'notifications' });
    } catch (error) { res.status(500).send("Erreur serveur."); }
});

// --- ACTIONS SUR LES NOTIFICATIONS ---

// 1. Supprimer UNE notification (Clic sur la poubelle)
router.post('/notifications/delete/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false });
    try {
        await db.query("DELETE FROM notifications WHERE id = ? AND user_id = ?", [req.params.id, req.session.user.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// 2. Tout supprimer / marquer comme lu
router.post('/notifications/read-all', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false });
    try {
        // On marque tout comme lu (ou on supprime avec DELETE si tu préfères)
        await db.query("DELETE FROM notifications WHERE user_id = ?", [req.session.user.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

router.get('/profil', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const userId = req.session.user.id;
    const API_KEY = process.env.LASTFM_API_KEY;

    try {
        const [users] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
        const userDb = users[0];
        const dateIns = new Date(userDb.date_inscription);
        const joinDate = `${dateIns.getDate()}/${dateIns.getMonth()+1}/${dateIns.getFullYear()}`;

        const [commentsDb] = await db.query(`
            SELECT c.*, (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id) as likes
            FROM commentaires c WHERE c.user_id = ? ORDER BY c.date_commentaire DESC
        `, [userId]);

        for (let c of commentsDb) {
            c.title = c.music_item_id; c.artist = "BPM"; c.image = `https://ui-avatars.com/api/?name=${encodeURIComponent(c.music_item_id)}&background=27272a&color=fff&size=200`; c.url = "#";
            try {
                if (c.item_type === 'album') {
                    let artist = "Inconnu"; let title = c.music_item_id;
                    if (c.music_item_id.includes('::')) { let parts = c.music_item_id.split('::'); artist = parts[0].trim(); title = parts[1].trim(); } 
                    else if (c.music_item_id.includes('-')) { let parts = c.music_item_id.split('-'); artist = parts[0].trim(); title = parts.slice(1).join('-').trim(); }
                    c.artist = artist; c.title = title; c.url = `/album/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
                    const r = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=album.getInfo&api_key=${API_KEY}&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(title)}&format=json`);
                    if (r.data && r.data.album && r.data.album.image) { let img = r.data.album.image[3]['#text']; if (img) c.image = img; }
                } 
                else if (c.item_type === 'track') {
                    c.url = `/details/${encodeURIComponent(c.title)}`;
                    const r = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=track.search&track=${encodeURIComponent(c.title)}&api_key=${API_KEY}&format=json&limit=1`);
                    if (r.data && r.data.results && r.data.results.trackmatches.track[0]) {
                        const trk = r.data.results.trackmatches.track[0];
                        c.artist = trk.artist; let img = trk.image[3]['#text'];
                        if (img && !img.includes('2a96cbd8')) { c.image = img; } else { c.image = await getRealArtistImage(trk.artist); }
                    }
                } 
                else if (c.item_type === 'artist') {
                    c.artist = "Artiste"; c.title = c.music_item_id; c.url = `/artiste/${encodeURIComponent(c.title)}`; c.image = await getRealArtistImage(c.title);
                }
            } catch(e) { } 
        }

        const [favoritesDb] = await db.query('SELECT * FROM favorites WHERE user_id = ?', [userId]);
        const formattedFavorites = favoritesDb.map(f => {
            const parts = f.music_id.split('||');
            return { title: parts[0], artist: parts[1], image: parts[2], url: `/details/${encodeURIComponent(parts[0])}` };
        });

        let total_avis = commentsDb.length;
        let total_suivis = 0; let total_likes = 0;
        try {
            const [[{ countS }]] = await db.query('SELECT COUNT(*) as countS FROM follows WHERE following_id = ?', [userId]); total_suivis = countS || 0;
            const [[{ countL }]] = await db.query('SELECT COUNT(*) as countL FROM comment_likes cl JOIN commentaires c ON cl.comment_id = c.id WHERE c.user_id = ?', [userId]); total_likes = countL || 0;
        } catch (err) { }

        res.render('profil.njk', { 
            user: { ...userDb, name: userDb.pseudo, joinDate, bio: userDb.bio || "Mélomane.", avatar: userDb.avatar || `https://ui-avatars.com/api/?name=${userDb.pseudo}&background=27272a&color=fff`, stats: { favoris: formattedFavorites.length, avis: total_avis, suivis: total_suivis } },
            comments: commentsDb, favorites: formattedFavorites, impact: { month: "MARS 2026", albumsRated: total_avis, musicCommented: total_avis, likesReceived: total_likes }, page: 'profil'
        });
    } catch (e) { res.status(500).send("Erreur de chargement du profil"); }
});

router.get('/user/:pseudo', async (req, res) => {
    const pseudo = req.params.pseudo;
    const currentUserId = req.session.user ? req.session.user.id : 0;
    const API_KEY = process.env.LASTFM_API_KEY;

    try {
        const [users] = await db.query('SELECT * FROM users WHERE pseudo = ?', [pseudo]);
        if (users.length === 0) return res.status(404).send("Utilisateur introuvable");
        const userDb = users[0];

        const dateIns = new Date(userDb.date_inscription);
        const mois = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
        const joinDate = `${mois[dateIns.getMonth()]} ${dateIns.getFullYear()}`;

        const [favoritesDb] = await db.query('SELECT * FROM favorites WHERE user_id = ? ORDER BY date_ajout DESC', [userDb.id]);
        const formattedFavorites = favoritesDb.map(f => {
            const parts = f.music_id.split('||');
            return { title: parts[0] || 'Inconnu', artist: parts[1] || '', image: parts[2] || 'https://via.placeholder.com/300', url: `/details/${encodeURIComponent(parts[0] || '')}` };
        });

        const [commentsDb] = await db.query(`
            SELECT c.*, (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id) as likes
            FROM commentaires c WHERE c.user_id = ? ORDER BY c.date_commentaire DESC
        `, [userDb.id]);

        for (let c of commentsDb) {
            c.title = c.music_item_id; c.artist = "BPM"; c.image = `https://ui-avatars.com/api/?name=${encodeURIComponent(c.music_item_id)}&background=27272a&color=fff&size=200`; c.url = "#";
            try {
                if (c.item_type === 'album') {
                    let artist = "Inconnu"; let title = c.music_item_id;
                    if (c.music_item_id.includes('::')) { let parts = c.music_item_id.split('::'); artist = parts[0].trim(); title = parts[1].trim(); } 
                    else if (c.music_item_id.includes('-')) { let parts = c.music_item_id.split('-'); artist = parts[0].trim(); title = parts.slice(1).join('-').trim(); }
                    c.artist = artist; c.title = title; c.url = `/album/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
                    const r = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=album.getInfo&api_key=${API_KEY}&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(title)}&format=json`);
                    if (r.data && r.data.album && r.data.album.image) { let img = r.data.album.image[3]['#text']; if (img) c.image = img; }
                } 
                else if (c.item_type === 'track') {
                    c.url = `/details/${encodeURIComponent(c.title)}`;
                    const r = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=track.search&track=${encodeURIComponent(c.title)}&api_key=${API_KEY}&format=json&limit=1`);
                    if (r.data && r.data.results && r.data.results.trackmatches.track[0]) {
                        const trk = r.data.results.trackmatches.track[0];
                        c.artist = trk.artist; let img = trk.image[3]['#text'];
                        if (img && !img.includes('2a96cbd8')) { c.image = img; } else { c.image = await getRealArtistImage(trk.artist); }
                    }
                } 
                else if (c.item_type === 'artist') {
                    c.artist = "Artiste"; c.title = c.music_item_id; c.url = `/artiste/${encodeURIComponent(c.title)}`; c.image = await getRealArtistImage(c.title);
                }
            } catch(e) { } 
        }

        let total_avis = commentsDb.length; 
        let total_suivis = 0; let isFollowing = false;

        try { const [[{ count }]] = await db.query('SELECT COUNT(*) as count FROM follows WHERE following_id = ?', [userDb.id]); total_suivis = count; } catch(e) {}
        try {
            if (currentUserId) {
                const [followCheck] = await db.query("SELECT * FROM follows WHERE follower_id = ? AND following_id = ?", [currentUserId, userDb.id]);
                isFollowing = followCheck.length > 0;
            }
        } catch(e) {}

        const publicUser = {
            id: userDb.id, name: userDb.pseudo, joinDate: joinDate, bio: userDb.bio || "Cet utilisateur n'a pas encore de bio.",
            avatar: userDb.avatar || `https://ui-avatars.com/api/?name=${userDb.pseudo}&background=27272a&color=fff`,
            stats: { favoris: formattedFavorites.length, avis: total_avis, suivis: total_suivis }
        };

        res.render('public-profile.njk', { publicUser, favorites: formattedFavorites, comments: commentsDb, isFollowing, page: 'public-profile' });
    } catch (e) { res.status(500).send("Erreur serveur"); }
});

module.exports = router;