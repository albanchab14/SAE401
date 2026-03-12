const express = require('express');
const nunjucks = require('nunjucks');
const path = require('path');
const axios = require('axios');
const session = require('express-session');
const db = require('./src/config/database');
const bcrypt = require('bcrypt');
const multer = require('multer'); 
require('dotenv').config();

const app = express();
const port = 3000;

nunjucks.configure('views', { autoescape: true, express: app });
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); 

app.use(session({
    secret: 'bpm_super_secret_key',
    resave: false,
    saveUninitialized: false
}));

// CONFIGURATION UPLOAD AVATAR
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/images/')
    },
    filename: function (req, file, cb) {
        cb(null, 'avatar-' + Date.now() + path.extname(file.originalname))
    }
});
const upload = multer({ storage: storage });

// MIDDLEWARE : SÉCURITÉ MAINTENANCE
app.use(async (req, res, next) => {
    if (req.path.startsWith('/css') || req.path.startsWith('/images') || req.path.startsWith('/api')) {
        return next();
    }
    try {
        const [settings] = await db.query('SELECT is_maintenance, maintenance_message FROM site_settings WHERE id = 1');
        const isMaintenance = settings.length > 0 ? settings[0].is_maintenance : false;
        const maintenanceMsg = settings.length > 0 ? settings[0].maintenance_message : "Le site fait peau neuve. De retour dans quelques minutes !";

        if (isMaintenance) {
            const isAdmin = req.session.user && req.session.user.role === 'admin';
            if (!isAdmin) {
                if (['/login', '/connexion', '/register', '/inscription'].includes(req.path)) return next();
                if (req.path === '/admin') return res.redirect('/login');
                return res.status(503).send(`
                    <body style='background:#09090b; color:white; font-family:sans-serif; text-align:center; padding-top:100px;'>
                        <h1 style='font-size: 2rem; margin-bottom: 10px;'>🛠 Site en maintenance</h1>
                        <p style='color: #a1a1aa;'>${maintenanceMsg}</p>
                    </body>
                `);
            }
        }
        next();
    } catch (e) { next(); }
});

app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

function requireAdmin(req, res, next) {
    if (!req.session.user || req.session.user.role !== 'admin') {
        if (req.path.startsWith('/api/')) return res.status(403).json({ error: "Accès refusé." });
        return res.redirect('/login');
    }
    next();
}

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

// FORMATAGE INTELLIGENT DES NOMBRES
function formatNumber(numStr) {
    let num = parseInt(numStr, 10);
    if (isNaN(num)) return "0";
    if (num >= 1000000) {
        // Ex: 1 300 000 devient "1,3 M"
        return (num / 1000000).toFixed(1).replace('.', ',') + " M";
    }
    // Ex: 422 535 reste tel quel avec les espaces
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
    
    let sum = 0;
    let counts = {1:0, 2:0, 3:0, 4:0, 5:0};
    
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

// ==========================================
// ROUTES PUBLIQUES
// ==========================================

app.get('/', async (req, res) => {
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
        const randomPage = Math.floor(Math.random() * 50) + 1;
        const respMatch = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=rj&api_key=${API_KEY}&format=json&limit=10&page=${randomPage}`);
        const initialMatch = respMatch.data.topalbums.album.sort(() => 0.5 - Math.random()).slice(0, 3).map(alb => ({
            title: alb.name, artist: alb.artist.name, image: alb.image[3]['#text'] || "https://via.placeholder.com/300"
        }));

        res.render('index.njk', { topArtists, heroArtist, initialMatch, page: 'home' });
    } catch (e) { res.status(500).send("Erreur Accueil"); }
});

app.get('/search', async (req, res) => {
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
                rawArtists = rawArtists.filter(a => {
                    const n = a.name.toLowerCase();
                    const sq = searchQuery.toLowerCase();
                    if ((n.includes('&') || n.includes(' feat')) && !sq.includes('&')) return false;
                    return true;
                });
                
                results = await Promise.all(rawArtists.map(async a => {
                    let img = a.picture_xl;
                    if (!img || img.includes('/images/artist//')) img = `https://ui-avatars.com/api/?name=${encodeURIComponent(a.name)}&background=d946ef&color=fff&size=300`;
                    
                    let rating = null;
                    try {
                        const [avgRow] = await db.query("SELECT AVG(note) as avgNote FROM commentaires WHERE music_item_id = ? AND item_type = 'artist'", [a.name]);
                        if(avgRow[0].avgNote) rating = parseFloat(avgRow[0].avgNote).toFixed(1);
                    } catch(e) {}

                    return { title: a.name, artist: "Artiste", image: img, type: "Artiste", year: years || "2024", rating: rating };
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

                    return { title: item.name, artist: item.artist, image: img, type: currentType, year: years || "2024", rating: rating };
                }));
            }
        }
        res.render('search.njk', { results, query: searchQuery, currentTag: tag || "Tous", currentType, currentYears: years || "Toutes" });
    } catch (e) { res.render('search.njk', { results: [], query: "Erreur" }); }
});

