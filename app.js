const express = require('express');
const nunjucks = require('nunjucks');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = 3000;

// Configuration Nunjucks
nunjucks.configure('views', {
    autoescape: true,
    express: app
});

app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// ROUTE 1 : ACCUEIL
// ==========================================
app.get('/', async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;
        const respArt = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=chart.gettopartists&api_key=${API_KEY}&format=json&limit=6`);
        const topArtists = respArt.data.artists.artist.map(a => ({
            name: a.name,
            listeners: a.listeners,
            image: a.image[3]['#text']
        }));

        const randomPage = Math.floor(Math.random() * 50) + 1;
        const respMatch = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=rj&api_key=${API_KEY}&format=json&limit=10&page=${randomPage}`);
        const albums = respMatch.data.topalbums.album;
        const initialMatch = albums.sort(() => 0.5 - Math.random()).slice(0, 3).map(alb => ({
            title: alb.name,
            artist: alb.artist.name,
            image: alb.image[3]['#text']
        }));

        res.render('index.njk', { topArtists, heroArtist: topArtists[0], initialMatch, page: 'home' });
    } catch (e) {
        res.status(500).send("Erreur API Last.fm");
    }
});

// ==========================================
// ROUTE 2 : API MATCH (BOUTON)
// ==========================================
app.get('/api/match', async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;
        const randomPage = Math.floor(Math.random() * 100) + 1;
        const response = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=rj&api_key=${API_KEY}&format=json&limit=30&page=${randomPage}`);
        const albums = response.data.topalbums.album;
        const shuffled = albums.sort(() => 0.5 - Math.random());
        
        const result = [];
        const seenArtists = new Set();
        for (let alb of shuffled) {
            let img = alb.image[3]['#text'];
            if (img && !img.includes('2a96cbd8b46e442fc41c2b86b821562f') && !seenArtists.has(alb.artist.name)) {
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
// ROUTE : API SUGGESTIONS (AUTOCOMPLETE)
// ==========================================
app.get('/api/suggest', async (req, res) => {
    try {
        const { q } = req.query;
        const API_KEY = process.env.LASTFM_API_KEY;
        if (!q || q.length < 2) return res.json([]);

        // On cherche Artistes et Albums en simultané
        const [artResp, albResp] = await Promise.all([
            axios.get(`https://ws.audioscrobbler.com/2.0/?method=artist.search&artist=${encodeURIComponent(q)}&api_key=${API_KEY}&format=json&limit=3`),
            axios.get(`https://ws.audioscrobbler.com/2.0/?method=album.search&album=${encodeURIComponent(q)}&api_key=${API_KEY}&format=json&limit=3`)
        ]);

        const artists = artResp.data.results.artistmatches.artist.map(a => ({ 
            title: a.name, 
            artist: "Artiste", 
            type: "artiste" 
        }));
        const albums = albResp.data.results.albummatches.album.map(a => ({ 
            title: a.name, 
            artist: a.artist, 
            type: "album" 
        }));

        // Fusion et suppression des doublons
        const combined = [...artists, ...albums];
        const unique = combined.filter((v, i, a) => a.findIndex(t => t.title === v.title) === i);

        res.json(unique);
    } catch (e) { res.json([]); }
});


