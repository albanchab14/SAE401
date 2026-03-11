const express = require('express');
const nunjucks = require('nunjucks');
const path = require('path');
const axios = require('axios');
const session = require('express-session');
const db = require('./src/config/database'); // Connexion MySQL
require('dotenv').config();

const app = express();
const port = 3000;

// ==========================================
// 1. CONFIGURATION ET MIDDLEWARES GLOBAUX
// ==========================================

nunjucks.configure('views', { autoescape: true, express: app });
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // Indispensable pour l'API Admin

app.use(session({
    secret: 'bpm_super_secret_key',
    resave: false,
    saveUninitialized: false
}));

// Variable globale pour la maintenance
global.MAINTENANCE_MODE = false;

// Middleware de Maintenance (Bloque l'accès si activé)
app.use((req, res, next) => {
    if (global.MAINTENANCE_MODE && !req.path.startsWith('/css') && !req.path.startsWith('/images') && !req.path.startsWith('/api')) {
        const isAdmin = req.session.user && req.session.user.role === 'admin';
        if (!isAdmin && req.path !== '/login' && req.path !== '/connexion') {
            return res.status(503).send("<body style='background:#09090b; color:white; font-family:sans-serif; text-align:center; padding-top:100px;'><h1>🛠 Site en maintenance</h1><p>BPM revient très vite, nos équipes travaillent sur une mise à jour !</p></body>");
        }
    }
    next();
});

// Middleware Global (Variables Nunjucks accessibles partout)
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// VIGILE ADMIN : Middleware de sécurité stricte pour l'Admin
function requireAdmin(req, res, next) {
    if (!req.session.user || req.session.user.role !== 'admin') {
        // Si c'est une requête API (un bouton cliqué), on renvoie une erreur JSON
        if (req.path.startsWith('/api/')) {
            return res.status(403).json({ error: "Accès refusé. Réservé aux administrateurs." });
        }
        // Sinon, on redirige vers l'accueil
        return res.redirect('/');
    }
    next(); // L'utilisateur est bien admin, on le laisse passer !
}

// Fonction utilitaire (Image Deezer)
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

// ==========================================
// 2. ROUTES PUBLIQUES (Accueil, Recherche...)
// ==========================================

app.get('/', async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;
        const respArt = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=chart.gettopartists&api_key=${API_KEY}&format=json&limit=6`);
        
        const topArtists = await Promise.all(respArt.data.artists.artist.map(async a => {
            let listenerCount = parseInt(a.listeners);
            let formattedListeners = listenerCount >= 1000000 ? (listenerCount / 1000000).toFixed(1) + "M" : listenerCount.toLocaleString('fr-FR');
            return { name: a.name, listeners: formattedListeners, image: await getRealArtistImage(a.name) };
        }));

        const randomPage = Math.floor(Math.random() * 50) + 1;
        const respMatch = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=rj&api_key=${API_KEY}&format=json&limit=10&page=${randomPage}`);
        const initialMatch = respMatch.data.topalbums.album.sort(() => 0.5 - Math.random()).slice(0, 3).map(alb => ({
            title: alb.name, artist: alb.artist.name, image: alb.image[3]['#text'] || "https://via.placeholder.com/300"
        }));

        res.render('index.njk', { topArtists, heroArtist: topArtists[0], initialMatch, page: 'home' });
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
        res.render('details.njk', { track: trackData });
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
        res.render('artist.njk', { artist: artistData });
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
        res.render('album.njk', { album: albumData });
    } catch (error) { res.status(500).send("Erreur album"); }
});

app.get('/notifications', (req, res) => {
    const notifications = []; // Vide pour le moment
    res.render('notifications.njk', { notifications, page: 'notifications' });
});

// ==========================================
// 3. API PUBLIQUE (Boutons Match et Recherche)
// ==========================================

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
// 4. AUTHENTIFICATION (Login / Register)
// ==========================================

app.get('/login', (req, res) => res.render('login.njk', { page: 'login' }));
app.get('/register', (req, res) => res.render('register.njk', { page: 'register' }));
app.get('/connexion', (req, res) => res.redirect('/login'));
app.get('/inscription', (req, res) => res.redirect('/register'));

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.render('login.njk', { page: 'login', error: "Email introuvable." });
        
        const user = users[0];
        
        if (password === user.password) {
            // 1. VÉRIFICATION MAINTENANCE (Seul l'admin passe)
            if (global.MAINTENANCE_MODE && user.role !== 'admin') {
                return res.render('login.njk', { page: 'login', error: "🛠 Le site est en maintenance. Seuls les administrateurs peuvent se connecter." });
            }
            // 2. VÉRIFICATION BANNISSEMENT (is_banned est un booléen / 0 ou 1)
            if (user.is_banned == 1) {
                return res.render('login.njk', { page: 'login', error: "🚨 Votre compte a été banni par un administrateur." });
            }

            req.session.user = { id: user.id, pseudo: user.pseudo, role: user.role, avatar: user.avatar };
            res.redirect('/');
        } else {
            res.render('login.njk', { page: 'login', error: "Mot de passe incorrect." });
        }
    } catch (error) { res.render('login.njk', { page: 'login', error: "Erreur serveur." }); }
});