app.get('/details/:name', async (req, res) => {
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

        const trackData = {
            name: t.name, artist: t.artist.name, album: t.album?.title || "Single",
            image: t.album?.image[3]['#text'] || t.image?.[3]['#text'] || "https://via.placeholder.com/300",
            duration, 
            playcount: formatNumber(t.playcount), // UTILISATION DE FORMATNUMBER
            listeners: formatNumber(t.listeners), // UTILISATION DE FORMATNUMBER
            wiki: t.wiki?.summary || "Aucune description.", tags: t.toptags?.tag?.slice(0, 5) || [], year: "2024"
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

app.get('/artiste/:name', async (req, res) => {
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
                if (dzArtist.picture_xl && !dzArtist.picture_xl.includes('/images/artist//')) {
                    finalImage = dzArtist.picture_xl;
                }
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
            listeners: formatNumber(a.stats.listeners), // UTILISATION DE FORMATNUMBER
            totalAlbums: strictAlbumCount > 0 ? strictAlbumCount : albumsResp.data.topalbums.album.length,
            bio: a.bio.summary ? a.bio.summary.split('<a')[0] : "Pas de bio disponible.",
            tags: a.tags.tag.slice(0, 6),
            albums: albumsResp.data.topalbums.album.map(alb => ({ title: alb.name, image: alb.image[3]['#text'] || 'https://via.placeholder.com/150' })),
            topTracks: tracksResp.data.toptracks.track.map((t, index) => ({ rank: index + 1, title: t.name, listeners: formatNumber(t.listeners) })) // UTILISATION DE FORMATNUMBER
        };

        const userId = req.session.user ? req.session.user.id : 0;
        const comments = await getItemComments(artistName, 'artist', userId);
        const ratingStats = getRatingStats(comments);

        res.render('artist.njk', { artist: artistData, comments, ratingStats, itemId: artistName, itemType: 'artist' });
    } catch (error) { res.status(500).send("Artiste introuvable"); }
});

app.get('/album/:artist/:album', async (req, res) => {
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
                
                // Simulation réaliste du playcount pour la piste (L'API ne le donne pas pour les albums)
                // Cela génère un entier aléatoire (ex: 753 200) formaté correctement
                const mockPlays = Math.floor(Math.random() * 4500000) + 150000; 

                return { 
                    name: t.name, 
                    duration: duration > 0 ? Math.floor(duration / 60) + ":" + (duration % 60).toString().padStart(2, '0') : "--:--", 
                    rank: t['@attr']?.rank || 1, 
                    playcount: formatNumber(mockPlays) // UTILISATION DE FORMATNUMBER
                };
            });
        }
        const totalHours = Math.floor(totalMs / 3600);
        const totalMins = Math.floor((totalMs % 3600) / 60);

        const albumData = {
            title: alb.name, artist: alb.artist, image: alb.image[3]['#text'] || 'https://via.placeholder.com/300?text=No+Cover',
            year: alb.wiki ? alb.wiki.published.split(',')[0].split(' ').pop() : "2024",
            trackCount: tracks.length, totalDuration: `${totalHours > 0 ? totalHours + 'h ' : ''}${totalMins}min`, tracks: tracks
        };

        const itemId = `${artist}::${album}`; 
        const userId = req.session.user ? req.session.user.id : 0;
        const comments = await getItemComments(itemId, 'album', userId);
        const ratingStats = getRatingStats(comments);

        res.render('album.njk', { album: albumData, comments, ratingStats, itemId: itemId, itemType: 'album' });
    } catch (error) { res.status(500).send("Erreur album"); }
});

