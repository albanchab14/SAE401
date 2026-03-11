const express = require('express');
const nunjucks = require('nunjucks');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = 3000;

nunjucks.configure('views', {
    autoescape: true,
    express: app
});

app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// PATCH SECRET : DEEZER UNIQUEMENT POUR LES PHOTOS MANQUANTES
// ==========================================
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
// ROUTE 1 : ACCUEIL
// ==========================================
app.get('/', async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;
        const respArt = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=chart.gettopartists&api_key=${API_KEY}&format=json&limit=6`);
        
        const topArtists = await Promise.all(respArt.data.artists.artist.map(async a => ({
            name: a.name,
            listeners: parseInt(a.listeners).toLocaleString('fr-FR'),
            image: await getRealArtistImage(a.name) // Le patch photo
        })));

        const randomPage = Math.floor(Math.random() * 50) + 1;
        const respMatch = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=rj&api_key=${API_KEY}&format=json&limit=10&page=${randomPage}`);
        const initialMatch = respMatch.data.topalbums.album.sort(() => 0.5 - Math.random()).slice(0, 3).map(alb => ({
            title: alb.name, artist: alb.artist.name,
            image: alb.image[3]['#text'] || "https://via.placeholder.com/300"
        }));

        res.render('index.njk', { topArtists, heroArtist: topArtists[0], initialMatch, page: 'home' });
    } catch (e) { res.status(500).send("Erreur Accueil"); }
});

// ==========================================
// ROUTE : API MATCH (BOUTON LANCER LE MATCH)
// ==========================================
app.get('/api/match', async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;
        const randomPage = Math.floor(Math.random() * 100) + 1;
        
        // On va chercher une page aléatoire de musiques
        const response = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=rj&api_key=${API_KEY}&format=json&limit=30&page=${randomPage}`);
        const albums = response.data.topalbums.album;
        
        // On mélange les résultats
        const shuffled = albums.sort(() => 0.5 - Math.random());
        
        const result = [];
        const seenArtists = new Set();
        
        // On en sélectionne 3 au hasard avec des vraies images
        for (let alb of shuffled) {
            let img = alb.image[3]['#text'];
            if (img && !img.includes('2a96cbd8') && !seenArtists.has(alb.artist.name)) {
                result.push({ title: alb.name, artist: alb.artist.name, image: img });
                seenArtists.add(alb.artist.name);
            }
            if (result.length === 3) break;
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: "Erreur Match" });
    }
});

// ==========================================
// ROUTE 2 : API SUGGESTIONS 
// ==========================================
app.get('/api/suggest', async (req, res) => {
    try {
        const { q } = req.query;
        const API_KEY = process.env.LASTFM_API_KEY;
        if (!q || q.length < 2) return res.json([]);

        // On utilise Deezer pour l'autocomplete Artiste pour éviter les doublons horribles de Last.fm
        const [artResp, albResp] = await Promise.all([
            axios.get(`https://api.deezer.com/search/artist?q=${encodeURIComponent(q)}&limit=4`),
            axios.get(`https://ws.audioscrobbler.com/2.0/?method=album.search&album=${encodeURIComponent(q)}&api_key=${API_KEY}&format=json&limit=4`)
        ]);

        let deezerArtists = artResp.data.data || [];
        deezerArtists = deezerArtists.filter(a => !((a.name.includes('&') || a.name.includes(' feat')) && !q.includes('&')));
        const artists = deezerArtists.slice(0, 4).map(a => ({ title: a.name, artist: "Artiste", type: "artiste" }));
        
        const albums = albResp.data.results.albummatches.album.map(a => ({ title: a.name, artist: a.artist, type: "album" }));
        const combined = [...artists, ...albums];
        res.json(combined);
    } catch (e) { res.json([]); }
});