app.post('/register', (req, res) => {
    const { pseudo, email, password } = req.body;
    // TODO : Insérer l'utilisateur en BDD
    res.send("Formulaire d'inscription reçu ! Regarde ton terminal Node.js.");
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});


// ==========================================
// 5. LE DASHBOARD ADMIN (SÉCURISÉ)
// ==========================================

// On applique le vigile "requireAdmin" UNIQUEMENT sur la page /admin
app.get('/admin', requireAdmin, async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;

        // Utilisateurs
        const [users] = await db.query("SELECT id, pseudo, email, role, is_banned FROM users ORDER BY id DESC LIMIT 50");
        
        // Signalements
        const [reports] = await db.query(`
            SELECT c.id as comment_id, u.pseudo, c.commentaire as comment, rc.reason, COUNT(rc.id) as count 
            FROM reports_commentaire rc
            JOIN commentaires c ON rc.commentaire_id = c.id
            JOIN users u ON c.user_id = u.id
            GROUP BY c.id, u.pseudo, c.commentaire, rc.reason
            ORDER BY count DESC
        `);

        // Artistes à la une
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
                db_id: a.id,
                position: a.rang,
                name: a.api_artist_id,
                listeners: listeners,
                image: await getRealArtistImage(a.api_artist_id),
                desc: a.accroche || ""
            });
        }

        // Stats globales
        const [[{ totalU }]] = await db.query("SELECT COUNT(*) as totalU FROM users");
        const [[{ totalC }]] = await db.query("SELECT COUNT(*) as totalC FROM commentaires");
        const [[{ totalR }]] = await db.query("SELECT COUNT(*) as totalR FROM reports_commentaire");

        res.render('admin.njk', { 
            page: 'admin', 
            users, reports, featuredArtists,
            isMaintenance: global.MAINTENANCE_MODE,
            stats: { users: totalU.toLocaleString('fr-FR'), comments: totalC.toLocaleString('fr-FR'), reports: totalR, artists: featuredArtists.length }
        });
    } catch (error) {
        console.error("Erreur Dashboard:", error);
        res.status(500).send("Erreur serveur lors du chargement du Dashboard.");
    }
});


// ==========================================
// 6. API ADMIN : ACTIONS (SÉCURISÉES)
// ==========================================
// On applique le vigile "requireAdmin" à TOUTES les requêtes qui commencent par /api/admin/
app.use('/api/admin', requireAdmin);

// MAINTENANCE
app.post('/api/admin/maintenance', (req, res) => {
    global.MAINTENANCE_MODE = req.body.active;
    res.json({ success: true });
});

// UTILISATEURS
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

// ==========================================
// API ADMIN : GESTION DES COMMENTAIRES
// ==========================================

// Bouton VALIDER (Check) : Ignorer le signalement
app.post('/api/admin/reports/:comment_id/ignore', async (req, res) => {
    try {
        // Ça supprime UNIQUEMENT le signalement.
        // Le commentaire est donc "blanchi" et reste visible par les autres utilisateurs.
        await db.query("DELETE FROM reports_commentaire WHERE commentaire_id = ?", [req.params.comment_id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

// Bouton POUBELLE : Supprimer le commentaire signalé
app.delete('/api/admin/comments/:id', async (req, res) => {
    try {
        // Ça supprime LE commentaire ciblé. 
        // (Et grâce au "ON DELETE CASCADE" de ta base de données, ça effacera automatiquement les signalements liés à ce commentaire précis, sans toucher aux autres commentaires !)
        await db.query("DELETE FROM commentaires WHERE id = ?", [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

// ARTISTES À LA UNE
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
        const respArt = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=chart.gettopartists&api_key=${API_KEY}&format=json&limit=50`);
        const allArtists = respArt.data.artists.artist.map(a => a.name);

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

// ==========================================
// LANCEMENT DU SERVEUR
// ==========================================
app.listen(port, () => { 
    console.log(`✅ Serveur BPM lancé sur http://localhost:${port}`); 
});