// ROUTE : NOTIFICATIONS
app.get('/notifications', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

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
                id: n.id,
                type: n.type,
                icon: icon,
                color: color,
                bgColor: bgColor,
                user: n.actor_pseudo,
                action: actionText,
                is_read: n.is_read,
                time: timeAgo(n.date_creation) 
            };
        });

        res.render('notifications.njk', { notifications, page: 'notifications' });

    } catch (error) {
        console.error("Erreur chargement notifications:", error);
        res.status(500).send("Erreur serveur.");
    }
});

app.post('/notifications/read-all', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Non connecté' });
    try {
        await db.query('DELETE FROM notifications WHERE user_id = ?', [req.session.user.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.post('/notifications/delete/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Non connecté' });
    try {
        await db.query('DELETE FROM notifications WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// ==========================================
// PROFIL (MON PROFIL)
// ==========================================
app.get('/profil', async (req, res) => {
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
            c.title = c.music_item_id; 
            c.artist = "BPM"; 
            c.image = `https://ui-avatars.com/api/?name=${encodeURIComponent(c.music_item_id)}&background=27272a&color=fff&size=200`;
            c.url = "#";
            
            try {
                if (c.item_type === 'album') {
                    let artist = "Inconnu";
                    let title = c.music_item_id;
                    if (c.music_item_id.includes('::')) {
                        let parts = c.music_item_id.split('::');
                        artist = parts[0].trim();
                        title = parts[1].trim();
                    } else if (c.music_item_id.includes('-')) {
                        let parts = c.music_item_id.split('-');
                        artist = parts[0].trim();
                        title = parts.slice(1).join('-').trim();
                    }
                    c.artist = artist;
                    c.title = title;
                    c.url = `/album/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;

                    const r = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=album.getInfo&api_key=${API_KEY}&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(title)}&format=json`);
                    if (r.data && r.data.album && r.data.album.image) {
                        let img = r.data.album.image[3]['#text'];
                        if (img) c.image = img;
                    }
                } 
                else if (c.item_type === 'track') {
                    c.url = `/details/${encodeURIComponent(c.title)}`;
                    const r = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=track.search&track=${encodeURIComponent(c.title)}&api_key=${API_KEY}&format=json&limit=1`);
                    if (r.data && r.data.results && r.data.results.trackmatches.track[0]) {
                        const trk = r.data.results.trackmatches.track[0];
                        c.artist = trk.artist;
                        let img = trk.image[3]['#text'];
                        if (img && !img.includes('2a96cbd8')) {
                            c.image = img;
                        } else {
                            c.image = await getRealArtistImage(trk.artist);
                        }
                    }
                } 
                else if (c.item_type === 'artist') {
                    c.artist = "Artiste";
                    c.title = c.music_item_id;
                    c.url = `/artiste/${encodeURIComponent(c.title)}`;
                    c.image = await getRealArtistImage(c.title);
                }
            } catch(e) { } 
        }

        const [favoritesDb] = await db.query('SELECT * FROM favorites WHERE user_id = ?', [userId]);
        const formattedFavorites = favoritesDb.map(f => {
            const parts = f.music_id.split('||');
            return { title: parts[0], artist: parts[1], image: parts[2], url: `/details/${encodeURIComponent(parts[0])}` };
        });

        let total_avis = commentsDb.length;
        let total_suivis = 0;
        let total_likes = 0;
        
        try {
            const [[{ countS }]] = await db.query('SELECT COUNT(*) as countS FROM follows WHERE following_id = ?', [userId]);
            total_suivis = countS || 0;
            const [[{ countL }]] = await db.query('SELECT COUNT(*) as countL FROM comment_likes cl JOIN commentaires c ON cl.comment_id = c.id WHERE c.user_id = ?', [userId]);
            total_likes = countL || 0;
        } catch (err) { }

        res.render('profil.njk', { 
            user: { ...userDb, name: userDb.pseudo, joinDate, bio: userDb.bio || "Mélomane.", avatar: userDb.avatar || `https://ui-avatars.com/api/?name=${userDb.pseudo}&background=27272a&color=fff`, stats: { favoris: formattedFavorites.length, avis: total_avis, suivis: total_suivis } },
            comments: commentsDb, favorites: formattedFavorites, impact: { month: "MARS 2026", albumsRated: total_avis, musicCommented: total_avis, likesReceived: total_likes }, page: 'profil'
        });
    } catch (e) { 
        res.status(500).send("Erreur de chargement du profil"); 
    }
});

app.post('/api/profil/edit', upload.single('avatar'), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Non connecté" });
    try {
        const { pseudo, email, bio, password } = req.body;
        const userId = req.session.user.id;
        const cleanEmail = email.replace(/\s+/g, '');

        let updateQuery = "UPDATE users SET pseudo = ?, email = ?, bio = ? WHERE id = ?";
        let queryParams = [pseudo, cleanEmail, bio, userId];

        if (req.file) {
            const avatarPath = '/images/' + req.file.filename;
            await db.query("UPDATE users SET avatar = ? WHERE id = ?", [avatarPath, userId]);
            req.session.user.avatar = avatarPath;
        }

        if (password && password.trim() !== "") {
            const hashedPassword = await bcrypt.hash(password, 10);
            updateQuery = "UPDATE users SET pseudo = ?, email = ?, bio = ?, password = ? WHERE id = ?";
            queryParams = [pseudo, cleanEmail, bio, hashedPassword, userId];
        }

        await db.query(updateQuery, queryParams);
        req.session.user.pseudo = pseudo;

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "Erreur : Ce pseudo ou cet email est peut-être déjà utilisé." });
    }
});

