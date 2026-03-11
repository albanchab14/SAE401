const express = require('express');
const nunjucks = require('nunjucks');
const path = require('path');
const axios = require('axios');
const session = require('express-session');
const db = require('./src/config/database');
const bcrypt = require('bcrypt');
const multer = require('multer'); // NOUVEAU : Pour gérer l'upload de l'avatar
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

// CONFIGURATION UPLOAD AVATAR (Stocke les images dans public/images/)
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

// ==========================================
// ROUTES PUBLIQUES
// ==========================================

app.get('/', async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;
        const [dbArtists] = await db.query("SELECT * FROM featured_artists ORDER BY rang ASC LIMIT 6");
        let topArtists = [];
        
        for (let a of dbArtists) {
            let listeners = "0M";
            try {
                const infoResp = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=artist.getInfo&artist=${encodeURIComponent(a.api_artist_id)}&api_key=${API_KEY}&format=json`);
                if (infoResp.data.artist) {
                    let lst = parseInt(infoResp.data.artist.stats.listeners);
                    listeners = lst >= 1000000 ? (lst / 1000000).toFixed(1) + "M" : lst.toLocaleString('fr-FR');
                }
            } catch(e) {}
            
            topArtists.push({
                name: a.api_artist_id, listeners: listeners, image: await getRealArtistImage(a.api_artist_id),
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
                results = rawArtists.map(a => {
                    let img = a.picture_xl;
                    if (!img || img.includes('/images/artist//')) img = `https://ui-avatars.com/api/?name=${encodeURIComponent(a.name)}&background=d946ef&color=fff&size=300`;
                    return { title: a.name, artist: "Artiste", image: img, type: "Artiste", year: years || "2024" };
                });
            } else {
                let method = currentType === "Musique" ? "track.search&track=" : "album.search&album=";
                const resp = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=${method}${encodeURIComponent(searchQuery)}&api_key=${API_KEY}&format=json&limit=15`);
                let rawResults = currentType === "Musique" ? resp.data.results.trackmatches.track : resp.data.results.albummatches.album;
                rawResults = rawResults.filter((v, i, a) => a.findIndex(t => t.name.toLowerCase() === v.name.toLowerCase()) === i).slice(0, 15);
                results = await Promise.all(rawResults.map(async (item) => {
                    let img = item.image ? item.image[3]['#text'] : "";
                    if (currentType === "Musique" && (!img || img.includes("2a96cbd8"))) img = await getRealArtistImage(item.artist);
                    else if (!img) img = "https://via.placeholder.com/300?text=No+Cover";
                    return { title: item.name, artist: item.artist, image: img, type: currentType, year: years || "2024" };
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
            duration, playcount: parseInt(t.playcount).toLocaleString('fr-FR'),
            listeners: parseInt(t.listeners).toLocaleString('fr-FR'),
            wiki: t.wiki?.summary || "Aucune description.", tags: t.toptags?.tag?.slice(0, 5) || [], year: "2024"
        };

        const userId = req.session.user ? req.session.user.id : 0;
        const comments = await getItemComments(trackName, 'track', userId);

        let isFavorite = false;
        if (userId) {
            const compositeId = `${trackData.name}||${trackData.artist}||${trackData.image}`;
            const [fav] = await db.query("SELECT * FROM favorites WHERE user_id = ? AND music_id = ?", [userId, compositeId]);
            isFavorite = fav.length > 0;
        }

        res.render('details.njk', { track: trackData, comments, itemId: trackName, itemType: 'track', isFavorite });
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
            listeners: parseInt(a.stats.listeners).toLocaleString('fr-FR'),
            totalAlbums: strictAlbumCount > 0 ? strictAlbumCount : albumsResp.data.topalbums.album.length,
            bio: a.bio.summary ? a.bio.summary.split('<a')[0] : "Pas de bio disponible.",
            tags: a.tags.tag.slice(0, 6),
            albums: albumsResp.data.topalbums.album.map(alb => ({ title: alb.name, image: alb.image[3]['#text'] || 'https://via.placeholder.com/150' })),
            topTracks: tracksResp.data.toptracks.track.map((t, index) => ({ rank: index + 1, title: t.name, listeners: (parseInt(t.listeners) / 1000000).toFixed(1) + "M" }))
        };

        const userId = req.session.user ? req.session.user.id : 0;
        const comments = await getItemComments(artistName, 'artist', userId);

        res.render('artist.njk', { artist: artistData, comments, itemId: artistName, itemType: 'artist' });
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
                return { name: t.name, duration: duration > 0 ? Math.floor(duration / 60) + ":" + (duration % 60).toString().padStart(2, '0') : "--:--", rank: t['@attr']?.rank || 1, playcount: (Math.random() * (1.5 - 0.5) + 0.5).toFixed(1) + "M" };
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

        res.render('album.njk', { album: albumData, comments, itemId: itemId, itemType: 'album' });
    } catch (error) { res.status(500).send("Erreur album"); }
});

// ROUTE : NOTIFICATIONS
app.get('/notifications', async (req, res) => {
    // 1. On sécurise : il faut être connecté pour voir ses notifications !
    if (!req.session.user) {
        return res.redirect('/login');
    }

    try {
        // 2. On va chercher les notifications du mec connecté, avec les infos de celui qui a fait l'action
        const [rawNotifications] = await db.query(`
            SELECT n.*, u.pseudo as actor_pseudo, u.avatar as actor_avatar 
            FROM notifications n
            JOIN users u ON n.actor_id = u.id
            WHERE n.user_id = ? AND n.is_read = 0
            ORDER BY n.date_creation DESC
        `, [req.session.user.id]);

        // 3. On "traduit" les données de la BDD pour ton design HTML
        const notifications = rawNotifications.map(n => {
            let icon, color, bgColor, actionText;

            // On adapte le style selon le type de notif
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
                time: timeAgo(n.date_creation) // ✨ Utilisation directe de ta fonction globale !
            };
        });

        res.render('notifications.njk', { notifications, page: 'notifications' });

    } catch (error) {
        console.error("Erreur chargement notifications:", error);
        res.status(500).send("Erreur serveur.");
    }
});

// Action : Supprimer TOUTES les notifications
app.post('/notifications/read-all', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Non connecté' });
    try {
        // ✨ ON SUPPRIME TOUT AU LIEU DE JUSTE METTRE A JOUR
        await db.query('DELETE FROM notifications WHERE user_id = ?', [req.session.user.id]);
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false });
    }
});

// Action : Supprimer une seule notification (Poubelle)
app.post('/notifications/delete/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Non connecté' });
    try {
        // On supprime physiquement la ligne de la table
        await db.query('DELETE FROM notifications WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false });
    }
});



// ==========================================
// 4.5 PAGE DE PROFIL (AVEC ENRICHISSEMENT API ET LIENS)
// ==========================================
app.get('/profil', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const userId = req.session.user.id;
    const API_KEY = process.env.LASTFM_API_KEY;

    try {
        const [users] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
        const userDb = users[0];
        const dateIns = new Date(userDb.date_inscription);
        const mois = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
        const joinDate = `${mois[dateIns.getMonth()]} ${dateIns.getFullYear()}`;

        const [commentsDb] = await db.query(`
            SELECT c.*, (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id) as likes
            FROM commentaires c WHERE c.user_id = ? ORDER BY c.date_commentaire DESC
        `, [userId]);

        for (let c of commentsDb) {
            c.title = "Titre Inconnu";
            c.artist = "Artiste inconnu";
            c.image = "https://via.placeholder.com/150?text=BPM";
            c.url = "#"; // Par défaut
            
            try {
                if (c.item_type === 'album') {
                    let parts = c.music_item_id.split('::');
                    c.artist = parts[0] || 'Inconnu';
                    c.title = parts[1] || c.music_item_id;
                    c.url = `/album/${encodeURIComponent(c.artist)}/${encodeURIComponent(c.title)}`;
                    const resp = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=album.getInfo&api_key=${API_KEY}&artist=${encodeURIComponent(c.artist)}&album=${encodeURIComponent(c.title)}&format=json`);
                    if (resp.data.album && resp.data.album.image) c.image = resp.data.album.image[3]['#text'] || c.image;
                } else if (c.item_type === 'track') {
                    c.title = c.music_item_id;
                    c.url = `/details/${encodeURIComponent(c.title)}`;
                    const resp = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=track.search&track=${encodeURIComponent(c.title)}&api_key=${API_KEY}&format=json&limit=1`);
                    if (resp.data.results && resp.data.results.trackmatches.track.length > 0) {
                        const trk = resp.data.results.trackmatches.track[0];
                        c.artist = trk.artist;
                        if (trk.image && trk.image[3]) c.image = trk.image[3]['#text'] || c.image;
                    }
                } else if (c.item_type === 'artist') {
                    c.title = c.music_item_id;
                    c.artist = "Artiste";
                    c.url = `/artiste/${encodeURIComponent(c.title)}`;
                    c.image = await getRealArtistImage(c.title);
                }
            } catch(err) {}
        }

        const [favoritesDb] = await db.query('SELECT * FROM favorites WHERE user_id = ? ORDER BY date_ajout DESC', [userId]);
        const formattedFavorites = favoritesDb.map(f => {
            const parts = f.music_id.split('||');
            return {
                title: parts[0] || 'Titre inconnu',
                artist: parts[1] || 'Artiste inconnu',
                image: parts[2] || 'https://via.placeholder.com/300',
                url: `/details/${encodeURIComponent(parts[0] || '')}`
            };
        });

        const [[{ total_avis }]] = await db.query('SELECT COUNT(*) as total_avis FROM commentaires WHERE user_id = ?', [userId]);
        const [[{ total_likes }]] = await db.query('SELECT COUNT(*) as total_likes FROM comment_likes cl JOIN commentaires c ON cl.comment_id = c.id WHERE c.user_id = ?', [userId]);
        const [[{ total_suivis }]] = await db.query('SELECT COUNT(*) as total_suivis FROM follows WHERE follower_id = ?', [userId]);

        res.render('profil.njk', { 
            user: { ...userDb, name: userDb.pseudo, joinDate, bio: userDb.bio || "Mélomane.", avatar: userDb.avatar || `https://ui-avatars.com/api/?name=${userDb.pseudo}&background=27272a&color=fff`, stats: { favoris: formattedFavorites.length, avis: total_avis, suivis: total_suivis } },
            comments: commentsDb, favorites: formattedFavorites, impact: { month: "MARS 2026", albumsRated: total_avis, musicCommented: total_avis, likesReceived: total_likes }, page: 'profil'
        });
    } catch (e) { res.status(500).send("Erreur de chargement du profil"); }
});