// ==========================================
// ROUTE 3 : RECHERCHE & FILTRES (VERSION CORRIGÉE)
// ==========================================
app.get('/search', async (req, res) => {
    try {
        const { q, tag, type, years } = req.query;
        const API_KEY = process.env.LASTFM_API_KEY;
        const searchQuery = q ? q.trim() : "";
        const currentType = type || "Album";
        let results = [];

        if (searchQuery) {
            let method = "";
            if (currentType === "Artiste") method = "artist.search&artist=";
            else if (currentType === "Musique") method = "track.search&track=";
            else method = "album.search&album=";

            const resp = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=${method}${encodeURIComponent(searchQuery)}&api_key=${API_KEY}&format=json&limit=15`);
            
            let rawResults = [];
            if (currentType === "Artiste") rawResults = resp.data.results.artistmatches.artist;
            else if (currentType === "Musique") rawResults = resp.data.results.trackmatches.track;
            else rawResults = resp.data.results.albummatches.album;

            // Filtrage des doublons de nom pour éviter d'avoir 3 fois "The Weeknd"
            const filteredRaw = rawResults.filter((v, i, a) => a.findIndex(t => (t.name === v.name)) === i);

            // Pour chaque résultat, on s'assure d'avoir une image
            results = await Promise.all(filteredRaw.map(async (item) => {
                let img = item.image ? item.image[3]['#text'] : "";

                // Si c'est un artiste ou si l'image est le placeholder gris par défaut de Last.fm
                if (currentType === "Artiste" || !img || img.includes("2a96cbd8")) {
                    try {
                        const detailMethod = currentType === "Artiste" ? "artist.getinfo&artist=" : "track.getinfo&artist=" + encodeURIComponent(item.artist) + "&track=";
                        const info = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=${detailMethod}${encodeURIComponent(item.name)}&api_key=${API_KEY}&format=json`);
                        
                        if (currentType === "Artiste") {
                            img = info.data.artist.image[3]['#text'];
                        } else if (info.data.track.album) {
                            img = info.data.track.album.image[3]['#text'];
                        }
                    } catch(e) { img = ""; }
                }

                return {
                    title: item.name,
                    artist: item.artist || "Artiste",
                    image: img || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.name)}&background=random&size=300`,
                    type: currentType,
                    year: years || "2024"
                };
            }));
        }

        res.render('search.njk', { 
            results, 
            query: searchQuery, 
            currentTag: tag || "Tous", 
            currentType, 
            currentYears: years || "Toutes" 
        });
    } catch (e) {
        console.error(e);
        res.render('search.njk', { results: [], query: "Erreur" });
    }
});


// ==========================================
// ROUTE 4 : FICHE DÉTAILS
// ==========================================
app.get('/details/:name', async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;
        const trackName = req.params.name;
        
        const searchResp = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=track.search&track=${encodeURIComponent(trackName)}&api_key=${API_KEY}&format=json&limit=1`);
        const found = searchResp.data.results.trackmatches.track[0];
        
        const infoResp = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${API_KEY}&artist=${encodeURIComponent(found.artist)}&track=${encodeURIComponent(found.name)}&format=json`);
        const t = infoResp.data.track;

        // Fallback durée
        let duration = "3:45";
        if (t.duration && t.duration !== "0") {
            const min = Math.floor(t.duration / 60000);
            const sec = ((t.duration % 60000) / 1000).toFixed(0);
            duration = `${min}:${sec.padStart(2, '0')}`;
        }

        const trackData = {
            name: t.name, artist: t.artist.name, album: t.album?.title || "Single",
            image: t.album?.image[3]['#text'] || t.image?.[3]['#text'],
            duration, playcount: parseInt(t.playcount).toLocaleString(),
            listeners: parseInt(t.listeners).toLocaleString(),
            wiki: t.wiki?.summary || "Aucune description.",
            tags: t.toptags?.tag?.slice(0, 5) || [], year: "2024"
        };

        res.render('details.njk', { track: trackData });
    } catch (e) {
        res.status(500).send("Erreur détails");
    }
});


// ROUTE FICHE ARTISTE
app.get('/artiste/:name', async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;
        const artistName = req.params.name;

        // Appel 1 : Infos générales + Bio
        const infoResp = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=artist.getInfo&artist=${encodeURIComponent(artistName)}&api_key=${API_KEY}&format=json`);
        const a = infoResp.data.artist;

        // Appel 2 : Top Albums
        const albumsResp = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=artist.getTopAlbums&artist=${encodeURIComponent(artistName)}&api_key=${API_KEY}&format=json&limit=4`);
        const albums = albumsResp.data.topalbums.album;

        // Appel 3 : Top Titres
        const tracksResp = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=artist.getTopTracks&artist=${encodeURIComponent(artistName)}&api_key=${API_KEY}&format=json&limit=5`);
        const tracks = tracksResp.data.toptracks.track;

        const artistData = {
            name: a.name,
            image: a.image[4]['#text'] || a.image[3]['#text'] || 'https://via.placeholder.com/500',
            listeners: parseInt(a.stats.listeners).toLocaleString(),
            bio: a.bio.summary.split('<a')[0], 
            tags: a.tags.tag.slice(0, 6),
            albums: albums.map(alb => ({
                title: alb.name,
                image: alb.image[3]['#text'] || 'https://via.placeholder.com/150'
            })),
            topTracks: tracks.map((t, index) => ({
                rank: index + 1,
                title: t.name,
                listeners: (parseInt(t.listeners) / 1000000).toFixed(1) + "M"
            }))
        };

        res.render('artist.njk', { artist: artistData });
    } catch (error) {
        console.error("Erreur Artiste:", error.message);
        res.status(500).send("Artiste introuvable");
    }
});


// ROUTE FICHE ALBUM
app.get('/album/:artist/:album', async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;
        const { artist, album } = req.params;

        const response = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=album.getInfo&api_key=${API_KEY}&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}&format=json`);
        
        const alb = response.data.album;
        if (!alb) return res.status(404).send("Album introuvable");

        // Calcul de la durée totale de l'album
        let totalMs = 0;
        const tracks = alb.tracks.track.map(t => {
            const duration = parseInt(t.duration);
            totalMs += duration;
            return {
                name: t.name,
                duration: Math.floor(duration / 60) + ":" + (duration % 60).toString().padStart(2, '0'),
                rank: t['@attr'].rank,
                // On simule des écoutes pour le design Figma
                playcount: (Math.random() * (1.5 - 0.5) + 0.5).toFixed(1) + "M"
            };
        });

        const totalHours = Math.floor(totalMs / 3600);
        const totalMins = Math.floor((totalMs % 3600) / 60);

        const albumData = {
            title: alb.name,
            artist: alb.artist,
            image: alb.image[3]['#text'] || 'https://via.placeholder.com/300',
            year: alb.wiki ? alb.wiki.published.split(',')[0].split(' ').pop() : "2024",
            trackCount: tracks.length,
            totalDuration: `${totalHours > 0 ? totalHours + 'h ' : ''}${totalMins}min`,
            tracks: tracks,
            wiki: alb.wiki ? alb.wiki.summary : "Aucune description disponible pour cet album."
        };

        res.render('album.njk', { album: albumData });
    } catch (error) {
        res.status(500).send("Erreur lors du chargement de l'album");
    }
});


// ==========================================
// DÉMARRAGE DU SERVEUR (NE PAS OUBLIER !)
// ==========================================
app.listen(port, () => {
    console.log(`-------------------------------------------`);
    console.log(`✅ Serveur BPM lancé sur http://localhost:${port}`);
    console.log(`-------------------------------------------`);
});