app.delete('/api/profil/delete', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Non connecté" });
    try {
        await db.query("DELETE FROM users WHERE id = ?", [req.session.user.id]);
        req.session.destroy();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "Erreur" });
    }
});

app.get('/api/search-users', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json([]);
        const [users] = await db.query('SELECT pseudo, avatar FROM users WHERE pseudo LIKE ? LIMIT 5', [`%${q}%`]);
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: "Erreur" });
    }
});

app.get('/api/match', async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;
        const randomPage = Math.floor(Math.random() * 100) + 1;
        const response = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=rj&api_key=${API_KEY}&format=json&limit=30&page=${randomPage}`);
        const albums = response.data.topalbums.album.sort(() => 0.5 - Math.random());
        const result = [];
        const seenArtists = new Set();
        
        for (let alb of albums) {
            let img = alb.image[3]['#text'];
            if (img && !img.includes('2a96cbd8') && !seenArtists.has(alb.artist.name)) {
                result.push({ title: alb.name, artist: alb.artist.name, image: img });
                seenArtists.add(alb.artist.name);
            }
            if (result.length === 3) break;
        }
        res.json(result);
    } catch (error) { res.status(500).json({ error: "Erreur Match" }); }
});

app.get('/api/suggest', async (req, res) => {
    try {
        const { q } = req.query;
        const API_KEY = process.env.LASTFM_API_KEY;
        if (!q || q.length < 2) return res.json([]);

        const [artResp, albResp] = await Promise.all([
            axios.get(`https://api.deezer.com/search/artist?q=${encodeURIComponent(q)}&limit=4`),
            axios.get(`https://ws.audioscrobbler.com/2.0/?method=album.search&album=${encodeURIComponent(q)}&api_key=${API_KEY}&format=json&limit=4`)
        ]);

        let deezerArtists = artResp.data.data || [];
        deezerArtists = deezerArtists.filter(a => !((a.name.includes('&') || a.name.includes(' feat')) && !q.includes('&')));
        const artists = deezerArtists.slice(0, 4).map(a => ({ title: a.name, artist: "Artiste", type: "artiste" }));
        const albums = albResp.data.results.albummatches.album.map(a => ({ title: a.name, artist: a.artist, type: "album" }));
        
        res.json([...artists, ...albums]);
    } catch (e) { res.json([]); }
});