// API : MODIFIER LE PROFIL (AVATAR + NETTOYAGE MAIL + BCRYPT PASSWORD)
app.post('/api/profil/edit', upload.single('avatar'), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Non connecté" });
    try {
        const { pseudo, email, bio, password } = req.body;
        const userId = req.session.user.id;
        
        // Sécurité : pas d'espaces dans l'email
        const cleanEmail = email.replace(/\s+/g, '');

        let updateQuery = "UPDATE users SET pseudo = ?, email = ?, bio = ? WHERE id = ?";
        let queryParams = [pseudo, cleanEmail, bio, userId];

        // Si une nouvelle photo est envoyée
        if (req.file) {
            const avatarPath = '/images/' + req.file.filename;
            await db.query("UPDATE users SET avatar = ? WHERE id = ?", [avatarPath, userId]);
            req.session.user.avatar = avatarPath;
        }

        // Si un nouveau mot de passe est saisi
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

// API DIVERSES
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

// ==========================================
// API : SYSTÈME DE COMMENTAIRES 
// ==========================================

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
        const userId = req.session.user.id; // L'utilisateur qui clique sur "Like"
        
        const [exist] = await db.query("SELECT * FROM comment_likes WHERE user_id = ? AND comment_id = ?", [userId, commentId]);
        
        if (exist.length > 0) {
            // SI LE LIKE EXISTE DÉJÀ : On l'enlève (Unlike)
            await db.query("DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?", [userId, commentId]);
            res.json({ liked: false });
        } else {
            // SI LE LIKE N'EXISTE PAS : On l'ajoute
            await db.query("INSERT INTO comment_likes (user_id, comment_id) VALUES (?, ?)", [userId, commentId]);
            
            // ✨ LA MAGIE DES NOTIFICATIONS COMMENCE ICI ✨
            // On récupère l'auteur du commentaire et le nom de l'album
            const [comments] = await db.query("SELECT user_id, music_item_id FROM commentaires WHERE id = ?", [commentId]);
            
            if (comments.length > 0) {
                const authorId = comments[0].user_id;
                const reference = comments[0].music_item_id;
                
                // On n'envoie la notification QUE SI on ne like pas son propre commentaire !
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
        console.error("Erreur lors du like :", e);
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

// ==========================================
// AUTHENTIFICATION
// ==========================================

app.get('/login', (req, res) => res.render('login.njk', { page: 'login' }));
app.get('/register', (req, res) => res.render('register.njk', { page: 'register' }));
app.get('/connexion', (req, res) => res.redirect('/login'));
app.get('/inscription', (req, res) => res.redirect('/register'));

app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        
        if (users.length === 0) {
            return res.render('login.njk', { 
                page: 'login', 
                error: "Aucun compte n'est associé à cette adresse email." 
            });
        }

        const user = users[0];

        const isMatch = await bcrypt.compare(password, user.password);

        if (isMatch) {
            const [settings] = await db.query('SELECT is_maintenance FROM site_settings WHERE id = 1');
            const isMaintenance = settings.length > 0 ? settings[0].is_maintenance : false;

            if (isMaintenance && user.role !== 'admin') return res.render('login.njk', { page: 'login', error: "🛠 Le site est en maintenance." });
            if (user.is_banned == 1) return res.render('login.njk', { page: 'login', error: "🚨 Votre compte a été banni." });

            req.session.user = {
                id: user.id,
                pseudo: user.pseudo,
                role: user.role,
                avatar: user.avatar
            };
            res.redirect(user.role === 'admin' ? '/admin' : '/');
        } else {
            return res.render('login.njk', { 
                page: 'login', 
                error: "Le mot de passe est incorrect." 
            });
        }
    } catch (error) {
        console.error(error);
        res.render('login.njk', { page: 'login', error: "Erreur serveur." });
    }
});

app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;

    try {
        const [existingUsers] = await db.query(
            'SELECT * FROM users WHERE email = ? OR pseudo = ?', 
            [email, username]
        );
        
        if (existingUsers.length > 0) {
            return res.render('register.njk', { 
                page: 'register', 
                error: "Cet email ou ce nom d'utilisateur est déjà utilisé." 
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const [result] = await db.query(
            'INSERT INTO users (pseudo, email, password, role) VALUES (?, ?, ?, ?)',
            [username, email, hashedPassword, 'utilisateur'] 
        );

        req.session.user = {
            id: result.insertId, 
            pseudo: username,
            role: 'utilisateur',
            avatar: null
        };

        res.redirect('/');

    } catch (error) {
        console.error(error);
        res.render('register.njk', { 
            page: 'register', 
            error: "Une erreur est survenue lors de l'inscription." 
        });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});


// ==========================================
// DASHBOARD ADMIN (SÉCURISÉ)
// ==========================================

app.get('/admin', requireAdmin, async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;

        const [settings] = await db.query('SELECT is_maintenance FROM site_settings WHERE id = 1');
        const isMaintenance = settings.length > 0 ? settings[0].is_maintenance : false;

        const [users] = await db.query("SELECT id, pseudo, email, role, is_banned FROM users ORDER BY id DESC LIMIT 50");
        
        const [reports] = await db.query(`
            SELECT c.id as comment_id, u.pseudo, c.commentaire as comment, c.music_item_id, c.item_type, rc.reason, COUNT(rc.id) as count 
            FROM reports_commentaire rc
            JOIN commentaires c ON rc.commentaire_id = c.id
            JOIN users u ON c.user_id = u.id
            GROUP BY c.id, u.pseudo, c.commentaire, c.music_item_id, c.item_type, rc.reason
            ORDER BY count DESC
        `);

        reports.forEach(r => {
            const itemId = r.music_item_id ? r.music_item_id.trim() : '';
            if (r.item_type === 'track') {
                r.url = '/details/' + encodeURIComponent(itemId);
            } else if (r.item_type === 'artist') {
                r.url = '/artiste/' + encodeURIComponent(itemId);
            } else if (r.item_type === 'album') {
                if (itemId.includes('::')) { 
                    let parts = itemId.split('::'); 
                    r.url = '/album/' + encodeURIComponent(parts[0]) + '/' + encodeURIComponent(parts[1]);
                } else if (itemId.includes('-')) { 
                    let parts = itemId.split('-');
                    r.url = '/album/' + encodeURIComponent(parts[0]) + '/' + encodeURIComponent(parts.slice(1).join('-'));
                } else {
                    r.url = '#'; 
                }
            } else {
                r.url = '#';
            }
        });

        const [dbArtists] = await db.query("SELECT * FROM featured_artists ORDER BY rang ASC, id ASC LIMIT 6");
        let featuredArtists = [];
        
        for (let i = 0; i < dbArtists.length; i++) {
            const a = dbArtists[i];
            let listeners = "0M";
            try {
                const infoResp = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=artist.getInfo&artist=${encodeURIComponent(a.api_artist_id)}&api_key=${API_KEY}&format=json`);
                if (infoResp.data.artist) {
                    let lst = parseInt(infoResp.data.artist.stats.listeners);
                    listeners = lst >= 1000000 ? (lst / 1000000).toFixed(1) + "M" : lst.toLocaleString('fr-FR');
                }
            } catch(e) {}
            
            featuredArtists.push({
                db_id: a.id, position: a.rang, name: a.api_artist_id,
                listeners: listeners, image: await getRealArtistImage(a.api_artist_id), desc: a.accroche || ""
            });
        }

        const [[{ totalU }]] = await db.query("SELECT COUNT(*) as totalU FROM users");
        const [[{ totalC }]] = await db.query("SELECT COUNT(*) as totalC FROM commentaires");
        const [[{ totalR }]] = await db.query("SELECT COUNT(*) as totalR FROM reports_commentaire");

        res.render('admin.njk', { 
            page: 'admin', users, reports, featuredArtists, isMaintenance: isMaintenance,
            stats: { users: totalU.toLocaleString('fr-FR'), comments: totalC.toLocaleString('fr-FR'), reports: totalR, artists: featuredArtists.length }
        });
    } catch (error) { res.status(500).send("Erreur serveur lors du chargement du Dashboard."); }
});

app.use('/api/admin', requireAdmin);

app.post('/api/admin/maintenance', async (req, res) => {
    try {
        const isActive = req.body.active ? 1 : 0;
        await db.query("UPDATE site_settings SET is_maintenance = ? WHERE id = 1", [isActive]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

app.post('/api/admin/users/:id/role', async (req, res) => {
    try {
        const { role } = req.body;
        await db.query("UPDATE users SET role = ? WHERE id = ?", [role, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

app.post('/api/admin/users/:id/ban', async (req, res) => {
    try {
        const [users] = await db.query("SELECT is_banned FROM users WHERE id = ?", [req.params.id]);
        if (users.length === 0) return res.status(404).json({ error: "Introuvable" });
        const newStatus = users[0].is_banned == 1 ? 0 : 1; 
        await db.query("UPDATE users SET is_banned = ? WHERE id = ?", [newStatus, req.params.id]);
        res.json({ success: true, is_banned: newStatus });
    } catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

app.delete('/api/admin/users/:id', async (req, res) => {
    try {
        await db.query("DELETE FROM users WHERE id = ?", [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

app.post('/api/admin/reports/:comment_id/ignore', async (req, res) => {
    try {
        await db.query("DELETE FROM reports_commentaire WHERE commentaire_id = ?", [req.params.comment_id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

app.delete('/api/admin/comments/:id', async (req, res) => {
    try {
        await db.query("DELETE FROM commentaires WHERE id = ?", [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

app.post('/api/admin/artists/replace', async (req, res) => {
    try {
        const { oldArtistId, newArtistName } = req.body;
        const [existing] = await db.query("SELECT * FROM featured_artists WHERE LOWER(api_artist_id) = LOWER(?)", [newArtistName]);
        if (existing.length > 0) return res.json({ error: "Cet artiste est déjà à la une !" });
        await db.query("UPDATE featured_artists SET api_artist_id = ?, accroche = NULL WHERE id = ?", [newArtistName, oldArtistId]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur" }); }
});

app.post('/api/admin/artists/:id/randomize', async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;
        const randomPage = Math.floor(Math.random() * 10) + 1;
        const respArt = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=chart.gettopartists&api_key=${API_KEY}&format=json&limit=50&page=${randomPage}`);
        const allArtists = respArt.data.artists.artist.map(a => a.name).sort(() => 0.5 - Math.random());

        const [currentDb] = await db.query("SELECT api_artist_id FROM featured_artists");
        const currentNames = currentDb.map(row => row.api_artist_id.toLowerCase());

        let randomArtist = allArtists.find(name => !currentNames.includes(name.toLowerCase()));
        if (!randomArtist) randomArtist = "Daft Punk";

        await db.query("UPDATE featured_artists SET api_artist_id = ?, accroche = NULL WHERE id = ?", [randomArtist, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur" }); }
});

app.post('/api/admin/artists/reorder', async (req, res) => {
    try {
        const { id, newPosition } = req.body;
        const [current] = await db.query("SELECT rang FROM featured_artists WHERE id = ?", [id]);
        const oldPosition = current[0].rang;

        await db.query("UPDATE featured_artists SET rang = ? WHERE rang = ?", [oldPosition, newPosition]);
        await db.query("UPDATE featured_artists SET rang = ? WHERE id = ?", [newPosition, id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur" }); }
});

app.post('/api/admin/artists/description', async (req, res) => {
    try {
        const { id, desc } = req.body;
        await db.query("UPDATE featured_artists SET accroche = ? WHERE id = ?", [desc, id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur" }); }
});

app.listen(port, () => { console.log(`✅ Serveur BPM lancé sur http://localhost:${port}`); });