// ==========================================
// ROUTE 3 : RECHERCHE GLOBALE
// ==========================================
app.get('/search', async (req, res) => {
    try {
        const { q, type, tag, years } = req.query;
        const API_KEY = process.env.LASTFM_API_KEY;
        const searchQuery = q ? q.trim() : "";
        const currentType = type || "Album";
        let results = [];

        if (searchQuery !== "") {
            // Pour les Artistes, on cherche avec Deezer pour avoir les VRAIES PHOTOS sans doublons
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
            } 
            // Pour le reste (Albums, Musiques), on utilise 100% Last.fm
            else {
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

// ==========================================
// ROUTE 4 : FICHE DÉTAILS MUSIQUE
// ==========================================
app.get('/details/:name', async (req, res) => {
    // [Le code de la fiche musique reste inchangé, il utilise Last.fm]
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

// ==========================================
// ROUTE 5 : FICHE ARTISTE (LE MIX PARFAIT)
// ==========================================
app.get('/artiste/:name', async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;
        const artistName = req.params.name;

        // 1. On récupère 90% des infos sur Last.fm (Bio, Top 4 albums populaires, Top Titres, Auditeurs)
        const [infoResp, albumsResp, tracksResp] = await Promise.all([
            axios.get(`https://ws.audioscrobbler.com/2.0/?method=artist.getInfo&artist=${encodeURIComponent(artistName)}&api_key=${API_KEY}&format=json`),
            axios.get(`https://ws.audioscrobbler.com/2.0/?method=artist.getTopAlbums&artist=${encodeURIComponent(artistName)}&api_key=${API_KEY}&format=json&limit=4`),
            axios.get(`https://ws.audioscrobbler.com/2.0/?method=artist.getTopTracks&artist=${encodeURIComponent(artistName)}&api_key=${API_KEY}&format=json&limit=5`)
        ]);

        const a = infoResp.data.artist;
        let finalImage = `https://ui-avatars.com/api/?name=${encodeURIComponent(artistName)}&background=d946ef&color=fff&size=500`;
        let strictAlbumCount = 4;

        // 2. LE PATCH SECRET DEEZER (Juste pour la photo HD et le vrai nombre d'albums studios)
        try {
            const cleanName = artistName.split(',')[0].split('&')[0].trim();
            const dzResp = await axios.get(`https://api.deezer.com/search/artist?q=${encodeURIComponent(cleanName)}`);
            
            if (dzResp.data && dzResp.data.data && dzResp.data.data.length > 0) {
                const dzArtist = dzResp.data.data[0];
                
                // Photo HD
                if (dzArtist.picture_xl && !dzArtist.picture_xl.includes('/images/artist//')) {
                    finalImage = dzArtist.picture_xl;
                }

                // Compteur strict (on rejette les best-of, remixes, etc.)
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
                    strictAlbumCount = albumsPurifies.length; // Pour Michael Jackson, ça donnera un chiffre autour de 10-15 !
                }
            }
        } catch (e) {}

        const artistData = {
            name: a.name,
            image: finalImage, // La vraie photo HD
            listeners: parseInt(a.stats.listeners).toLocaleString('fr-FR'), // Les stats Last.fm
            totalAlbums: strictAlbumCount > 0 ? strictAlbumCount : albumsResp.data.topalbums.album.length, // Le VRAI chiffre
            bio: a.bio.summary ? a.bio.summary.split('<a')[0] : "Pas de bio disponible.", // La bio Last.fm
            tags: a.tags.tag.slice(0, 6),
            albums: albumsResp.data.topalbums.album.map(alb => ({
                title: alb.name,
                image: alb.image[3]['#text'] || 'https://via.placeholder.com/150'
            })),
            topTracks: tracksResp.data.toptracks.track.map((t, index) => ({
                rank: index + 1,
                title: t.name,
                listeners: (parseInt(t.listeners) / 1000000).toFixed(1) + "M"
            }))
        };

        res.render('artist.njk', { artist: artistData });
    } catch (error) { res.status(500).send("Artiste introuvable"); }
});

// ==========================================
// ROUTE 6 : FICHE ALBUM
// ==========================================
app.get('/album/:artist/:album', async (req, res) => {
    // [Identique, full Last.fm]
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

app.listen(port, () => { console.log(`✅ Serveur BPM lancé sur http://localhost:${port}`); });


// ==========================================
// ROUTE : NOTIFICATIONS
// ==========================================
app.get('/notifications', (req, res) => {
    
    // Pour l'instant on a pas de base de données, donc on envoie un tableau vide
    const notifications = [];

    /* // Quand tu voudras tester le design avec des fausses données, décommente ça :
    const notifications = [
        { type: 'like', icon: 'heart', color: '#e12afb', bgColor: 'rgba(225, 42, 251, 0.1)', user: 'Sarah_K', action: 'a aimé votre commentaire sur Starboy', time: 'Il y a 10 min' },
        { type: 'follow', icon: 'user-plus', color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.1)', user: 'Marc_Music', action: 'a commencé à vous suivre', time: 'Il y a 2 heures' },
        { type: 'rating', icon: 'star', color: '#eab308', bgColor: 'rgba(234, 179, 8, 0.1)', user: 'Vinyl_Lover', action: 'a noté 5 étoiles un album que vous avez aimé', time: 'Hier' }
    ];
    */

    res.render('notifications.njk', { notifications, page: 'notifications' });
});