app.post('/api/favorites/toggle', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Connectez-vous." });
    try {
        const { music_id } = req.body;
        const userId = req.session.user.id;
        const [exist] = await db.query("SELECT * FROM favorites WHERE user_id = ? AND music_id = ?", [userId, music_id]);
        if (exist.length > 0) {
            await db.query("DELETE FROM favorites WHERE user_id = ? AND music_id = ?", [userId, music_id]);
            res.json({ isFavorite: false });
        } else {
            await db.query("INSERT INTO favorites (user_id, music_id) VALUES (?, ?)", [userId, music_id]);
            res.json({ isFavorite: true });
        }
    } catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

app.post('/api/comments', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Connectez-vous pour commenter." });
    try {
        const { item_id, item_type, note, commentaire } = req.body;
        await db.query("INSERT INTO commentaires (user_id, music_item_id, item_type, note, commentaire) VALUES (?, ?, ?, ?, ?)", 
        [req.session.user.id, item_id, item_type, note, commentaire]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur lors de l'envoi." }); }
});

app.post('/api/comments/:id/like', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Connectez-vous." });
    try {
        const commentId = req.params.id;
        const userId = req.session.user.id; 
        
        const [exist] = await db.query("SELECT * FROM comment_likes WHERE user_id = ? AND comment_id = ?", [userId, commentId]);
        
        if (exist.length > 0) {
            await db.query("DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?", [userId, commentId]);
            res.json({ liked: false });
        } else {
            await db.query("INSERT INTO comment_likes (user_id, comment_id) VALUES (?, ?)", [userId, commentId]);
            const [comments] = await db.query("SELECT user_id, music_item_id FROM commentaires WHERE id = ?", [commentId]);
            
            if (comments.length > 0) {
                const authorId = comments[0].user_id;
                const reference = comments[0].music_item_id;
                if (userId !== authorId) {
                    await db.query(`
                        INSERT INTO notifications (user_id, actor_id, type, reference, date_creation) 
                        VALUES (?, ?, 'like', ?, ?)
                    `, [authorId, userId, reference, new Date()]);
                }
            }
            res.json({ liked: true });
        }
    } catch (e) { 
        res.status(500).json({ error: "Erreur BDD" }); 
    }
});

app.post('/api/comments/:id/report', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Connectez-vous." });
    try {
        const { reason } = req.body;
        await db.query("INSERT INTO reports_commentaire (reporter_id, commentaire_id, reason) VALUES (?, ?, ?)", 
        [req.session.user.id, req.params.id, reason]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

app.delete('/api/comments/own/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Connectez-vous." });
    try {
        await db.query("DELETE FROM commentaires WHERE id = ? AND user_id = ?", [req.params.id, req.session.user.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

app.put('/api/comments/own/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Connectez-vous." });
    try {
        const { note, commentaire } = req.body;
        await db.query("UPDATE commentaires SET note = ?, commentaire = ?, date_commentaire = NOW() WHERE id = ? AND user_id = ?", 
        [note, commentaire, req.params.id, req.session.user.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

// AUTHENTIFICATION
app.get('/login', (req, res) => res.render('login.njk', { page: 'login' }));
app.get('/register', (req, res) => res.render('register.njk', { page: 'register' }));
app.get('/connexion', (req, res) => res.redirect('/login'));
app.get('/inscription', (req, res) => res.redirect('/register'));

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.render('login.njk', { page: 'login', error: "Aucun compte n'est associé à cette adresse email." });
        const user = users[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
            const [settings] = await db.query('SELECT is_maintenance FROM site_settings WHERE id = 1');
            const isMaintenance = settings.length > 0 ? settings[0].is_maintenance : false;
            if (isMaintenance && user.role !== 'admin') return res.render('login.njk', { page: 'login', error: "🛠 Le site est en maintenance." });
            if (user.is_banned == 1) return res.render('login.njk', { page: 'login', error: "🚨 Votre compte a été banni." });
            req.session.user = { id: user.id, pseudo: user.pseudo, role: user.role, avatar: user.avatar };
            res.redirect(user.role === 'admin' ? '/admin' : '/');
        } else {
            return res.render('login.njk', { page: 'login', error: "Le mot de passe est incorrect." });
        }
    } catch (error) { res.render('login.njk', { page: 'login', error: "Erreur serveur." }); }
});

app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const [existingUsers] = await db.query('SELECT * FROM users WHERE email = ? OR pseudo = ?', [email, username]);
        if (existingUsers.length > 0) return res.render('register.njk', { page: 'register', error: "Cet email ou ce nom d'utilisateur est déjà utilisé." });
        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await db.query('INSERT INTO users (pseudo, email, password, role) VALUES (?, ?, ?, ?)', [username, email, hashedPassword, 'utilisateur']);
        req.session.user = { id: result.insertId, pseudo: username, role: 'utilisateur', avatar: null };
        res.redirect('/');
    } catch (error) { res.render('register.njk', { page: 'register', error: "Une erreur est survenue lors de l'inscription." }); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.get('/admin', requireAdmin, async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;
        const [settings] = await db.query('SELECT is_maintenance FROM site_settings WHERE id = 1');
        const isMaintenance = settings.length > 0 ? settings[0].is_maintenance : false;
        const [users] = await db.query("SELECT id, pseudo, email, role, is_banned FROM users ORDER BY id DESC LIMIT 50");
        const [reports] = await db.query(`SELECT c.id as comment_id, u.pseudo, c.commentaire as comment, c.music_item_id, c.item_type, rc.reason, COUNT(rc.id) as count FROM reports_commentaire rc JOIN commentaires c ON rc.commentaire_id = c.id JOIN users u ON c.user_id = u.id GROUP BY c.id, u.pseudo, c.commentaire, c.music_item_id, c.item_type, rc.reason ORDER BY count DESC`);
        
        reports.forEach(r => {
            const itemId = r.music_item_id ? r.music_item_id.trim() : '';
            if (r.item_type === 'track') {
                r.url = '/details/' + encodeURIComponent(itemId);
            } 
            else if (r.item_type === 'artist') {
                r.url = '/artiste/' + encodeURIComponent(itemId);
            } 
            else if (r.item_type === 'album') {
                let artist = "Inconnu";
                let title = itemId;
                
                if (itemId.includes('::')) { 
                    let parts = itemId.split('::'); 
                    artist = parts[0].trim();
                    title = parts[1].trim();
                }
                else if (itemId.includes('-')) { 
                    let parts = itemId.split('-'); 
                    artist = parts[0].trim();
                    title = parts.slice(1).join('-').trim();
                }
                
                r.url = '/album/' + encodeURIComponent(artist) + '/' + encodeURIComponent(title);
            } 
            else {
                r.url = '/search?q=' + encodeURIComponent(itemId);
            }
        });

        const [dbArtists] = await db.query("SELECT * FROM featured_artists ORDER BY rang ASC, id ASC LIMIT 6");
        let featuredArtists = [];
        for (let i = 0; i < dbArtists.length; i++) {
            const a = dbArtists[i];
            featuredArtists.push({ db_id: a.id, position: a.rang, name: a.api_artist_id, image: await getRealArtistImage(a.api_artist_id), desc: a.accroche || "" });
        }

        const [[{ totalU }]] = await db.query("SELECT COUNT(*) as totalU FROM users");
        const [[{ totalC }]] = await db.query("SELECT COUNT(*) as totalC FROM commentaires");
        const [[{ totalR }]] = await db.query("SELECT COUNT(*) as totalR FROM reports_commentaire");

        res.render('admin.njk', { page: 'admin', users, reports, featuredArtists, isMaintenance, stats: { users: totalU.toLocaleString('fr-FR'), comments: totalC.toLocaleString('fr-FR'), reports: totalR, artists: featuredArtists.length } });
    } catch (error) { res.status(500).send("Erreur serveur Dashboard."); }
});

app.post('/api/admin/maintenance', requireAdmin, async (req, res) => {
    try { await db.query("UPDATE site_settings SET is_maintenance = ? WHERE id = 1", [req.body.active ? 1 : 0]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

app.post('/api/admin/reports/:id/ignore', requireAdmin, async (req, res) => {
    try {
        await db.query("DELETE FROM reports_commentaire WHERE commentaire_id = ?", [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Erreur BDD" }); }
});

app.delete('/api/admin/comments/:id', requireAdmin, async (req, res) => {
    try {
        await db.query("DELETE FROM reports_commentaire WHERE commentaire_id = ?", [req.params.id]);
        await db.query("DELETE FROM commentaires WHERE id = ?", [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Erreur BDD" }); }
});

app.post('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
    try {
        await db.query("UPDATE users SET role = ? WHERE id = ?", [req.body.role, req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Erreur BDD" }); }
});

app.post('/api/admin/users/:id/ban', requireAdmin, async (req, res) => {
    try {
        const [user] = await db.query("SELECT is_banned FROM users WHERE id = ?", [req.params.id]);
        const newStatus = user[0].is_banned ? 0 : 1;
        await db.query("UPDATE users SET is_banned = ? WHERE id = ?", [newStatus, req.params.id]);
        res.json({ is_banned: newStatus });
    } catch(e) { res.status(500).json({ error: "Erreur BDD" }); }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
    try {
        await db.query("DELETE FROM users WHERE id = ?", [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Erreur BDD" }); }
});

app.post('/api/admin/artists/description', requireAdmin, async (req, res) => {
    try {
        await db.query("UPDATE featured_artists SET accroche = ? WHERE id = ?", [req.body.desc, req.body.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Erreur BDD" }); }
});

app.post('/api/admin/artists/reorder', requireAdmin, async (req, res) => {
    try {
        const targetId = req.body.id;
        const newPosition = parseInt(req.body.newPosition);
        const [currentArtist] = await db.query("SELECT rang FROM featured_artists WHERE id = ?", [targetId]);
        if (currentArtist.length === 0) return res.status(404).json({ error: "Artiste introuvable" });
        const oldPosition = currentArtist[0].rang;
        const [otherArtist] = await db.query("SELECT id FROM featured_artists WHERE rang = ?", [newPosition]);
        if (otherArtist.length > 0) {
            await db.query("UPDATE featured_artists SET rang = ? WHERE id = ?", [oldPosition, otherArtist[0].id]);
        }
        await db.query("UPDATE featured_artists SET rang = ? WHERE id = ?", [newPosition, targetId]);
        res.json({ success: true });
    } catch(e) { 
        res.status(500).json({ error: "Erreur BDD" }); 
    }
});

app.post('/api/admin/artists/:id/randomize', requireAdmin, async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;
        const [currentArtists] = await db.query("SELECT api_artist_id FROM featured_artists");
        const existingNames = currentArtists.map(a => a.api_artist_id.toLowerCase());
        const response = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=chart.gettopartists&api_key=${API_KEY}&format=json&limit=50`);
        const topArtists = response.data.artists.artist;
        const availableArtists = topArtists.filter(a => !existingNames.includes(a.name.toLowerCase()));
        if (availableArtists.length === 0) return res.status(400).json({ error: "Impossible de trouver un nouvel artiste." });
        const randomArtist = availableArtists[Math.floor(Math.random() * availableArtists.length)].name;
        await db.query("UPDATE featured_artists SET api_artist_id = ? WHERE id = ?", [randomArtist, req.params.id]);
        res.json({ success: true });
    } catch(e) { 
        res.status(500).json({ error: "Erreur lors du remplacement." }); 
    }
});

app.post('/api/admin/artists/replace', requireAdmin, async (req, res) => {
    try {
        await db.query("UPDATE featured_artists SET api_artist_id = ? WHERE id = ?", [req.body.newArtistName, req.body.oldArtistId]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Erreur BDD" }); }
});

app.get('/user/:pseudo', async (req, res) => {
    const pseudo = req.params.pseudo;
    const currentUserId = req.session.user ? req.session.user.id : 0;

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

        let total_avis = 0;
        let total_suivis = 0;
        let isFollowing = false;

        try { 
            const [[{ count }]] = await db.query('SELECT COUNT(*) as count FROM commentaires WHERE user_id = ?', [userDb.id]);
            total_avis = count;
        } catch(e) {}

        try { 
            const [[{ count }]] = await db.query('SELECT COUNT(*) as count FROM follows WHERE following_id = ?', [userDb.id]);
            total_suivis = count;
        } catch(e) {}

        try {
            if (currentUserId) {
                const [followCheck] = await db.query("SELECT * FROM follows WHERE follower_id = ? AND following_id = ?", [currentUserId, userDb.id]);
                isFollowing = followCheck.length > 0;
            }
        } catch(e) {}

        const publicUser = {
            id: userDb.id,
            name: userDb.pseudo,
            joinDate: joinDate,
            bio: userDb.bio || "Cet utilisateur n'a pas encore de bio.",
            avatar: userDb.avatar || `https://ui-avatars.com/api/?name=${userDb.pseudo}&background=27272a&color=fff`,
            stats: { favoris: formattedFavorites.length, avis: total_avis, suivis: total_suivis }
        };

        res.render('public-profile.njk', { publicUser, favorites: formattedFavorites, isFollowing, page: 'public-profile' });
    } catch (e) { 
        res.status(500).send("Erreur serveur"); 
    }
});

app.get('/api/user/:id/followers', async (req, res) => {
    try {
        const [followers] = await db.query(`
            SELECT u.pseudo, u.avatar, f.follower_id 
            FROM users u
            JOIN follows f ON u.id = f.follower_id
            WHERE f.following_id = ?
        `, [req.params.id]);
        res.json(followers || []);
    } catch (e) {
        res.status(500).json({ error: "Erreur BDD" });
    }
});

app.delete('/api/user/followers/:followerId', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Non connecté" });
    try {
        await db.query("DELETE FROM follows WHERE follower_id = ? AND following_id = ?", [req.params.followerId, req.session.user.id]);
        res.json({ success: true });
    } catch (e) { 
        res.status(500).json({ error: "Erreur BDD" }); 
    }
});

app.post('/api/user/:id/follow', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Connectez-vous" });
    const followerId = req.session.user.id;
    const followingId = req.params.id;
    
    if (followerId == followingId) return res.json({ error: "Auto-follow" });

    try {
        const [exist] = await db.query("SELECT * FROM follows WHERE follower_id = ? AND following_id = ?", [followerId, followingId]);
        if (exist.length > 0) {
            await db.query("DELETE FROM follows WHERE follower_id = ? AND following_id = ?", [followerId, followingId]);
            res.json({ isFollowing: false });
        } else {
            await db.query("INSERT INTO follows (follower_id, following_id) VALUES (?, ?)", [followerId, followingId]);
            res.json({ isFollowing: true });
        }
    } catch (e) { 
        res.status(500).json({ error: "Erreur BDD" }); 
    }
});

app.listen(port, () => { console.log(`✅ Serveur BPM lancé sur http://localhost:${port}`); });