const express = require('express');
const axios = require('axios');
const nunjucks = require('nunjucks');
require('dotenv').config();

const app = express();
const port = 3000; // Le port de ton site (localhost:3000)

// 1. Configuration de Nunjucks (Pour lire le HTML)
nunjucks.configure('src/views', {
    autoescape: true,
    express: app
});

// 2. La Route Principale (La seule page pour l'instant)
app.get('/', async (req, res) => {
    const query = req.query.search; // Ce que l'utilisateur a tapé
    const apiKey = process.env.LASTFM_API_KEY;
    
    let albums = [];

    // Si l'utilisateur a fait une recherche
    if (query) {
        try {
            console.log(`🔎 Recherche web pour : ${query}`);
            const url = `http://ws.audioscrobbler.com/2.0/?method=album.search&album=${query}&api_key=${apiKey}&format=json`;
            const response = await axios.get(url);
            
            // On récupère les albums
            albums = response.data.results.albummatches.album;
        } catch (error) {
            console.error("Erreur API:", error.message);
        }
    }

    // 3. On envoie la page HTML avec les données (albums) dedans
    res.render('index.html', { 
        albums: albums,
        searched: query 
    });
});

// 4. On allume le serveur
app.listen(port, () => {
    console.log(`🚀 Serveur lancé ! Ouvre http://localhost:${port} dans ton navigateur.`);
});